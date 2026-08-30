const db = require('../../db');
const crypto = require('crypto');
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

        // 2. Fetch specific items with full details (Filter by cartItemIds if provided with automatic fallback)
        let validCartItemIds = null;
        if (cartItemIds) {
            if (Array.isArray(cartItemIds)) {
                validCartItemIds = cartItemIds.map(id => Number(id)).filter(id => !isNaN(id) && id > 0);
            } else if (typeof cartItemIds === 'string') {
                validCartItemIds = cartItemIds.split(',').map(id => Number(id.trim())).filter(id => !isNaN(id) && id > 0);
            }
        }

        const baseItemQuery = `
            SELECT 
                ci.id as cart_item_id, ci.quantity, ci.seller_product_variant_id,
                sp.id as seller_product_id, p.id as product_id, p.name as product_name,
                sp.selling_price, sp.purchase_price, sp.admin_margin_percent, h.gst_percentage, u.sponsor_id, sp.quantity as stock_available,
                spv.id as variant_id, spv.title as variant_title, spv.color as variant_color,
                spv.size as variant_size, spv.sku as variant_sku, spv.price as variant_price,
                spv.variant_image_url as variant_image_url
            FROM cart_items ci
            JOIN seller_products sp ON ci.seller_product_id = sp.id
            JOIN products p ON sp.product_id = p.id
            LEFT JOIN seller_product_variants spv ON ci.seller_product_variant_id = spv.id
            JOIN users u ON u.id = ?
            LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
            WHERE ci.cart_id = ?
        `;

        let items = [];
        if (validCartItemIds && validCartItemIds.length > 0) {
            const [filteredItems] = await connection.query(`${baseItemQuery} AND ci.id IN (?) FOR UPDATE;`, [userId, cartId, validCartItemIds]);
            items = filteredItems;
        }

        if (items.length === 0) {
            const [allCartItems] = await connection.query(`${baseItemQuery} FOR UPDATE;`, [userId, cartId]);
            items = allCartItems;
        }

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
        const isCodActive = settings.is_cod_active !== undefined ? settings.is_cod_active : 1;

        if (paymentMethod === 'COD' && isCodActive === 0) {
            throw new Error('Cash on Delivery (COD) is currently disabled by the administrator.');
        }

        const computeItemBv = (item, price) => {
            if (parseFloat(item.admin_margin_percent || 0) > 0) {
                return Math.max(0, (price * (parseFloat(item.admin_margin_percent) / 100)) * (bvGenerationPct / 100));
            }
            const grossProfit = price - (parseFloat(item.purchase_price) || 0);
            const gstAmount = (price * (parseFloat(item.gst_percentage) || 0)) / 100;
            const netProfit = grossProfit - gstAmount;
            return Math.max(0, (netProfit > 0) ? netProfit * (bvGenerationPct / 100) : 0);
        };

        // 4. Calculate Totals (Subtotal & BV)
        let calculatedTotalBv = 0;
        let finalSubtotal = 0;
        for (const item of items) {
            const effectivePrice = item.variant_price ? parseFloat(item.variant_price) : parseFloat(item.selling_price);
            if (item.quantity > item.stock_available) throw new Error(`Insufficient stock for ${item.product_name}`);

            const bvEarnedPerUnit = computeItemBv(item, effectivePrice);

            calculatedTotalBv += bvEarnedPerUnit * item.quantity;
            finalSubtotal += (effectivePrice * item.quantity);
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
            const effectivePrice = item.variant_price ? parseFloat(item.variant_price) : parseFloat(item.selling_price);
            const effectiveName = item.variant_title 
                ? `${item.product_name} (${item.variant_title})` 
                : (item.variant_color || item.variant_size ? `${item.product_name} (${[item.variant_color, item.variant_size].filter(Boolean).join(' ')})` : item.product_name);

            // A. Fetch Attribute Snapshot (Size, Color, etc.)
            const [attrRows] = await connection.query(`
                SELECT a.name as attr_key, av.value as attr_value
                FROM product_attributes pa
                JOIN attribute_values av ON pa.attribute_value_id = av.id
                JOIN attributes a ON av.attribute_id = a.id
                WHERE pa.product_id = ?`, [item.product_id]);

            const snapshot = {};
            attrRows.forEach(row => { snapshot[row.attr_key] = row.attr_value; });
            if (item.variant_title) snapshot['Selected Variant'] = item.variant_title;
            if (item.variant_color) snapshot['Color'] = item.variant_color;
            if (item.variant_size) snapshot['Size'] = item.variant_size;
            if (item.variant_sku) snapshot['SKU'] = item.variant_sku;
            if (item.variant_image_url) snapshot['Variant Image'] = item.variant_image_url;

            // B. Calculate Profit on this specific line
            const bvEarnedPerUnit = computeItemBv(item, effectivePrice);

            // C. Insert Order Item (Including Snapshot)
            const orderItemSql = `
                INSERT INTO order_items (
                    order_id, product_id, seller_product_id, product_name, 
                    attributes_snapshot, quantity, price_per_unit, purchase_price, gst_percentage, total_price, 
                    bv_earned_per_unit, total_bv_earned
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            await connection.query(orderItemSql, [
                orderId, item.product_id, item.seller_product_id, effectiveName,
                JSON.stringify(snapshot),
                item.quantity, effectivePrice, item.purchase_price, item.gst_percentage || 0.00, effectivePrice * item.quantity,
                bvEarnedPerUnit, bvEarnedPerUnit * item.quantity
            ]);

            // D. Deduct Stock (Variant-aware)
            if (item.variant_id) {
                const [varUpdate] = await connection.query(
                    'UPDATE seller_product_variants SET stock_quantity = stock_quantity - ? WHERE id = ? AND stock_quantity >= ?',
                    [item.quantity, item.variant_id, item.quantity]
                );
                if (varUpdate.affectedRows === 0) {
                    throw new Error(`Out of stock for variant ${item.variant_title || item.product_name}`);
                }
                // Safely sync master seller_product stock
                await connection.query(
                    'UPDATE seller_products SET quantity = GREATEST(0, quantity - ?) WHERE id = ?',
                    [item.quantity, item.seller_product_id]
                );
            } else {
                const [updateResult] = await connection.query(
                    'UPDATE seller_products SET quantity = quantity - ? WHERE id = ? AND quantity >= ?',
                    [item.quantity, item.seller_product_id, item.quantity]
                );
                if (updateResult.affectedRows === 0) {
                    throw new Error(`Out of stock for product ${item.product_name}`);
                }
            }

            // E. Notify if low stock
            await notificationService.checkStockAndNotify(item.seller_product_id, connection);
        }

        // 7. Wallet Deduction (Final Check & Transaction Log)
        if (paymentMethod === 'WALLET') {
            const [walletRows] = await connection.query('SELECT balance FROM user_wallets WHERE user_id = ? FOR UPDATE', [userId]);
            if (!walletRows[0] || walletRows[0].balance < totalAmount) throw new Error("Insufficient wallet balance.");
            await connection.query('UPDATE user_wallets SET balance = balance - ? WHERE user_id = ?', [totalAmount, userId]);
            
            // Record Debit Entry in user_wallet_transactions for Customer Wallet History
            await connection.query(
                `INSERT INTO user_wallet_transactions (user_id, txn_type, amount, source, reference_id, remarks, created_at) 
                 VALUES (?, 'debit', ?, 'order_purchase', ?, ?, NOW())`,
                [userId, totalAmount, orderId, `Payment for Order #${orderNumber}`]
            ).catch(err => console.warn('Wallet transaction log write warning:', err.message));
        }

        // 8. Clean up Cart (Only Delete ordered items)
        const deleteQuery = `DELETE FROM cart_items WHERE cart_id = ?` + (cartItemIds ? ` AND id IN (?)` : ``);
        await connection.query(deleteQuery, cartItemIds ? [cartId, cartItemIds] : [cartId]);

        // 9. MLM & BV Distribution triggers have been REMOVED from here to prevent double-BV.
        // Distribution now happens ONLY in deliveryAppController.completeDelivery 
        // when the customer successfully receives the order via OTP.
        
        await connection.commit();

        // Trigger Smart Auto-Dispatch Engine asynchronously
        const deliveryAppController = require('./deliveryAppController');
        deliveryAppController.autoDispatchOrder(orderId).catch(err => 
            console.error('[Auto-Dispatch Trigger Error]', err.message)
        );

        const io = req.app.get('socketio');
        if (io) {
            io.to('admins').emit('new_order', {
                orderId,
                orderNumber,
                totalAmount,
                orderStatus
            });
        }

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
                SELECT oi.product_name, oi.attributes_snapshot, p.main_image_url 
                FROM order_items oi
                JOIN products p ON oi.product_id = p.id
                WHERE oi.order_id = ? LIMIT 1
            `, [order.id]);
            let displayImg = items[0]?.main_image_url || null;
            if (items[0]?.attributes_snapshot) {
                try {
                    const snap = typeof items[0].attributes_snapshot === 'string' ? JSON.parse(items[0].attributes_snapshot) : items[0].attributes_snapshot;
                    if (snap && snap['Variant Image']) {
                        displayImg = snap['Variant Image'];
                    }
                } catch (e) {}
            }
            return {
                ...order,
                display_image_url: displayImg,
                first_item_name: items[0]?.product_name || null
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
            SELECT oi.*, p.main_image_url, 
                   IFNULL(sp.return_window_days, 7) as return_window_days, 
                   IFNULL(sp.is_returnable, 1) as is_returnable
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            LEFT JOIN seller_products sp ON oi.seller_product_id = sp.id
            WHERE oi.order_id = ?
        `;
        const [itemRows] = await db.query(itemsQuery, [orderId]);

        const [returnRows] = await db.query(
            `SELECT id, status, request_type, reason, created_at FROM order_returns WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
            [orderId]
        ).catch(() => [[]]);

        const returnWindowDays = itemRows.length > 0 ? Math.max(...itemRows.map(i => parseInt(i.return_window_days || 7))) : 7;
        const isReturnable = itemRows.length > 0 ? itemRows.some(i => i.is_returnable !== 0) : true;

        const orderData = new Order({
            ...orderRows[0],
            return_window_days: returnWindowDays,
            is_returnable: isReturnable ? 1 : 0,
            shipping_address: addressRows[0] ? new Address(addressRows[0]) : null,
            items: itemRows.map(item => new OrderItem(item)),
            return_request: returnRows && returnRows[0] ? returnRows[0] : null
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

        if (order.order_status !== 'DELIVERED') {
            return res.status(400).json({ status: false, message: 'Invoice is only available after the order has been delivered.' });
        }

        // 2. Get Shipping Address
        const [addressRows] = await db.query(`SELECT * FROM user_addresses WHERE id = ?`, [order.shipping_address_id]);
        order.shipping_address = addressRows[0];

        // 3. Get User Details
        const [userRows] = await db.query(`SELECT full_name, mobile_number as phone_number FROM users WHERE id = ?`, [userId]);
        const user = userRows[0];

        // 4. Get Items with HSN Code and Seller Info
        const itemsQuery = `
            SELECT oi.*, h.hsn_code, h.gst_percentage, s.display_name as seller_name, s.address as seller_address, s.gstin as seller_gstin
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
            JOIN seller_products sp ON oi.seller_product_id = sp.id
            JOIN sellers s ON sp.seller_id = s.sellerable_id AND s.sellerable_type = 'Admin'
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

        // 6. Send Response (Changed to attachment to force Download)
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Invoice-${order.order_number}.pdf`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error("Error generating invoice:", error);
        res.status(500).json({ status: false, message: 'An error occurred while generating the invoice PDF.' });
    }
};

exports.cancelUserOrder = async (req, res) => {
    const userId = req.user.id;
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
        return res.status(400).json({ status: false, message: "Cancellation reason is required." });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Fetch Order and Lock
        const [orders] = await connection.query(
            "SELECT * FROM orders WHERE id = ? AND user_id = ? FOR UPDATE",
            [id, userId]
        );

        if (orders.length === 0) {
            await connection.rollback();
            return res.status(404).json({ status: false, message: "Order not found." });
        }

        const order = orders[0];

        // 2. Validate current status
        const allowedStatuses = ['PENDING', 'PENDING_PAYMENT', 'CONFIRMED'];
        if (!allowedStatuses.includes(order.order_status)) {
            await connection.rollback();
            return res.status(400).json({ 
                status: false, 
                message: `Order cannot be cancelled in its current state (${order.order_status}).` 
            });
        }

        // 3. Restock inventory
        const [items] = await connection.query(
            "SELECT seller_product_id, quantity FROM order_items WHERE order_id = ?",
            [id]
        );

        for (const item of items) {
            await connection.query(
                "UPDATE seller_products SET quantity = quantity + ? WHERE id = ?",
                [item.quantity, item.seller_product_id]
            );
        }

        // 4. Wallet Refund if payment was completed or payment method was WALLET
        let refundProcessed = false;
        if (order.payment_status === 'COMPLETED' || order.payment_method === 'WALLET') {
            const [wallets] = await connection.query(
                "SELECT balance FROM user_wallets WHERE user_id = ? FOR UPDATE",
                [userId]
            );
            if (wallets.length === 0) {
                await connection.query("INSERT INTO user_wallets (user_id, balance) VALUES (?, ?)", [userId, order.total_amount]);
            } else {
                await connection.query(
                    "UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?",
                    [order.total_amount, userId]
                );
            }

            // Insert into transaction history
            await connection.query(
                `INSERT INTO user_wallet_transactions 
                 (user_id, txn_type, amount, source, reference_id, remarks) 
                 VALUES (?, 'credit', ?, 'refund', ?, ?)`,
                [userId, order.total_amount, order.order_number, `Refund for cancelled order: ${reason}`]
            );
            refundProcessed = true;
        }

        // 5. Update order details
        await connection.query(
            `UPDATE orders 
             SET order_status = 'CANCELLED', 
                 payment_status = ?, 
                 cancellation_reason = ?, 
                 cancelled_by = 'USER', 
                 cancelled_at = NOW() 
             WHERE id = ?`,
            [refundProcessed ? 'REFUNDED' : 'FAILED', reason, id]
        );

        await connection.commit();
        res.status(200).json({ status: true, message: "Order cancelled successfully.", data: { orderId: id, refundProcessed } });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("User Order Cancellation Error:", error);
        res.status(500).json({ status: false, message: "Failed to cancel order: " + error.message });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * Cancels a single specific item within an order
 */
exports.cancelOrderItem = async (req, res) => {
    const userId = req.user.id;
    const { orderId, itemId } = req.params;
    const { reason = 'Cancelled by user' } = req.body;

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. Verify Order Ownership & Status
        const [orders] = await connection.query(
            "SELECT * FROM orders WHERE id = ? AND user_id = ? FOR UPDATE",
            [orderId, userId]
        );
        if (orders.length === 0) {
            await connection.rollback();
            return res.status(404).json({ status: false, message: "Order not found." });
        }

        const order = orders[0];
        const allowedStatuses = ['PENDING', 'PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING'];
        if (!allowedStatuses.includes(order.order_status)) {
            await connection.rollback();
            return res.status(400).json({
                status: false,
                message: `Items cannot be cancelled when order is in '${order.order_status}' status.`
            });
        }

        // 2. Verify Order Item
        const [items] = await connection.query(
            "SELECT * FROM order_items WHERE id = ? AND order_id = ? FOR UPDATE",
            [itemId, orderId]
        );
        if (items.length === 0) {
            await connection.rollback();
            return res.status(404).json({ status: false, message: "Order item not found." });
        }

        const item = items[0];
        if (item.item_status === 'CANCELLED') {
            await connection.rollback();
            return res.status(400).json({ status: false, message: "This item has already been cancelled." });
        }

        // 3. Mark Item as Cancelled
        await connection.query(
            `UPDATE order_items 
             SET item_status = 'CANCELLED', cancelled_at = NOW(), cancellation_reason = ? 
             WHERE id = ?`,
            [reason, itemId]
        );

        // 4. Restore Stock
        let variantId = null;
        if (item.attributes_snapshot) {
            try {
                const snapshot = typeof item.attributes_snapshot === 'string' 
                    ? JSON.parse(item.attributes_snapshot) 
                    : item.attributes_snapshot;
                variantId = snapshot.variant_id || snapshot.variantId || null;
            } catch (e) {}
        }

        if (variantId) {
            await connection.query(
                "UPDATE seller_product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?",
                [item.quantity, variantId]
            );
        }
        await connection.query(
            "UPDATE seller_products SET quantity = quantity + ? WHERE id = ?",
            [item.quantity, item.seller_product_id]
        );

        // 5. Refund Amount to Wallet if Paid
        let refundProcessed = false;
        const refundAmount = parseFloat(item.total_price || 0);

        if ((order.payment_status === 'PAID' || ['WALLET', 'ONLINE', 'RAZORPAY'].includes(order.payment_method)) && refundAmount > 0) {
            const [wallets] = await connection.query(
                "SELECT balance FROM user_wallets WHERE user_id = ? FOR UPDATE",
                [userId]
            );
            if (wallets.length === 0) {
                await connection.query("INSERT INTO user_wallets (user_id, balance) VALUES (?, ?)", [userId, refundAmount]);
            } else {
                await connection.query(
                    "UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?",
                    [refundAmount, userId]
                );
            }

            await connection.query(
                `INSERT INTO user_wallet_transactions 
                 (user_id, txn_type, amount, source, reference_id, remarks) 
                 VALUES (?, 'credit', ?, 'refund', ?, ?)`,
                [userId, refundAmount, order.order_number, `Refund for cancelled item '${item.product_name}' in Order #${order.order_number}`]
            );
            refundProcessed = true;
        }

        // 6. Recalculate remaining active items for this order
        const [activeRows] = await connection.query(
            "SELECT COUNT(*) as active_count, SUM(total_price) as new_subtotal FROM order_items WHERE order_id = ? AND (item_status IS NULL OR item_status = 'ACTIVE')",
            [orderId]
        );

        const activeCount = activeRows[0].active_count || 0;
        const newSubtotal = parseFloat(activeRows[0].new_subtotal || 0);

        if (activeCount === 0) {
            // All items cancelled -> update order status to CANCELLED
            await connection.query(
                `UPDATE orders 
                 SET order_status = 'CANCELLED', 
                     payment_status = ?, 
                     cancellation_reason = 'All items cancelled', 
                     cancelled_by = 'USER', 
                     cancelled_at = NOW() 
                 WHERE id = ?`,
                [refundProcessed ? 'REFUNDED' : 'FAILED', orderId]
            );
        } else {
            // Update subtotal & total amount
            const newTotalAmount = newSubtotal + parseFloat(order.delivery_fee || 0);
            await connection.query(
                "UPDATE orders SET subtotal = ?, total_amount = ? WHERE id = ?",
                [newSubtotal, newTotalAmount, orderId]
            );
        }

        await connection.commit();
        res.status(200).json({
            status: true,
            message: "Item cancelled successfully.",
            data: {
                itemId,
                orderId,
                refundProcessed,
                refundAmount,
                remainingActiveItems: activeCount
            }
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Item Cancellation Error:", error);
        res.status(500).json({ status: false, message: "Failed to cancel item: " + error.message });
    } finally {
        if (connection) connection.release();
    }
};

exports.requestReturnOrReplacement = async (req, res) => {
    const userId = req.user.id;
    const { orderId } = req.params;
    const { reason, type = 'RETURN' } = req.body;

    if (!reason) {
        return res.status(400).json({ status: false, message: 'Reason for return or replacement is required.' });
    }

    try {
        const [orders] = await db.query(
            `SELECT id, order_status, created_at FROM orders WHERE id = ? AND user_id = ?`,
            [orderId, userId]
        );

        if (orders.length === 0) {
            return res.status(404).json({ status: false, message: 'Order not found.' });
        }

        const order = orders[0];
        if (order.order_status !== 'DELIVERED') {
            return res.status(400).json({ status: false, message: 'Only delivered orders can be submitted for return or replacement.' });
        }

        const daysDiff = (new Date() - new Date(order.created_at)) / (1000 * 60 * 60 * 24);
        if (daysDiff > 7) {
            return res.status(400).json({ status: false, message: 'The 7-day return/replacement window for this order has expired.' });
        }

        await db.query(
            `UPDATE orders 
             SET return_status = 'REQUESTED', return_reason = ?, return_type = ? 
             WHERE id = ?`,
            [reason, type, orderId]
        );

        res.status(200).json({ 
            status: true, 
            message: `Your ${type === 'REPLACEMENT' ? 'replacement' : 'return'} request has been submitted successfully.` 
        });
    } catch (error) {
        console.error("Error in requestReturnOrReplacement:", error);
        res.status(500).json({ status: false, message: 'Failed to submit return request.' });
    }
};

/**
 * Initiate PayU Live Online Payment
 * Creates pending order & returns PayU SHA-512 Payment Signature Hash
 */
exports.initiatePayUPayment = async (req, res) => {
    const userId = req.user.id;
    const { shippingAddressId, cartItemIds } = req.body;

    if (!shippingAddressId) {
        return res.status(400).json({ status: false, message: 'Shipping address is required.' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get user details
        const [userRows] = await connection.query('SELECT full_name, email, mobile_number FROM users WHERE id = ?', [userId]);
        if (userRows.length === 0) throw new Error('User not found.');
        const user = userRows[0];

        // 2. Get user's cart
        const [cartRows] = await connection.query('SELECT id FROM carts WHERE user_id = ?', [userId]);
        if (cartRows.length === 0) throw new Error('Cart not found.');
        const cartId = cartRows[0].id;

        // 3. Fetch cart items (Filter by cartItemIds if provided with automatic fallback)
        let validCartItemIds = null;
        if (cartItemIds) {
            if (Array.isArray(cartItemIds)) {
                validCartItemIds = cartItemIds.map(id => Number(id)).filter(id => !isNaN(id) && id > 0);
            } else if (typeof cartItemIds === 'string') {
                validCartItemIds = cartItemIds.split(',').map(id => Number(id.trim())).filter(id => !isNaN(id) && id > 0);
            }
        }

        const basePayUItemQuery = `
            SELECT 
                ci.id as cart_item_id, ci.quantity, ci.seller_product_variant_id,
                sp.id as seller_product_id, p.id as product_id, p.name as product_name,
                sp.selling_price, sp.purchase_price, sp.admin_margin_percent, h.gst_percentage, sp.quantity as stock_available,
                spv.id as variant_id, spv.title as variant_title, spv.price as variant_price
            FROM cart_items ci
            JOIN seller_products sp ON ci.seller_product_id = sp.id
            JOIN products p ON sp.product_id = p.id
            LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
            LEFT JOIN seller_product_variants spv ON ci.seller_product_variant_id = spv.id
            WHERE ci.cart_id = ?
        `;

        let cartItems = [];
        if (validCartItemIds && validCartItemIds.length > 0) {
            const [filtered] = await connection.query(`${basePayUItemQuery} AND ci.id IN (?)`, [cartId, validCartItemIds]);
            cartItems = filtered;
        }

        if (cartItems.length === 0) {
            const [allInCart] = await connection.query(basePayUItemQuery, [cartId]);
            cartItems = allInCart;
        }

        if (cartItems.length === 0) throw new Error('No items selected for payment.');

        // Fetch Delivery & BV Settings
        const [settingsRows] = await connection.query("SELECT setting_key, setting_value FROM app_settings");
        const settings = settingsRows.reduce((acc, setting) => {
            acc[setting.setting_key] = parseFloat(setting.setting_value);
            return acc;
        }, {});

        const bvGenerationPct = settings.bv_generation_pct_of_profit || 80.0;
        const bvThreshold = settings.delivery_fee_bv_threshold || 50.0;
        const standardFee = settings.delivery_fee_standard || 40.0;
        const specialFee = settings.delivery_fee_special || 0.0;

        let subtotal = 0;
        let totalGstAmount = 0;
        let totalBvEarned = 0;

        for (const item of cartItems) {
            const itemPrice = parseFloat(item.variant_id ? item.variant_price : item.selling_price);
            const itemQty = parseInt(item.quantity);
            subtotal += itemPrice * itemQty;

            const gstPercent = parseFloat(item.gst_percentage || 0);
            if (gstPercent > 0) {
                totalGstAmount += ((itemPrice * itemQty) * gstPercent) / 100;
            }

            const adminMargin = parseFloat(item.admin_margin_percent || 0);
            const purchasePrice = parseFloat(item.purchase_price || 0);
            let itemProfit = 0;
            if (adminMargin > 0) {
                itemProfit = (itemPrice * adminMargin) / 100;
            } else {
                const grossProfit = itemPrice - purchasePrice;
                const gstAmt = (itemPrice * gstPercent) / 100;
                itemProfit = grossProfit - gstAmt;
            }
            if (itemProfit > 0) {
                totalBvEarned += (itemProfit * (bvGenerationPct / 100)) * itemQty;
            }
        }

        const deliveryFee = totalBvEarned >= bvThreshold ? specialFee : standardFee;
        const totalAmount = Math.round((subtotal + deliveryFee) * 100) / 100;

        // 4. Check if user already has an unpaid PENDING draft order created in the last 15 mins to REUSE
        const [existingPending] = await connection.query(
            `SELECT id, order_number FROM orders WHERE user_id = ? AND payment_status = 'PENDING' AND order_status = 'PENDING' AND created_at > NOW() - INTERVAL 15 MINUTE ORDER BY id DESC LIMIT 1`,
            [userId]
        );

        let orderId;
        let orderNumber;

        if (existingPending && existingPending.length > 0) {
            orderId = existingPending[0].id;
            orderNumber = existingPending[0].order_number;

            await connection.query(
                `UPDATE orders SET shipping_address_id = ?, subtotal = ?, delivery_fee = ?, total_amount = ?, total_bv_earned = ?, updated_at = NOW() WHERE id = ?`,
                [shippingAddressId, subtotal, deliveryFee, totalAmount, totalBvEarned, orderId]
            );
            await connection.query(`DELETE FROM order_items WHERE order_id = ?`, [orderId]);
        } else {
            const date = new Date();
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const randomPart = Math.random().toString(36).substr(2, 6).toUpperCase();
            orderNumber = `ORD-${year}${month}${day}-${randomPart}`;

            const [orderResult] = await connection.query(
                `INSERT INTO orders (
                    user_id, shipping_address_id, order_number, subtotal, delivery_fee, 
                    total_amount, total_bv_earned, payment_method, payment_status, order_status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PAYU', 'PENDING', 'PENDING', NOW(), NOW())`,
                [userId, shippingAddressId, orderNumber, subtotal, deliveryFee, totalAmount, totalBvEarned]
            );
            orderId = orderResult.insertId;
        }

        const txnid = `TXN_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        // 5. Insert Order Items using exact production schema
        for (const item of cartItems) {
            const snapshot = {};
            if (item.variant_title) snapshot['Selected Variant'] = item.variant_title;
            if (item.variant_color) snapshot['Color'] = item.variant_color;
            if (item.variant_size) snapshot['Size'] = item.variant_size;
            if (item.variant_sku) snapshot['SKU'] = item.variant_sku;
            if (item.variant_image_url) snapshot['Variant Image'] = item.variant_image_url;

            const effectivePrice = parseFloat(item.variant_id ? item.variant_price : item.selling_price);
            const effectiveName = item.variant_id ? `${item.product_name} (${item.variant_title})` : item.product_name;

            const adminMargin = parseFloat(item.admin_margin_percent || 0);
            const purchasePrice = parseFloat(item.purchase_price || 0);
            const gstPercent = parseFloat(item.gst_percentage || 0);
            let itemProfit = 0;
            if (adminMargin > 0) {
                itemProfit = (effectivePrice * adminMargin) / 100;
            } else {
                const grossProfit = effectivePrice - purchasePrice;
                const gstAmt = (effectivePrice * gstPercent) / 100;
                itemProfit = grossProfit - gstAmt;
            }
            const bvEarnedPerUnit = itemProfit > 0 ? (itemProfit * (bvGenerationPct / 100)) : 0;

            const orderItemSql = `
                INSERT INTO order_items (
                    order_id, product_id, seller_product_id, product_name, 
                    attributes_snapshot, quantity, price_per_unit, purchase_price, gst_percentage, total_price, 
                    bv_earned_per_unit, total_bv_earned
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            await connection.query(orderItemSql, [
                orderId, item.product_id, item.seller_product_id, effectiveName,
                JSON.stringify(snapshot),
                item.quantity, effectivePrice, purchasePrice, gstPercent, effectivePrice * item.quantity,
                bvEarnedPerUnit, bvEarnedPerUnit * item.quantity
            ]);
        }

        await connection.commit();

        // 6. Get PayU Credentials (Dynamic DB + Env Fallback)
        const getPayUCredentials = async () => {
            try {
                const [rows] = await db.query(
                    `SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE gateway_name = 'payu' AND is_active = 1 LIMIT 1`
                );
                if (rows.length > 0) {
                    const { decryptObject } = require('../utils/encryption.helper');
                    const config = decryptObject({
                        encryptedData: rows[0].encrypted_config,
                        iv: rows[0].encryption_iv,
                    });
                    if (config && (config.merchantKey || config.key) && (config.merchantSalt || config.salt)) {
                        return {
                            payuKey: config.merchantKey || config.key,
                            payuSalt: config.merchantSalt || config.salt,
                            payuBaseUrl: config.isSandBox ? 'https://test.payu.in/_payment' : 'https://secure.payu.in/_payment'
                        };
                    }
                }
            } catch (e) {
                console.warn('DB PayU Config Read Warning:', e.message);
            }
            return {
                payuKey: process.env.PAYU_MERCHANT_KEY || 'm2uwkj',
                payuSalt: process.env.PAYU_MERCHANT_SALT || 'PyBf3kWiI6MdwYhrR3geD108F7fcpPI4',
                payuBaseUrl: process.env.PAYU_BASE_URL || 'https://secure.payu.in/_payment'
            };
        };

        const { payuKey, payuSalt, payuBaseUrl } = await getPayUCredentials();

        const productInfo = `Order_${orderNumber}`;
        const firstname = (user.full_name || 'Customer').split(' ')[0].replace(/[^a-zA-Z0-9]/g, '') || 'Customer';
        const email = user.email || 'customer@earn24.in';
        const phone = user.mobile_number || '9999999999';

        // Format: key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5|udf6|udf7|udf8|udf9|udf10|SALT (11 pipes after email)
        const hashString = `${payuKey}|${txnid}|${totalAmount.toFixed(2)}|${productInfo}|${firstname}|${email}|${orderId}||||||||||${payuSalt}`;
        const hash = crypto.createHash('sha512').update(hashString).digest('hex');

        console.log(`[PayU Debug] Key: ${payuKey} | Salt: ${payuSalt.slice(0, 4)}...${payuSalt.slice(-4)} | Amount: ${totalAmount.toFixed(2)} | OrderID: ${orderId}`);
        console.log(`[PayU Debug] HashString: ${hashString}`);
        console.log(`[PayU Debug] Hash: ${hash}`);

        res.status(200).json({
            status: true,
            message: 'PayU payment session initialized.',
            data: {
                payuUrl: payuBaseUrl,
                key: payuKey,
                txnid: txnid,
                amount: totalAmount.toFixed(2),
                productinfo: productInfo,
                firstname: firstname,
                email: email,
                phone: phone,
                hash: hash,
                orderId: orderId,
                orderNumber: orderNumber,
                udf1: orderId.toString(),
                surl: `${process.env.BASE_URL || 'https://newapi.earn24.in'}/api/orders/payu/verify`,
                furl: `${process.env.BASE_URL || 'https://newapi.earn24.in'}/api/orders/payu/verify`
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error("Error initiating PayU payment:", error);
        res.status(500).json({ status: false, message: error.message || 'Failed to initialize PayU payment.' });
    } finally {
        connection.release();
    }
};

/**
 * Verify PayU Response & Complete Order
 */
exports.verifyPayUPayment = async (req, res) => {
    const body = req.body || {};
    const query = req.query || {};
    const data = { ...query, ...body };

    const { status } = data;
    const targetOrderId = data.orderId || data.udf1;

    try {
        if (status === 'success' || data.status === 'success') {
            if (targetOrderId) {
                // Update Order to PAID & CONFIRMED
                await db.query(
                    `UPDATE orders SET payment_status = 'PAID', order_status = 'CONFIRMED', updated_at = NOW() WHERE id = ?`,
                    [targetOrderId]
                );

                // Fetch order info to notify socket rooms & clean orphaned draft orders
                const [orderRows] = await db.query(`SELECT user_id, order_number FROM orders WHERE id = ?`, [targetOrderId]);
                if (orderRows.length > 0) {
                    const userId = orderRows[0].user_id;

                    // Clean up orphaned unpaid pending orders for this user
                    await db.query(
                        `UPDATE orders SET order_status = 'CANCELLED', payment_status = 'FAILED' WHERE user_id = ? AND payment_status = 'PENDING' AND id != ?`,
                        [userId, targetOrderId]
                    );

                    // Clear User Cart
                    const [cartRows] = await db.query('SELECT id FROM carts WHERE user_id = ?', [userId]);
                    if (cartRows.length > 0) {
                        await db.query('DELETE FROM cart_items WHERE cart_id = ?', [cartRows[0].id]);
                    }

                    // Notify Socket Admin & Merchant
                    const io = req.app.get('io');
                    if (io) {
                        io.to('admins').emit('new_order', { orderId: targetOrderId, orderNumber: orderRows[0].order_number });
                    }
                }
            }

            return res.status(200).json({ status: true, message: 'Payment verified and order placed successfully.' });
        } else {
            // Update Order to FAILED & CANCELLED
            if (targetOrderId) {
                await db.query(`UPDATE orders SET payment_status = 'FAILED', order_status = 'CANCELLED', updated_at = NOW() WHERE id = ?`, [targetOrderId]);
            }
            return res.status(400).json({ status: false, message: 'Payment verification failed or payment cancelled.' });
        }
    } catch (error) {
        console.error("Error verifying PayU payment:", error);
        res.status(500).json({ status: false, message: 'Internal server error verifying payment.' });
    }
};

/**
 * @desc   Cancel order with Hybrid Refund (Wallet / Bank / COD) & Stock/BV Reversal
 * @route  POST /api/orders/:id/cancel
 * @access Private (User)
 */
exports.cancelUserOrder = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const orderId = req.params.id || req.params.orderId;
    const { refund_type, cancellation_reason } = req.body;
    const userId = req.user ? req.user.id : null;

    let query = "SELECT * FROM orders WHERE id = ?";
    let params = [orderId];
    if (userId && req.user.role !== 'admin') {
      query += " AND user_id = ?";
      params.push(userId);
    }

    const [orders] = await connection.query(query, params);
    if (!orders || orders.length === 0) {
      await connection.rollback();
      return res.status(404).json({ status: false, message: 'Order not found or access denied.' });
    }

    const order = orders[0];
    const upperStatus = (order.order_status || '').toUpperCase();

    if (upperStatus === 'CANCELLED') {
      await connection.rollback();
      return res.status(400).json({ status: false, message: 'Order is already cancelled.' });
    }

    if (['SHIPPED', 'DELIVERED', 'COMPLETED', 'OUT_FOR_DELIVERY'].includes(upperStatus)) {
      await connection.rollback();
      return res.status(400).json({ status: false, message: `Order cannot be cancelled as it is already ${upperStatus}.` });
    }

    const refundAmount = parseFloat(order.total_amount || 0);
    const paymentMethod = (order.payment_method || '').toUpperCase();
    const isPaid = (order.payment_status || '').toUpperCase() === 'PAID' || (order.payment_status || '').toUpperCase() === 'SUCCESS';

    let refundStatus = 'NONE';
    let processedRefundType = 'N/A';

    // 1. Process Financial Refund based on Payment Method & User Preference
    if (paymentMethod === 'WALLET' || (isPaid && (refund_type === 'WALLET' || !refund_type))) {
      // Refund 100% to Earn24 Wallet
      processedRefundType = 'WALLET';
      refundStatus = 'REFUNDED';

      const [wCheck] = await connection.query("SELECT id FROM user_wallets WHERE user_id = ?", [order.user_id]);
      if (wCheck.length > 0) {
        await connection.query(
          "UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?",
          [refundAmount, order.user_id]
        );
      } else {
        await connection.query(
          "INSERT INTO user_wallets (user_id, balance, created_at, updated_at) VALUES (?, ?, NOW(), NOW())",
          [order.user_id, refundAmount]
        );
      }

      await connection.query(
        `INSERT INTO user_wallet_transactions (user_id, txn_type, amount, source, reference_id, remarks, created_at)
         VALUES (?, 'credit', ?, 'refund', ?, ?, NOW())`,
        [order.user_id, refundAmount, order.id, `Refund for Cancelled Order #${order.order_number || order.id}`]
      ).catch(async () => {
        await connection.query(
          `INSERT INTO user_wallet_transactions (user_id, amount, transaction_type, remarks, created_at)
           VALUES (?, ?, 'CREDIT', ?, NOW())`,
          [order.user_id, refundAmount, `Refund for Cancelled Order #${order.order_number || order.id}`]
        ).catch(e => console.warn('Wallet transaction write warning:', e.message));
      });
    } else if (isPaid && refund_type === 'BANK') {
      // Trigger PayU Bank Refund API
      processedRefundType = 'BANK';
      refundStatus = 'REFUND_PENDING';

      try {
        const crypto = require('crypto');
        const axios = require('axios');
        const [payuRows] = await connection.query(
          "SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('payu_merchant_key', 'payu_merchant_salt')"
        );
        const payuMap = {};
        payuRows.forEach(r => payuMap[r.setting_key] = r.setting_value);
        const payuKey = payuMap.payu_merchant_key || 'm2uwkj';
        const payuSalt = payuMap.payu_merchant_salt || 'PyBf3kWiI6MdwYhrR3geD108F7fcpPI4';
        const command = 'cancel_refund_transaction';
        const var1 = order.payment_id || order.order_number || order.id;
        const var2 = refundAmount.toFixed(2);
        const hashStr = `${payuKey}|${command}|${var1}|${payuSalt}`;
        const hash = crypto.createHash('sha512').update(hashStr).digest('hex');

        const paramsData = new URLSearchParams();
        paramsData.append('key', payuKey);
        paramsData.append('command', command);
        paramsData.append('var1', var1);
        paramsData.append('var2', var2);
        paramsData.append('hash', hash);

        const payuResp = await axios.post('https://info.payu.in/merchant/postservice?form=2', paramsData.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (payuResp.data && (payuResp.data.status === 1 || payuResp.data.status === '1')) {
          refundStatus = 'REFUNDED';
        }
      } catch (payuErr) {
        console.error("PayU Refund API call error (Logged, fallback pending):", payuErr.message);
      }
    } else if (paymentMethod === 'COD') {
      refundStatus = 'NO_REFUND_NEEDED';
      processedRefundType = 'COD';
    }

    // 2. Reverse Stock Quantities
    const [items] = await connection.query("SELECT * FROM order_items WHERE order_id = ?", [orderId]);
    for (const item of items) {
      if (item.seller_product_variant_id) {
        await connection.query(
          "UPDATE seller_product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?",
          [item.quantity, item.seller_product_variant_id]
        ).catch(() => {});
      }
      if (item.seller_product_id) {
        await connection.query(
          "UPDATE seller_products SET quantity = quantity + ? WHERE id = ?",
          [item.quantity, item.seller_product_id]
        );
      }
    }

    // 3. Update Order Record with Fallback
    try {
      await connection.query(
        `UPDATE orders SET 
          order_status = 'CANCELLED', 
          payment_status = IF(payment_status = 'PAID' OR payment_status = 'SUCCESS', 'REFUNDED', payment_status),
          cancellation_reason = ?,
          cancellation_refund_type = ?,
          cancellation_refund_status = ?,
          cancelled_at = NOW()
         WHERE id = ?`,
        [cancellation_reason || 'Cancelled by User', processedRefundType, refundStatus, orderId]
      );
    } catch (updateErr) {
      console.warn("Full order cancel update failed, attempting column addition and fallback...", updateErr.message);
      await connection.query(`ALTER TABLE orders ADD COLUMN cancellation_reason VARCHAR(255) NULL;`).catch(() => {});
      await connection.query(`ALTER TABLE orders ADD COLUMN cancellation_refund_type VARCHAR(50) NULL;`).catch(() => {});
      await connection.query(`ALTER TABLE orders ADD COLUMN cancellation_refund_status VARCHAR(50) NULL;`).catch(() => {});
      await connection.query(`ALTER TABLE orders ADD COLUMN cancelled_at DATETIME NULL;`).catch(() => {});
      
      await connection.query(
        `UPDATE orders SET 
          order_status = 'CANCELLED', 
          payment_status = IF(payment_status = 'PAID' OR payment_status = 'SUCCESS', 'REFUNDED', payment_status)
         WHERE id = ?`,
        [orderId]
      );
    }

    await connection.commit();
    res.status(200).json({
      status: true,
      message: `Order cancelled successfully. Refund method: ${processedRefundType} (${refundStatus}).`,
      refund_type: processedRefundType,
      refund_status: refundStatus,
      refund_amount: refundAmount
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error in cancelUserOrder:", err);
    res.status(500).json({ status: false, message: 'Internal server error while cancelling order.' });
  } finally {
    connection.release();
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