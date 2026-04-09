const db = require('../../db');
const Order = require('../Models/orderModel');
const OrderItem = require('../Models/orderItemModel.js');
const Address = require('../Models/userAddressModel.js');

const notificationService = require('../utils/notificationService.js');
const commissionService = require('../Services/commissionService');
const distributionService = require('../Services/distributionService');
const invoiceService = require('../Services/invoiceService');

// Helper function to generate a unique order number
const generateOrderNumber = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const randomPart = Math.random().toString(36).substr(2, 6).toUpperCase();
    return `ORD-${year}${month}${day}-${randomPart}`;
};

/**
 * Main Order Creation Function (Refinement with MLM + Attributes)
 */
exports.createOrder = async (req, res) => {
    const userId = req.user.id;
    const { shippingAddressId, paymentMethod, cartItemIds } = req.body;

    if (!shippingAddressId || !paymentMethod) {
        return res.status(400).json({ status: false, message: 'Shipping address and payment method are required.' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get user's cart
        const [cartRows] = await connection.query('SELECT id FROM carts WHERE user_id = ?', [userId]);
        if (cartRows.length === 0) throw new Error('Cart not found.');
        const cartId = cartRows[0].id;

        // 2. Fetch specific items with full details (Filter by cartItemIds if provided)
        const itemQuery = `
            SELECT 
                ci.id as cart_item_id, ci.quantity, sp.id as seller_product_id, p.id as product_id, p.name as product_name,
                sp.selling_price, sp.purchase_price, h.gst_percentage, u.sponsor_id, sp.quantity as stock_available
            FROM cart_items ci
            JOIN seller_products sp ON ci.seller_product_id = sp.id
            JOIN products p ON sp.product_id = p.id
            JOIN users u ON u.id = ?
            LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
            WHERE ci.cart_id = ? ${cartItemIds ? 'AND ci.id IN (?)' : ''} FOR UPDATE;
        `;
        const queryParams = cartItemIds ? [userId, cartId, cartItemIds] : [userId, cartId];
        const [items] = await connection.query(itemQuery, queryParams);

        if (items.length === 0) throw new Error('Your cart is empty or selected items not found.');

        // 3. Fetch Delivery Settings
        const [settingsRows] = await connection.query("SELECT setting_key, setting_value FROM app_settings");
        const settings = settingsRows.reduce((acc, setting) => {
            acc[setting.setting_key] = parseFloat(setting.setting_value);
            return acc;
        }, {});

        const bvGenerationPct = settings.bv_generation_pct_of_profit || 80.0;
        const bvThreshold = settings.delivery_fee_bv_threshold || 50.0;
        const standardFee = settings.delivery_fee_standard || 40.0;
        const specialFee = settings.delivery_fee_special || 0.0;

        // 4. Calculate Totals (Subtotal & BV)
        let calculatedTotalBv = 0;
        let finalSubtotal = 0;
        for (const item of items) {
            if (item.quantity > item.stock_available) throw new Error(`Insufficient stock for ${item.product_name}`);

            const basePrice = item.selling_price / (1 + ((item.gst_percentage || 0) / 100));
            const netProfit = basePrice - item.purchase_price;
            const bvEarnedPerUnit = (netProfit > 0) ? netProfit * (bvGenerationPct / 100) : 0;

            calculatedTotalBv += bvEarnedPerUnit * item.quantity;
            finalSubtotal += (item.selling_price * item.quantity);
        }

        const deliveryFee = (calculatedTotalBv >= bvThreshold) ? specialFee : standardFee;
        const totalAmount = finalSubtotal + deliveryFee;

        // 5. Create Order Header
        const orderNumber = generateOrderNumber();
        let orderStatus = (paymentMethod === 'ONLINE') ? 'PENDING_PAYMENT' : 'CONFIRMED';
        let paymentStatus = (paymentMethod === 'WALLET') ? 'COMPLETED' : 'PENDING';

        const orderSql = `INSERT INTO orders (user_id, shipping_address_id, order_number, subtotal, delivery_fee, total_amount, total_bv_earned, payment_method, payment_status, order_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const [orderResult] = await connection.query(orderSql, [userId, shippingAddressId, orderNumber, finalSubtotal, deliveryFee, totalAmount, calculatedTotalBv, paymentMethod, paymentStatus, orderStatus]);
        const orderId = orderResult.insertId;

        // 6. Loop Items: Process Attributes, Stock, and Line Records
        for (const item of items) {
            // A. Fetch Attribute Snapshot (Size, Color, etc.)
            const [attrRows] = await connection.query(`
                SELECT a.name as attr_key, av.value as attr_value
                FROM product_attributes pa
                JOIN attribute_values av ON pa.attribute_value_id = av.id
                JOIN attributes a ON av.attribute_id = a.id
                WHERE pa.product_id = ?`, [item.product_id]);

            const snapshot = {};
            attrRows.forEach(row => { snapshot[row.attr_key] = row.attr_value; });

            // B. Calculate Profit on this specific line
            const basePrice = item.selling_price / (1 + ((item.gst_percentage || 0) / 100));
            const netProfitOnUnit = (basePrice - item.purchase_price);
            const bvEarnedPerUnit = (netProfitOnUnit > 0) ? netProfitOnUnit * (bvGenerationPct / 100) : 0;

            // C. Insert Order Item (Including Snapshot)
            const orderItemSql = `
                INSERT INTO order_items (
                    order_id, product_id, seller_product_id, product_name, 
                    attributes_snapshot, quantity, price_per_unit, total_price, 
                    bv_earned_per_unit, total_bv_earned
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            await connection.query(orderItemSql, [
                orderId, item.product_id, item.seller_product_id, item.product_name,
                JSON.stringify(snapshot),
                item.quantity, item.selling_price, item.selling_price * item.quantity,
                bvEarnedPerUnit, bvEarnedPerUnit * item.quantity
            ]);

            // D. Deduct Stock
            const [updateResult] = await connection.query(
                'UPDATE seller_products SET quantity = quantity - ? WHERE id = ? AND quantity >= ?',
                [item.quantity, item.seller_product_id, item.quantity]
            );

            if (updateResult.affectedRows === 0) throw new Error(`Stock mismatch for product ${item.product_name}`);

            // E. Notify if low stock
            await notificationService.checkStockAndNotify(item.seller_product_id, connection);
        }

        // 7. Wallet Deduction (Final Check)
        if (paymentMethod === 'WALLET') {
            const [walletRows] = await connection.query('SELECT balance FROM user_wallets WHERE user_id = ? FOR UPDATE', [userId]);
            if (!walletRows[0] || walletRows[0].balance < totalAmount) throw new Error("Insufficient wallet balance.");
            await connection.query('UPDATE user_wallets SET balance = balance - ? WHERE user_id = ?', [totalAmount, userId]);
        }

        // 8. Clean up Cart (Only Delete ordered items)
        const deleteQuery = `DELETE FROM cart_items WHERE cart_id = ?` + (cartItemIds ? ` AND id IN (?)` : ``);
        await connection.query(deleteQuery, cartItemIds ? [cartId, cartItemIds] : [cartId]);

        // 9. Trigger MLM & BV Distribution (Wallet/COD)
        if (paymentMethod === 'WALLET' || paymentMethod === 'COD') {
            await commissionService.processOrderForCommissions(connection, orderId);
            await distributionService.processOrderDistribution(connection, orderId);
        }

        await connection.commit();
        res.status(201).json({ status: true, message: 'Order Placed!', data: { orderId, orderNumber, totalAmount } });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Order Creation Error:", error.message);
        res.status(500).json({ status: false, message: error.message || 'Failed to place order.' });
    } finally {
        if (connection) connection.release();
    }
};

// ==========================================================
// === GET / - Fetches a paginated list of user's orders  ===
// ==========================================================
exports.getOrderHistory = async (req, res) => {
    const userId = req.user.id;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;

    try {
        const dataQuery = `
            SELECT * FROM orders 
            WHERE user_id = ? 
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `;
        const [orderRows] = await db.query(dataQuery, [userId, limit, offset]);

        const countQuery = `SELECT COUNT(*) as total FROM orders WHERE user_id = ?`;
        const [countRows] = await db.query(countQuery, [userId]);
        const totalRecords = countRows[0].total;

        const ordersWithImages = await Promise.all(orderRows.map(async (order) => {
            const [items] = await db.query(`
                SELECT p.main_image_url 
                FROM order_items oi
                JOIN products p ON oi.product_id = p.id
                WHERE oi.order_id = ? LIMIT 1
            `, [order.id]);
            return {
                ...order,
                display_image_url: items[0]?.main_image_url || null
            };
        }));

        res.status(200).json({
            status: true,
            data: ordersWithImages,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(totalRecords / limit),
                totalRecords: totalRecords,
                limit: limit
            }
        });
    } catch (error) {
        console.error("Error fetching order history:", error);
        res.status(500).json({ status: false, message: "An error occurred while fetching order history." });
    }
};

// ==========================================================
// === GET /:orderId - Fetches details of a single order  ===
// ==========================================================
exports.getOrderDetails = async (req, res) => {
    const userId = req.user.id;
    const { orderId } = req.params;

    try {
        const orderQuery = `SELECT * FROM orders WHERE id = ? AND user_id = ?`;
        const [orderRows] = await db.query(orderQuery, [orderId, userId]);
        if (orderRows.length === 0) {
            return res.status(404).json({ status: false, message: 'Order not found.' });
        }

        const addressQuery = `SELECT * FROM user_addresses WHERE id = ?`;
        const [addressRows] = await db.query(addressQuery, [orderRows[0].shipping_address_id]);

        const itemsQuery = `
            SELECT oi.*, p.main_image_url 
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = ?
        `;
        const [itemRows] = await db.query(itemsQuery, [orderId]);

        const orderData = new Order({
            ...orderRows[0],
            shipping_address: addressRows[0] ? new Address(addressRows[0]) : null,
            items: itemRows.map(item => new OrderItem(item))
        });

        res.status(200).json({ status: true, data: orderData });

    } catch (error) {
        console.error("Error fetching order details:", error);
        res.status(500).json({ status: false, message: 'An error occurred while fetching order details.' });
    }
};

exports.updatePaymentMethod = async (req, res) => {
    try {
        const orderId = req.params.id;
        const { paymentMethod } = req.body;

        if (!paymentMethod) {
            return res.status(400).json({ status: false, message: 'Payment method is required' });
        }

        let newStatus = 'PENDING';
        if (paymentMethod === 'COD') {
            newStatus = 'CONFIRMED';
        }

        const [result] = await db.query(
            'UPDATE orders SET payment_method = ?, order_status = ? WHERE id = ?',
            [paymentMethod, newStatus, orderId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: false, message: 'Order not found' });
        }

        res.status(200).json({
            status: true,
            message: 'Payment method and status updated successfully',
            data: { order_status: newStatus }
        });

    } catch (error) {
        console.error('Error updating payment method:', error);
        res.status(500).json({ status: false, message: 'Server error' });
    }
};

/**
 * Generates and downloads the invoice PDF for a specific order.
 */
exports.downloadInvoice = async (req, res) => {
    const userId = req.user.id;
    const { orderId } = req.params;

    try {
        // 1. Get Order Details
        const orderQuery = `SELECT * FROM orders WHERE id = ? AND user_id = ?`;
        const [orderRows] = await db.query(orderQuery, [orderId, userId]);
        if (orderRows.length === 0) {
            return res.status(404).json({ status: false, message: 'Order not found.' });
        }
        const order = orderRows[0];

        // 2. Get Shipping Address
        const [addressRows] = await db.query(`SELECT * FROM user_addresses WHERE id = ?`, [order.shipping_address_id]);
        order.shipping_address = addressRows[0];

        // 3. Get User Details
        const [userRows] = await db.query(`SELECT full_name, username as phone_number FROM users WHERE id = ?`, [userId]);
        const user = userRows[0];

        // 4. Get Items with HSN Code and Seller Info
        const itemsQuery = `
            SELECT oi.*, h.hsn_code, s.display_name as seller_name, s.address as seller_address, s.gstin as seller_gstin
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
            JOIN seller_products sp ON oi.seller_product_id = sp.id
            JOIN sellers s ON sp.seller_id = s.sellerable_id AND s.sellerable_type = 'Admin' -- Defaulting to Admin for now, or match logic
            WHERE oi.order_id = ?
        `;
        // Correction: The mapping between seller_products and sellers might vary based on your multi-seller logic.
        // For simplicity, we fetch the details of the seller linked to the first item.
        const [itemRows] = await db.query(itemsQuery, [orderId]);
        order.items = itemRows;

        const seller = {
            display_name: itemRows[0]?.seller_name || "EARN24",
            address: itemRows[0]?.seller_address || "N/A",
            gstin: itemRows[0]?.seller_gstin || "N/A"
        };

        // 5. Generate PDF
        const pdfBuffer = await invoiceService.generateInvoicePDF(order, user, seller);

        // 6. Send Response
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Invoice-${order.order_number}.pdf`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error("Error generating invoice:", error);
        res.status(500).json({ status: false, message: 'An error occurred while generating the invoice PDF.' });
    }
};

/*
=============================================================================
                          PREVIOUS CODE REFERENCE
=============================================================================

const db = require('../../db');
const Order = require('../Models/orderModel');
const OrderItem = require('../Models/orderItemModel.js');
const Address = require('../Models/userAddressModel.js');

const notificationService = require('../utils/notificationService.js');
const commissionService = require('../Services/commissionService');

// Helper function to generate a unique order number
const generateOrderNumber = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const randomPart = Math.random().toString(36).substr(2, 6).toUpperCase();
    return `ORD-${year}${month}${day}-${randomPart}`;
};

// ... and other previous versions provided by you ...
=============================================================================
*/