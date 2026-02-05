const db = require('../../db');
const Order = require('../Models/orderModel');
const OrderItem = require('../Models/orderItemModel.js');
const Address = require('../Models/userAddressModel.js');

const notificationService = require('../utils/notificationService.js');
const commissionService = require('../Services/commissionService'); // <-- ADD THIS IMPORT

// Helper function to generate a unique order number
const generateOrderNumber = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const randomPart = Math.random().toString(36).substr(2, 6).toUpperCase();
    return `ORD-${year}${month}${day}-${randomPart}`;
};



// Workign for cod
// exports.createOrder = async (req, res) => {
//     const userId = req.user.id;
//     // const userId = 1;

//     console.log("Call hua")

//     const { shippingAddressId, paymentMethod } = req.body;

//     if (!shippingAddressId || !paymentMethod) {
//         return res.status(400).json({ status: false, message: 'Shipping address and payment method are required.' });
//     }

//     const connection = await db.getConnection();
//     try {
//         await connection.beginTransaction();

//         // 1. Get user's cart items
//         const [cart] = await connection.query('SELECT id FROM carts WHERE user_id = ?', [userId]);
//         if (!cart[0]) {
//             await connection.rollback();
//             return res.status(404).json({ status: false, message: 'Cart not found.' });
//         }
//         const cartId = cart[0].id;
        
//         const itemQuery = `
//             SELECT 
//                 ci.quantity, sp.id as seller_product_id, p.id as product_id, p.name as product_name,
//                 sp.selling_price, sp.purchase_price, h.gst_percentage, u.sponsor_id
//             FROM cart_items ci
//             JOIN seller_products sp ON ci.seller_product_id = sp.id
//             JOIN products p ON sp.product_id = p.id
//             JOIN users u ON u.id = ?
//             LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
//             WHERE ci.cart_id = ? FOR UPDATE;
//         `;
//         const [items] = await connection.query(itemQuery, [userId, cartId]);

//         if (items.length === 0) {
//             await connection.rollback();
//             return res.status(400).json({ status: false, message: 'Your cart is empty.' });
//         }

//         // 2. Fetch all settings
//         const [settingsRows] = await connection.query("SELECT setting_key, setting_value FROM app_settings");
//         const settings = settingsRows.reduce((acc, setting) => {
//             acc[setting.setting_key] = parseFloat(setting.setting_value);
//             return acc;
//         }, {});
        
//         const bvGenerationPct = settings.bv_generation_pct_of_profit || 80.0;
//         const bvThreshold = settings.delivery_fee_bv_threshold || 50.0;
//         const standardFee = settings.delivery_fee_standard || 40.0;
//         const specialFee = settings.delivery_fee_special !== undefined ? settings.delivery_fee_special : 0.0;

//         // 3. Pre-calculate totals
//         let calculatedTotalBv = 0;
//         for (const item of items) {
//             const basePrice = item.selling_price / (1 + ((item.gst_percentage || 0) / 100));
//             const netProfit = basePrice - item.purchase_price;
//             const bvEarnedPerUnit = (netProfit > 0) ? netProfit * (bvGenerationPct / 100) : 0;
//             calculatedTotalBv += bvEarnedPerUnit * item.quantity;
//         }

//         const deliveryFee = (calculatedTotalBv >= bvThreshold) ? specialFee : standardFee;
//         const finalSubtotal = items.reduce((sum, item) => sum + (item.selling_price * item.quantity), 0);
//         const totalAmount = finalSubtotal + deliveryFee;

//         // 5. Handle Wallet Payment
//         if (paymentMethod === 'WALLET') {
//             const [walletRows] = await connection.query('SELECT balance FROM user_wallet WHERE user_id = ? FOR UPDATE', [userId]);
//             if (!walletRows[0] || walletRows[0].balance < totalAmount) {
//                 await connection.rollback();
//                 return res.status(400).json({ status: false, message: "Insufficient wallet balance." });
//             }
//             await connection.query('UPDATE user_wallet SET balance = balance - ? WHERE user_id = ?', [totalAmount, userId]);
//         }
        
//         // 6. Create the main order record
//         const orderNumber = generateOrderNumber();
//         const paymentStatus = (paymentMethod === 'WALLET') ? 'COMPLETED' : 'PENDING';
//         const orderStatus = (paymentMethod === 'ONLINE') ? 'PENDING_PAYMENT' : 'CONFIRMED';
        
//         const orderSql = `INSERT INTO orders (user_id, shipping_address_id, order_number, subtotal, delivery_fee, total_amount, total_bv_earned, payment_method, payment_status, order_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
//         const [orderResult] = await connection.query(orderSql, [userId, shippingAddressId, orderNumber, finalSubtotal, deliveryFee, totalAmount, calculatedTotalBv, paymentMethod, paymentStatus, orderStatus]);
//         const orderId = orderResult.insertId;

//         // 7. Loop through items to save, distribute earnings, and check stock
//         for (const item of items) {
//             // Step 7a: Decrease stock
//             const [updateResult] = await connection.query(
//                 'UPDATE seller_products SET quantity = quantity - ? WHERE id = ? AND quantity >= ?', 
//                 [item.quantity, item.seller_product_id, item.quantity]
//             );
            
//             // If stock update fails, something is wrong, so we stop.
//             if (updateResult.affectedRows === 0) {
//                 throw new Error(`Critical error: Insufficient stock for product ID ${item.seller_product_id} during final processing.`);
//             }
            
//             // ==========================================================
//             // === THE FIX IS HERE ===
//             // ==========================================================
//             // Step 7b: After stock is successfully decreased, trigger the notification check.
//             await notificationService.checkStockAndNotify(item.seller_product_id, connection);
//             // ==========================================================

//             // Step 7c: Calculate earnings and create order item record
//             const basePrice = item.selling_price / (1 + ((item.gst_percentage || 0) / 100));
//             const netProfit = basePrice - item.purchase_price;
//             const bvEarnedPerUnit = (netProfit > 0) ? netProfit * (bvGenerationPct / 100) : 0;
            
//             const orderItemSql = `INSERT INTO order_items (order_id, product_id, seller_product_id, product_name, quantity, price_per_unit, total_price, bv_earned_per_unit, total_bv_earned) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
//             const [orderItemResult] = await connection.query(orderItemSql, [orderId, item.product_id, item.seller_product_id, item.product_name, item.quantity, item.selling_price, item.selling_price * item.quantity, bvEarnedPerUnit, bvEarnedPerUnit * item.quantity]);
            
//             // Step 7d: Distribute earnings if applicable
//             if (paymentMethod === 'WALLET' && netProfit > 0) {
//                 await distributeEarnings(connection, { userId, sponsorId: item.sponsor_id, orderItemId: orderItemResult.insertId, productId: item.product_id, netProfit, settings });
//             }
//         }
        
//         // 8. Clean up the cart
//         await connection.query('DELETE FROM cart_items WHERE cart_id = ?', [cartId]);

//         // 9. Prepare response
//         let responseData = { orderId, orderNumber, totalAmount };
//         if (paymentMethod === 'ONLINE') {
//             // Payment gateway logic would go here
//         }
        
//         await connection.commit();
//         res.status(201).json({ status: true, message: 'Order placed successfully!', data: responseData });
//     } catch (error) {
//         await connection.rollback();
//         console.error("Error creating order:", error);
//         res.status(500).json({ status: false, message: error.message || 'Failed to place order.' });
//     } finally {
//         if (connection) {
//             connection.release();
//         }
//     }
// };








//  Working without attribut that is working properly

// exports.createOrder = async (req, res) => {
//     const userId = req.user.id;
//     const { shippingAddressId, paymentMethod } = req.body;

//     if (!shippingAddressId || !paymentMethod) {
//         return res.status(400).json({ status: false, message: 'Shipping address and payment method are required.' });
//     }

//     const connection = await db.getConnection();
//     try {
//         await connection.beginTransaction();

//         // 1. Get user's cart items
//         const [cart] = await connection.query('SELECT id FROM carts WHERE user_id = ?', [userId]);
//         if (!cart[0]) {
//             await connection.rollback();
//             return res.status(404).json({ status: false, message: 'Cart not found.' });
//         }
//         const cartId = cart[0].id;
        
//         const itemQuery = `
//             SELECT 
//                 ci.quantity, sp.id as seller_product_id, p.id as product_id, p.name as product_name,
//                 sp.selling_price, sp.purchase_price, h.gst_percentage, u.sponsor_id, sp.quantity as stock_available
//             FROM cart_items ci
//             JOIN seller_products sp ON ci.seller_product_id = sp.id
//             JOIN products p ON sp.product_id = p.id
//             JOIN users u ON u.id = ?
//             LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
//             WHERE ci.cart_id = ? FOR UPDATE;
//         `;
//         const [items] = await connection.query(itemQuery, [userId, cartId]);

//         if (items.length === 0) {
//             await connection.rollback();
//             return res.status(400).json({ status: false, message: 'Your cart is empty.' });
//         }

//         // 2. Validate Stock before proceeding
//         for (const item of items) {
//             if (item.quantity > item.stock_available) {
//                 await connection.rollback();
//                 return res.status(400).json({ status: false, message: `Insufficient stock for ${item.product_name}` });
//             }
//         }

//         // 3. Fetch Settings & Calculate Totals
//         const [settingsRows] = await connection.query("SELECT setting_key, setting_value FROM app_settings");
//         const settings = settingsRows.reduce((acc, setting) => {
//             acc[setting.setting_key] = parseFloat(setting.setting_value);
//             return acc;
//         }, {});
        
//         const bvGenerationPct = settings.bv_generation_pct_of_profit || 80.0;
//         const bvThreshold = settings.delivery_fee_bv_threshold || 50.0;
//         const standardFee = settings.delivery_fee_standard || 40.0;
//         const specialFee = settings.delivery_fee_special || 0.0;

//         let calculatedTotalBv = 0;
//         for (const item of items) {
//             const basePrice = item.selling_price / (1 + ((item.gst_percentage || 0) / 100));
//             const netProfit = basePrice - item.purchase_price;
//             const bvEarnedPerUnit = (netProfit > 0) ? netProfit * (bvGenerationPct / 100) : 0;
//             calculatedTotalBv += bvEarnedPerUnit * item.quantity;
//         }

//         const deliveryFee = (calculatedTotalBv >= bvThreshold) ? specialFee : standardFee;
//         const finalSubtotal = items.reduce((sum, item) => sum + (item.selling_price * item.quantity), 0);
//         const totalAmount = finalSubtotal + deliveryFee;

//         // 4. Handle Wallet Payment (Immediate Deduction)
//         if (paymentMethod === 'WALLET') {
//             const [walletRows] = await connection.query('SELECT balance FROM user_wallets WHERE user_id = ? FOR UPDATE', [userId]);
//             if (!walletRows[0] || walletRows[0].balance < totalAmount) {
//                 await connection.rollback();
//                 return res.status(400).json({ status: false, message: "Insufficient wallet balance." });
//             }
//             await connection.query('UPDATE user_wallets SET balance = balance - ? WHERE user_id = ?', [totalAmount, userId]);
//         }
        
//         // 5. Determine Order Status
//         const orderNumber = generateOrderNumber();
//         let paymentStatus = 'PENDING';
//         let orderStatus = 'PENDING'; // Default

//         if (paymentMethod === 'WALLET') {
//             paymentStatus = 'COMPLETED';
//             orderStatus = 'CONFIRMED';
//         } else if (paymentMethod === 'COD') {
//             paymentStatus = 'PENDING';
//             orderStatus = 'CONFIRMED';
//         } else if (paymentMethod === 'ONLINE') {
//             paymentStatus = 'PENDING';
//             orderStatus = 'PENDING_PAYMENT'; // Special status for Online
//         }
        
//         // 6. Create Order Header
//         const orderSql = `INSERT INTO orders (user_id, shipping_address_id, order_number, subtotal, delivery_fee, total_amount, total_bv_earned, payment_method, payment_status, order_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
//         const [orderResult] = await connection.query(orderSql, [userId, shippingAddressId, orderNumber, finalSubtotal, deliveryFee, totalAmount, calculatedTotalBv, paymentMethod, paymentStatus, orderStatus]);
//         const orderId = orderResult.insertId;

//         // 7. Insert Order Items & Handle Stock
//         for (const item of items) {
            
//             // A. ALWAYS Insert Line Item
//             const basePrice = item.selling_price / (1 + ((item.gst_percentage || 0) / 100));
//             const netProfit = basePrice - item.purchase_price;
//             const bvEarnedPerUnit = (netProfit > 0) ? netProfit * (bvGenerationPct / 100) : 0;
            
//             const orderItemSql = `INSERT INTO order_items (order_id, product_id, seller_product_id, product_name, quantity, price_per_unit, total_price, bv_earned_per_unit, total_bv_earned) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
//             const [orderItemResult] = await connection.query(orderItemSql, [orderId, item.product_id, item.seller_product_id, item.product_name, item.quantity, item.selling_price, item.selling_price * item.quantity, bvEarnedPerUnit, bvEarnedPerUnit * item.quantity]);
            
//             // B. Stock Deduction Logic
//             // For ONLINE payments, some systems reserve stock now, others wait for success.
//             // Here we deduct immediately to prevent overselling. If payment fails, we can add back.
//             const [updateResult] = await connection.query(
//                 'UPDATE seller_products SET quantity = quantity - ? WHERE id = ? AND quantity >= ?', 
//                 [item.quantity, item.seller_product_id, item.quantity]
//             );
            
//             if (updateResult.affectedRows === 0) {
//                 throw new Error(`Stock mismatch for product ${item.seller_product_id}`);
//             }

//             // C. Trigger Low Stock Notification
//             await notificationService.checkStockAndNotify(item.seller_product_id, connection);

//             // D. Distribute Earnings (ONLY for Wallet/COD immediately)
//             // For ONLINE, we wait until payment success webhook/callback
//             if ((paymentMethod === 'WALLET' || paymentMethod === 'COD') && netProfit > 0) {
//                 await distributeEarnings(connection, { userId, sponsorId: item.sponsor_id, orderItemId: orderItemResult.insertId, productId: item.product_id, netProfit, settings });
//             }
//         }
        
//         // 8. Clean up cart (Only if confirmed or pending payment)
//         await connection.query('DELETE FROM cart_items WHERE cart_id = ?', [cartId]);

//         await connection.commit();

//         // 9. Response
//         // For ONLINE, the frontend needs 'orderId' to initiate the payment gateway flow
//         res.status(201).json({ 
//             status: true, 
//             message: paymentMethod === 'ONLINE' ? 'Order initiated, proceed to payment.' : 'Order placed successfully!', 
//             data: { orderId, orderNumber, totalAmount } 
//         });

//     } catch (error) {
//         await connection.rollback();
//         console.error("Error creating order:", error);
//         res.status(500).json({ status: false, message: error.message || 'Failed to place order.' });
//     } finally {
//         if (connection) connection.release();
//     }
// };





// /**
//  * A helper function to handle the distribution of earnings.
//  * This is now ONLY called for transactions where payment is confirmed.
//  */
// async function distributeEarnings(connection, { userId, sponsorId, orderItemId, netProfit, settings }) {
//     const companySharePct = settings.profit_company_share_pct || 20.0;
//     const cashbackPct = settings.profit_dist_cashback_pct || 0;
//     const sponsorPct = settings.profit_dist_sponsor_pct || 0;

//     const distributableProfit = netProfit * ((100 - companySharePct) / 100);
    
//     if (cashbackPct > 0) {
//         const cashbackAmount = distributableProfit * (cashbackPct / 100);
//         await connection.query(`INSERT INTO profit_distribution_ledger (order_item_id, user_id, distribution_type, total_profit_on_item, distributable_amount, percentage_applied, amount_credited) VALUES (?, ?, 'CASHBACK', ?, ?, ?, ?)`, [orderItemId, userId, netProfit, distributableProfit, cashbackPct, cashbackAmount]);
//         await connection.query('UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?', [cashbackAmount, userId]);
//     }

//     if (sponsorId && sponsorPct > 0) {
//         const sponsorBonusAmount = distributableProfit * (sponsorPct / 100);
//         await connection.query(`INSERT INTO profit_distribution_ledger (order_item_id, user_id, distribution_type, total_profit_on_item, distributable_amount, percentage_applied, amount_credited) VALUES (?, ?, 'SPONSOR_BONUS', ?, ?, ?, ?)`, [orderItemId, sponsorId, netProfit, distributableProfit, sponsorPct, sponsorBonusAmount]);
//         await connection.query('UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?', [sponsorBonusAmount, sponsorId]);
//     }
// }







//  Testing with attributes


exports.createOrder = async (req, res) => {
    const userId = req.user.id;
    const { shippingAddressId, paymentMethod } = req.body;

    if (!shippingAddressId || !paymentMethod) {
        return res.status(400).json({ status: false, message: 'Shipping address and payment method are required.' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get user's cart items
        const [cart] = await connection.query('SELECT id FROM carts WHERE user_id = ?', [userId]);
        if (!cart[0]) throw new Error('Cart not found.');
        
        const cartId = cart[0].id;
        const itemQuery = `
            SELECT 
                ci.quantity, sp.id as seller_product_id, p.id as product_id, p.name as product_name,
                sp.selling_price, sp.purchase_price, h.gst_percentage, u.sponsor_id, sp.quantity as stock_available
            FROM cart_items ci
            JOIN seller_products sp ON ci.seller_product_id = sp.id
            JOIN products p ON sp.product_id = p.id
            JOIN users u ON u.id = ?
            LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
            WHERE ci.cart_id = ? FOR UPDATE;
        `;
        const [items] = await connection.query(itemQuery, [userId, cartId]);

        if (items.length === 0) throw new Error('Your cart is empty.');

        // 2. Fetch Settings
        const [settingsRows] = await connection.query("SELECT setting_key, setting_value FROM app_settings");
        const settings = settingsRows.reduce((acc, setting) => {
            acc[setting.setting_key] = parseFloat(setting.setting_value);
            return acc;
        }, {});
        
        const bvGenerationPct = settings.bv_generation_pct_of_profit || 80.0;
        const bvThreshold = settings.delivery_fee_bv_threshold || 50.0;
        const standardFee = settings.delivery_fee_standard || 40.0;
        const specialFee = settings.delivery_fee_special || 0.0;

        // 3. Calculate Totals
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

        // 4. Create Order Header
        const orderNumber = `ORD-${Date.now()}`;
        let orderStatus = (paymentMethod === 'ONLINE') ? 'PENDING_PAYMENT' : 'CONFIRMED';
        let paymentStatus = (paymentMethod === 'WALLET') ? 'COMPLETED' : 'PENDING';

        const orderSql = `INSERT INTO orders (user_id, shipping_address_id, order_number, subtotal, delivery_fee, total_amount, total_bv_earned, payment_method, payment_status, order_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const [orderResult] = await connection.query(orderSql, [userId, shippingAddressId, orderNumber, finalSubtotal, deliveryFee, totalAmount, calculatedTotalBv, paymentMethod, paymentStatus, orderStatus]);
        const orderId = orderResult.insertId;

        // 5. Loop Items: Snapshot Attributes + Stock + Distribute Earnings
        for (const item of items) {
            
            // A. Create Attribute Snapshot (FIXED JOIN LOGIC)
            // Note: Join attributes (a) through attribute_values (av)
            const [attrRows] = await connection.query(`
                SELECT a.name as attr_key, av.value as attr_value
                FROM product_attributes pa
                JOIN attribute_values av ON pa.attribute_value_id = av.id
                JOIN attributes a ON av.attribute_id = a.id
                WHERE pa.product_id = ?`, [item.product_id]);

            const snapshot = {};
            attrRows.forEach(row => { snapshot[row.attr_key] = row.attr_value; });

            // B. Calculate Profit for MLM
            const basePrice = item.selling_price / (1 + ((item.gst_percentage || 0) / 100));
            const netProfitOnItem = (basePrice - item.purchase_price) * item.quantity;

            // C. Insert Order Item
            const orderItemSql = `INSERT INTO order_items (order_id, product_id, seller_product_id, product_name, attributes_snapshot, quantity, price_per_unit, total_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
            const [itemResult] = await connection.query(orderItemSql, [
                orderId, item.product_id, item.seller_product_id, item.product_name, 
                JSON.stringify(snapshot), 
                item.quantity, item.selling_price, item.selling_price * item.quantity
            ]);

            // D. Stock Deduction
            await connection.query('UPDATE seller_products SET quantity = quantity - ? WHERE id = ?', [item.quantity, item.seller_product_id]);

            // E. Distribute Earnings (Wallet/COD)
            if ((paymentMethod === 'WALLET' || paymentMethod === 'COD') && netProfitOnItem > 0) {
                await distributeEarnings(connection, { 
                    userId, 
                    sponsorId: item.sponsor_id, 
                    orderItemId: itemResult.insertId, 
                    netProfit: netProfitOnItem, 
                    settings 
                });
            }
        }

        // 6. Final Wallet Deduction
        if (paymentMethod === 'WALLET') {
            const [w] = await connection.query('SELECT balance FROM user_wallets WHERE user_id = ? FOR UPDATE', [userId]);
            if (w[0].balance < totalAmount) throw new Error("Insufficient wallet balance.");
            await connection.query('UPDATE user_wallets SET balance = balance - ? WHERE user_id = ?', [totalAmount, userId]);
        }
        
        await connection.query('DELETE FROM cart_items WHERE cart_id = ?', [cartId]);
        await connection.commit();

        res.status(201).json({ status: true, message: 'Order Placed!', data: { orderId, orderNumber, totalAmount } });

    } catch (error) {
        await connection.rollback();
        console.error("Order Creation Error:", error.message);
        res.status(500).json({ status: false, message: error.message });
    } finally {
        connection.release();
    }
};

/**
 * Robust Earnings Distribution
 */
async function distributeEarnings(connection, { userId, sponsorId, orderItemId, netProfit, settings }) {
    const companySharePct = settings.profit_company_share_pct || 20.0;
    const cashbackPct = settings.profit_dist_cashback_pct || 0;
    const sponsorPct = settings.profit_dist_sponsor_pct || 0;

    const distributableProfit = netProfit * ((100 - companySharePct) / 100);
    
    if (cashbackPct > 0) {
        const cashbackAmount = distributableProfit * (cashbackPct / 100);
        await connection.query(`INSERT INTO profit_distribution_ledger (order_item_id, user_id, distribution_type, total_profit_on_item, distributable_amount, percentage_applied, amount_credited) VALUES (?, ?, 'CASHBACK', ?, ?, ?, ?)`, [orderItemId, userId, netProfit, distributableProfit, cashbackPct, cashbackAmount]);
        await connection.query('UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?', [cashbackAmount, userId]);
    }

    if (sponsorId && sponsorPct > 0) {
        const sponsorBonusAmount = distributableProfit * (sponsorPct / 100);
        await connection.query(`INSERT INTO profit_distribution_ledger (order_item_id, user_id, distribution_type, total_profit_on_item, distributable_amount, percentage_applied, amount_credited) VALUES (?, ?, 'SPONSOR_BONUS', ?, ?, ?, ?)`, [orderItemId, sponsorId, netProfit, distributableProfit, sponsorPct, sponsorBonusAmount]);
        await connection.query('UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?', [sponsorBonusAmount, sponsorId]);
    }
}









// ==========================================================
// === GET / - Fetches a paginated list of user's orders  ===
// ==========================================================
exports.getOrderHistory = async (req, res) => {
    const userId = req.user.id;
    // const userId = 1;

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;

    try {
        // Query to get the paginated list of orders
        const dataQuery = `
            SELECT * FROM orders 
            WHERE user_id = ? 
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `;
        const [orderRows] = await db.query(dataQuery, [userId, limit, offset]);
        
        // Query to get the total count of orders for pagination
        const countQuery = `SELECT COUNT(*) as total FROM orders WHERE user_id = ?`;
        const [countRows] = await db.query(countQuery, [userId]);
        const totalRecords = countRows[0].total;

        // For each order, fetch the first item's image to show in the list
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
    // const userId = 1;

    const { orderId } = req.params;

    try {
        // 1. Fetch the main order details
        const orderQuery = `SELECT * FROM orders WHERE id = ? AND user_id = ?`;
        const [orderRows] = await db.query(orderQuery, [orderId, userId]);
        if (orderRows.length === 0) {
            return res.status(404).json({ status: false, message: 'Order not found.' });
        }
        
        // 2. Fetch the shipping address details for this order
        const addressQuery = `SELECT * FROM user_addresses WHERE id = ?`;
        const [addressRows] = await db.query(addressQuery, [orderRows[0].shipping_address_id]);

        // 3. Fetch all line items for this order
        const itemsQuery = `
            SELECT oi.*, p.main_image_url 
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = ?
        `;
        const [itemRows] = await db.query(itemsQuery, [orderId]);

        // 4. Construct the final response object using our Models
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

        // ✅ LOGIC: If switching to COD, we set status to CONFIRMED immediately.
        // If Online, it stays PENDING (until payment callback).
        let newStatus = 'PENDING'; 
        if (paymentMethod === 'COD') {
            newStatus = 'CONFIRMED'; 
        }

        // ✅ SQL: Update both 'payment_method' AND 'order_status'
        // (Assuming your DB column is 'order_status'. If it is 'status', change it below)
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
            data: { order_status: newStatus } // Return new status
        });

    } catch (error) {
        console.error('Error updating payment method:', error);
        res.status(500).json({ status: false, message: 'Server error' });
    }
};