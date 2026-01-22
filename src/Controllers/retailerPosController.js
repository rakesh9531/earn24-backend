const db = require('../../db');
const moment = require('moment-timezone');

const getISTTime = () => moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

// Helper to fetch global settings (BV %)
const getAppSettings = async (connection) => {
    const [rows] = await connection.query("SELECT setting_key, setting_value FROM app_settings");
    return rows.reduce((acc, setting) => {
        acc[setting.setting_key] = parseFloat(setting.setting_value);
        return acc;
    }, {});
};

/**
 * 1. SEARCH CUSTOMER BY MOBILE
 */
exports.searchCustomer = async (req, res) => {
    try {
        const { mobile } = req.query;
        // Search in your main 'users' table
        const [users] = await db.query(
            'SELECT * FROM users WHERE mobile_number = ? AND is_active = 1', 
            [mobile]
        );

        if (users.length > 0) {
            res.json({ status: true, found: true, customer: users[0] });
        } else {
            res.json({ status: true, found: false, message: 'User not registered.' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: 'Server error' });
    }
};

// /**
//  * 2. PROCESS SALE (Create Order & Deduct Stock)
//  */
// exports.createOrder = async (req, res) => {
//     const connection = await db.getConnection();
//     try {
//         await connection.beginTransaction();

//         const retailerId = req.retailer.id;
//         const { customer_id, customer_name, customer_mobile, items, payment_mode, total_amount } = req.body;

//         const now = getISTTime();

//         // A. Insert Order Header
//         const orderSql = `
//             INSERT INTO retailer_orders 
//             (retailer_id, user_id, customer_name, customer_mobile, total_amount, payment_mode, payment_status, created_at)
//             VALUES (?, ?, ?, ?, ?, ?, 'PAID', ?)
//         `;
//         const [orderResult] = await connection.query(orderSql, [
//             retailerId, 
//             customer_id || null, // Null if guest
//             customer_name || 'Walk-in Customer', 
//             customer_mobile, 
//             total_amount, 
//             payment_mode, 
//             now
//         ]);
//         const orderId = orderResult.insertId;

//         // B. Loop Items: Insert Line Item & Deduct Stock
//         for (const item of items) {
//             // 1. Check Stock
//             const [inventory] = await connection.query(
//                 'SELECT stock_quantity FROM retailer_inventory WHERE retailer_id = ? AND product_id = ? FOR UPDATE',
//                 [retailerId, item.product_id]
//             );

//             if (inventory.length === 0 || inventory[0].stock_quantity < item.quantity) {
//                 throw new Error(`Insufficient stock for product ID: ${item.product_id}`);
//             }

//             // 2. Insert Item
//             await connection.query(
//                 `INSERT INTO retailer_order_items (order_id, product_id, quantity, price, total) VALUES (?, ?, ?, ?, ?)`,
//                 [orderId, item.product_id, item.quantity, item.price, item.quantity * item.price]
//             );

//             // 3. Deduct Stock
//             await connection.query(
//                 `UPDATE retailer_inventory SET stock_quantity = stock_quantity - ? WHERE retailer_id = ? AND product_id = ?`,
//                 [item.quantity, retailerId, item.product_id]
//             );
//         }

//         await connection.commit();
//         res.json({ status: true, message: 'Order placed successfully!', orderId });

//     } catch (error) {
//         await connection.rollback();
//         console.error('POS Order Error:', error);
//         res.status(500).json({ status: false, message: error.message || 'Transaction failed' });
//     } finally {
//         connection.release();
//     }
// };




// exports.createOrder = async (req, res) => {
//     const connection = await db.getConnection();
//     try {
//         await connection.beginTransaction();

//         const retailerId = req.retailer.id;
//         const { customer_id, customer_name, customer_mobile, items, payment_mode, total_amount } = req.body;
//         const now = getISTTime();

//         // 1. Fetch Settings (BV Calculation Percentage)
//         const settings = await getAppSettings(connection);
//         const bvGenerationPct = settings.bv_generation_pct_of_profit || 80.0; // Default to 80% if not set

//         let totalOrderBV = 0; // To track total BV for the registered user

//         // 2. Insert Order Header
//         const orderSql = `
//             INSERT INTO retailer_orders 
//             (retailer_id, user_id, customer_name, customer_mobile, total_amount, payment_mode, payment_status, created_at)
//             VALUES (?, ?, ?, ?, ?, ?, 'PAID', ?)
//         `;
//         const [orderResult] = await connection.query(orderSql, [
//             retailerId, 
//             customer_id || null, 
//             customer_name || 'Walk-in Customer', 
//             customer_mobile, 
//             total_amount, 
//             payment_mode, 
//             now
//         ]);
//         const orderId = orderResult.insertId;

//         // 3. Process Items (Deduct Stock & Calculate BV)
//         for (const item of items) {
            
//             // A. Fetch Stock + Pricing Info needed for BV Calculation
//             // We join seller_products to get 'purchase_price' and hsn_codes for 'gst'
//             const [productData] = await connection.query(`
//                 SELECT 
//                     ri.stock_quantity,
//                     sp.purchase_price,
//                     h.gst_percentage
//                 FROM retailer_inventory ri
//                 JOIN products p ON ri.product_id = p.id
//                 LEFT JOIN seller_products sp ON p.id = sp.product_id
//                 LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
//                 WHERE ri.retailer_id = ? AND ri.product_id = ?
//                 LIMIT 1 FOR UPDATE
//             `, [retailerId, item.product_id]);

//             if (productData.length === 0 || productData[0].stock_quantity < item.quantity) {
//                 throw new Error(`Insufficient stock for Product ID: ${item.product_id}`);
//             }

//             const prod = productData[0];
            
//             // --- BV CALCULATION LOGIC (Same as Online) ---
//             const sellingPrice = parseFloat(item.price); // Retailer's selling price
//             const quantity = parseFloat(item.quantity);
//             const purchasePrice = parseFloat(prod.purchase_price || 0);
//             const gstPercent = parseFloat(prod.gst_percentage || 0);

//             // 1. Calculate Base Price (Removing Tax)
//             const basePrice = sellingPrice / (1 + (gstPercent / 100));

//             // 2. Calculate Net Profit
//             const netProfit = basePrice - purchasePrice;

//             // 3. Calculate BV (Only if profit is positive)
//             let bvPerUnit = 0;
//             if (netProfit > 0) {
//                 bvPerUnit = netProfit * (bvGenerationPct / 100);
//             }
            
//             const lineTotalBV = bvPerUnit * quantity;
//             totalOrderBV += lineTotalBV;
//             // ---------------------------------------------

//             // B. Insert Order Item (With BV details)
//             await connection.query(
//                 `INSERT INTO retailer_order_items 
//                 (order_id, product_id, quantity, price, total, bv_earned, total_bv) 
//                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
//                 [
//                     orderId, 
//                     item.product_id, 
//                     quantity, 
//                     sellingPrice, 
//                     (sellingPrice * quantity), 
//                     bvPerUnit, 
//                     lineTotalBV
//                 ]
//             );

//             // C. Deduct Stock
//             await connection.query(
//                 `UPDATE retailer_inventory SET stock_quantity = stock_quantity - ? WHERE retailer_id = ? AND product_id = ?`,
//                 [quantity, retailerId, item.product_id]
//             );
//         }

//         // 4. Credit BV to User (Only if Registered User)
//         if (customer_id && totalOrderBV > 0) {
//             // A. Add to User's Aggregate BV (For Ranks)
//             await connection.query(
//                 `UPDATE users SET aggregate_personal_bv = aggregate_personal_bv + ? WHERE id = ?`,
//                 [totalOrderBV, customer_id]
//             );

//             // B. Add entry to Business Volume Ledger
//             await connection.query(
//                 `INSERT INTO user_business_volume 
//                 (user_id, bv_earned, transaction_type, description, order_id, transaction_date) 
//                 VALUES (?, ?, 'CREDIT', ?, ?, ?)`,
//                 [
//                     customer_id, 
//                     totalOrderBV, 
//                     `Retail Purchase (Inv #${orderId})`, 
//                     orderId, 
//                     now
//                 ]
//             );
//         }

//         await connection.commit();
        
//         res.json({ 
//             status: true, 
//             message: 'Order placed successfully!', 
//             orderId,
//             bvEarned: customer_id ? totalOrderBV : 0 
//         });

//     } catch (error) {
//         await connection.rollback();
//         console.error('POS Order Error:', error);
//         res.status(500).json({ status: false, message: error.message || 'Transaction failed' });
//     } finally {
//         connection.release();
//     }
// };

exports.createOrder = async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const settings = await getAppSettings(connection);
        const globalBvPercent = settings['bv_generation_pct_of_profit'] || 0; 

        const retailerId = req.retailer.id;
        const { customer_id, customer_name, customer_mobile, items, payment_mode, total_amount } = req.body;
        const now = getISTTime();
        let orderTotalBV = 0; 

        // 1. Insert Order Header
        const [orderResult] = await connection.query(
            `INSERT INTO retailer_orders 
            (retailer_id, user_id, customer_name, customer_mobile, total_amount, payment_mode, payment_status, total_bv, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'PAID', 0, ?)`,
            [retailerId, customer_id || null, customer_name || 'Walk-in', customer_mobile, total_amount, payment_mode, now]
        );
        const orderId = orderResult.insertId;

        // 2. Loop Items
        for (const item of items) {
            // A. Fetch Stock, Prices, and GST to calculate Profit
            // FIX: Added sp.purchase_price and h.gst_percentage
            const [productData] = await connection.query(`
                SELECT 
                    ri.stock_quantity, 
                    ri.selling_price as retailer_sell_price, -- Retailer's Price
                    sp.purchase_price,                       -- Cost Price
                    h.gst_percentage                         -- GST for Net Calc
                FROM retailer_inventory ri
                JOIN products p ON ri.product_id = p.id
                LEFT JOIN seller_products sp ON p.id = sp.product_id
                LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
                WHERE ri.retailer_id = ? AND ri.product_id = ? FOR UPDATE`, 
                [retailerId, item.product_id]
            );

            if (productData.length === 0) throw new Error(`Product ID ${item.product_id} not found.`);
            
            const currentStock = productData[0].stock_quantity;
            
            // --- B. BV CALCULATION LOGIC (PROFIT BASED) ---
            const sellPrice = parseFloat(productData[0].retailer_sell_price || 0);
            const purchasePrice = parseFloat(productData[0].purchase_price || 0);
            const gst = parseFloat(productData[0].gst_percentage || 0);

            // 1. Base Price (Remove Tax)
            const baseSellingPrice = sellPrice / (1 + (gst / 100));
            
            // 2. Net Profit
            let profit = baseSellingPrice - purchasePrice;
            if (profit < 0) profit = 0;

            // 3. Unit BV (80% of Profit)
            const unitBV = profit * (globalBvPercent / 100);
            const totalItemBV = unitBV * item.quantity;
            // ----------------------------------------------

            if (currentStock < item.quantity) throw new Error(`Insufficient stock for Product ID: ${item.product_id}`);

            // C. Insert Line Item (Store calculated Unit BV)
            const [itemResult] = await connection.query(
                `INSERT INTO retailer_order_items (order_id, product_id, quantity, price, total, bv_earned, total_bv) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [orderId, item.product_id, item.quantity, item.price, item.quantity * item.price, unitBV, totalItemBV]
            );
            const orderItemId = itemResult.insertId;

            // D. Deduct Stock
            await connection.query(
                `UPDATE retailer_inventory SET stock_quantity = stock_quantity - ? WHERE retailer_id = ? AND product_id = ?`,
                [item.quantity, retailerId, item.product_id]
            );

            // E. Add Ledger Entry
            if (customer_id && totalItemBV > 0) {
                await connection.query(
                    `INSERT INTO user_business_volume (user_id, order_item_id, product_id, net_profit_base, bv_earned, transaction_date, notes) VALUES (?, ?, ?, 0, ?, ?, ?)`,
                    [customer_id, orderItemId, item.product_id, totalItemBV, now, `POS Sale #${orderId}`]
                );
            }
            orderTotalBV += totalItemBV;
        }

        // 3. Update Header
        await connection.query(`UPDATE retailer_orders SET total_bv = ? WHERE id = ?`, [orderTotalBV, orderId]);

        // 4. Update User Aggregate
        if (customer_id && orderTotalBV > 0) {
            await connection.query(
                `UPDATE users SET aggregate_personal_bv = aggregate_personal_bv + ?, last_12_months_repurchase_bv = last_12_months_repurchase_bv + ? WHERE id = ?`,
                [orderTotalBV, orderTotalBV, customer_id]
            );
        }

        await connection.commit();
        res.json({ status: true, message: 'Order placed!', orderId });

    } catch (error) {
        await connection.rollback();
        console.error('POS Error:', error);
        res.status(500).json({ status: false, message: error.message });
    } finally {
        connection.release();
    }
};




// exports.createOrder = async (req, res) => {
//     const connection = await db.getConnection();
//     try {
//         await connection.beginTransaction();

//         // 1. Get Global Settings
//         const settings = await getAppSettings(connection);
        
//         // --- KEY FIX: Using 'bv_generation_pct_of_profit' ---
//         const globalBvPercent = settings['bv_generation_pct_of_profit'] || 0; 

//         const retailerId = req.retailer.id;
//         const { customer_id, customer_name, customer_mobile, items, payment_mode, total_amount } = req.body;

//         const now = getISTTime();
//         let orderTotalBV = 0; 

//         // 2. Insert Order Header
//         const orderSql = `
//             INSERT INTO retailer_orders 
//             (retailer_id, user_id, customer_name, customer_mobile, total_amount, payment_mode, payment_status, total_bv, created_at)
//             VALUES (?, ?, ?, ?, ?, ?, 'PAID', 0, ?)
//         `;
//         const [orderResult] = await connection.query(orderSql, [
//             retailerId, 
//             customer_id || null, 
//             customer_name || 'Walk-in Customer', 
//             customer_mobile, 
//             total_amount, 
//             payment_mode, 
//             now
//         ]);
//         const orderId = orderResult.insertId;

//         // 3. Loop Items
//         for (const item of items) {
//             // A. Get Stock & Base Price (Distributor Price)
//             const [productData] = await connection.query(`
//                 SELECT 
//                     ri.stock_quantity, 
//                     sp.selling_price as distributor_price 
//                 FROM retailer_inventory ri
//                 JOIN products p ON ri.product_id = p.id
//                 LEFT JOIN seller_products sp ON p.id = sp.product_id
//                 WHERE ri.retailer_id = ? AND ri.product_id = ? FOR UPDATE`, 
//                 [retailerId, item.product_id]
//             );

//             if (productData.length === 0) throw new Error(`Product ID ${item.product_id} not found.`);
            
//             const currentStock = productData[0].stock_quantity;
//             const distributorPrice = parseFloat(productData[0].distributor_price || 0);

//             if (currentStock < item.quantity) throw new Error(`Insufficient stock for Product ID: ${item.product_id}`);

//             // --- B. CALCULATE DYNAMIC BV ---
//             // Formula: Price * (80 / 100)
//             const unitBV = distributorPrice * (globalBvPercent / 100);
//             const totalItemBV = unitBV * item.quantity;

//             // C. Insert Line Item
//             const [itemResult] = await connection.query(
//                 `INSERT INTO retailer_order_items 
//                 (order_id, product_id, quantity, price, total, bv_earned, total_bv) 
//                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
//                 [orderId, item.product_id, item.quantity, item.price, item.quantity * item.price, unitBV, totalItemBV]
//             );
            
//             const orderItemId = itemResult.insertId; 

//             // D. Deduct Stock
//             await connection.query(
//                 `UPDATE retailer_inventory SET stock_quantity = stock_quantity - ? WHERE retailer_id = ? AND product_id = ?`,
//                 [item.quantity, retailerId, item.product_id]
//             );

//             // E. Add to 'user_business_volume' (MLM Logic)
//             if (customer_id && totalItemBV > 0) {
//                 await connection.query(
//                     `INSERT INTO user_business_volume 
//                     (user_id, order_item_id, product_id, net_profit_base, bv_earned, transaction_date, notes) 
//                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
//                     [
//                         customer_id,
//                         orderItemId,
//                         item.product_id,
//                         0,                  
//                         totalItemBV,       
//                         now,
//                         `Retailer POS (Shop ID: ${retailerId}) - ${globalBvPercent}% BV`
//                     ]
//                 );
//             }

//             orderTotalBV += totalItemBV;
//         }

//         // 4. Update Order Header Total BV
//         await connection.query(`UPDATE retailer_orders SET total_bv = ? WHERE id = ?`, [orderTotalBV, orderId]);

//         // 5. Update User's Aggregate BV (For Rank Advancement)
//         if (customer_id && orderTotalBV > 0) {
//             await connection.query(
//                 `UPDATE users 
//                  SET aggregate_personal_bv = aggregate_personal_bv + ?,
//                      last_12_months_repurchase_bv = last_12_months_repurchase_bv + ?
//                  WHERE id = ?`,
//                 [orderTotalBV, orderTotalBV, customer_id]
//             );
//         }

//         await connection.commit();
//         res.json({ status: true, message: 'Order placed & BV credited!', orderId });

//     } catch (error) {
//         await connection.rollback();
//         console.error('POS Order Error:', error);
//         res.status(500).json({ status: false, message: error.message || 'Transaction failed' });
//     } finally {
//         connection.release();
//     }
// };







// exports.getInvoiceDetails = async (req, res) => {
//     try {
//         const { order_id } = req.params;
//         const retailerId = req.retailer.id;

//         // 1. Get Header (Order Details + Retailer Info + Customer Info)
//         const headerSql = `
//             SELECT 
//                 o.id as invoice_no, 
//                 o.created_at as date, 
//                 o.customer_name, 
//                 o.customer_mobile, 
//                 o.payment_mode,
//                 r.shop_name, 
//                 r.owner_name, 
//                 r.shop_address, 
//                 r.pincode, 
//                 r.phone_number as retailer_phone,
//                 r.gst_number as retailer_gst
//             FROM retailer_orders o
//             JOIN retailers r ON o.retailer_id = r.id
//             WHERE o.id = ? AND o.retailer_id = ?
//         `;
//         const [header] = await db.query(headerSql, [order_id, retailerId]);

//         if (header.length === 0) {
//             return res.status(404).json({ status: false, message: 'Order not found' });
//         }

//         // 2. Get Items + JOIN Products + JOIN HSN Codes
//         const itemsSql = `
//             SELECT 
//                 roi.product_id,
//                 p.name as product_name,
//                 hc.hsn_code,           -- Fetched from hsn_codes table
//                 hc.gst_percentage,     -- Fetched from hsn_codes table
//                 roi.quantity,
//                 roi.price as unit_price, -- This is the Selling Price (Inclusive of Tax)
//                 roi.total
//             FROM retailer_order_items roi
//             JOIN products p ON roi.product_id = p.id
//             LEFT JOIN hsn_codes hc ON p.hsn_code_id = hc.id -- The link you provided
//             WHERE roi.order_id = ?
//         `;
//         const [items] = await db.query(itemsSql, [order_id]);

//         res.json({ 
//             status: true, 
//             data: { ...header[0], items } 
//         });

//     } catch (error) {
//         console.error('getInvoiceDetails error:', error);
//         res.status(500).json({ status: false, message: 'Server error' });
//     }
// };





// exports.getInvoiceDetails = async (req, res) => {
//     try {
//         const { order_id } = req.params;
//         const retailerId = req.retailer.id;

//         // 1. Header
//         const headerSql = `
//             SELECT 
//                 o.id as invoice_no, 
//                 o.created_at as date, 
//                 o.customer_name, 
//                 o.customer_mobile, 
//                 o.payment_mode,
//                 o.user_id, -- Needed to check if registered
//                 r.shop_name, 
//                 r.owner_name, 
//                 r.shop_address, 
//                 r.pincode, 
//                 r.phone_number as retailer_phone,
//                 r.gst_number as retailer_gst
//             FROM retailer_orders o
//             JOIN retailers r ON o.retailer_id = r.id
//             WHERE o.id = ? AND o.retailer_id = ?
//         `;
//         const [header] = await db.query(headerSql, [order_id, retailerId]);

//         if (header.length === 0) {
//             return res.status(404).json({ status: false, message: 'Order not found' });
//         }

//         // 2. Items (Now fetching actual stored BV)
//         const itemsSql = `
//             SELECT 
//                 roi.product_id,
//                 p.name as product_name,
//                 hc.hsn_code,
//                 hc.gst_percentage,
//                 roi.quantity,
//                 roi.price as unit_price,
//                 roi.total,
//                 roi.bv_earned as unit_bv, -- Fetched from DB
//                 roi.total_bv             -- Fetched from DB
//             FROM retailer_order_items roi
//             JOIN products p ON roi.product_id = p.id
//             LEFT JOIN hsn_codes hc ON p.hsn_code_id = hc.id
//             WHERE roi.order_id = ?
//         `;
//         const [items] = await db.query(itemsSql, [order_id]);

//         res.json({ 
//             status: true, 
//             data: { ...header[0], items } 
//         });

//     } catch (error) {
//         console.error('getInvoiceDetails error:', error);
//         res.status(500).json({ status: false, message: 'Server error' });
//     }
// };




/**
 * 4. GET INVOICE DATA (For Print & Return)
 * FIX: Added returned_quantity and bv_earned
 */
exports.getInvoiceDetails = async (req, res) => {
    try {
        const { order_id } = req.params;
        const retailerId = req.retailer.id;

        const [order] = await db.query(`SELECT * FROM retailer_orders WHERE id = ? AND retailer_id = ?`, [order_id, retailerId]);
        if (order.length === 0) return res.status(404).json({ status: false, message: 'Order not found' });

        const [items] = await db.query(
            `SELECT 
                roi.id as item_id,
                roi.product_id,
                p.name as product_name,
                h.hsn_code,
                h.gst_percentage,
                roi.quantity,
                roi.returned_quantity,
                roi.price as unit_price,
                roi.bv_earned,
                roi.total
             FROM retailer_order_items roi
             JOIN products p ON roi.product_id = p.id
             LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
             WHERE roi.order_id = ?`,
            [order_id]
        );

        const invoiceData = {
            ...order[0],
            retailer_phone: req.retailer.phone_number,
            shop_name: req.retailer.shop_name,
            shop_address: req.retailer.shop_address,
            pincode: req.retailer.pincode,
            retailer_gst: req.retailer.gst_number,
            date: order[0].created_at,
            items: items
        };

        res.json({ status: true, data: invoiceData });

    } catch (error) {
        console.error('Invoice Error:', error);
        res.status(500).json({ status: false, message: 'Server error' });
    }
};


/**
 * 4. GET SALES HISTORY (With Filters & Pagination)
 */
exports.getSalesHistory = async (req, res) => {
    try {
        const retailerId = req.retailer.id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const { search, startDate, endDate } = req.query;

        // Base Conditions
        let conditions = ['retailer_id = ?'];
        let params = [retailerId];

        // Search Filter (Invoice ID, Customer Name, or Mobile)
        if (search) {
            conditions.push('(id LIKE ? OR customer_name LIKE ? OR customer_mobile LIKE ?)');
            const term = `%${search}%`;
            params.push(term, term, term);
        }

        // Date Range Filter
        if (startDate && endDate) {
            conditions.push('DATE(created_at) BETWEEN ? AND ?');
            params.push(startDate, endDate);
        }

        const whereClause = 'WHERE ' + conditions.join(' AND ');

        // 1. Count Total
        const countSql = `SELECT COUNT(*) as total FROM retailer_orders ${whereClause}`;
        const [countRows] = await db.query(countSql, params);
        const totalItems = countRows[0].total;
        const totalPages = Math.ceil(totalItems / limit);

        // 2. Fetch Data
        const sql = `
            SELECT id, customer_name, customer_mobile, total_amount, payment_mode, total_bv, created_at 
            FROM retailer_orders 
            ${whereClause}
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `;
        
        const [orders] = await db.query(sql, [...params, limit, offset]);

        res.json({
            status: true,
            data: orders,
            pagination: { currentPage: page, totalPages, totalItems, limit }
        });

    } catch (error) {
        console.error('getSalesHistory error:', error);
        res.status(500).json({ status: false, message: 'Server error' });
    }
};


exports.getDashboardStats = async (req, res) => {
    try {
        const retailerId = req.retailer.id;
        
        // 1. Get Date Range (Default to This Month if missing)
        let { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            startDate = moment().tz('Asia/Kolkata').startOf('month').format('YYYY-MM-DD');
            endDate = moment().tz('Asia/Kolkata').endOf('month').format('YYYY-MM-DD');
        }

        // Add time to ensure we cover the whole day
        const startFull = `${startDate} 00:00:00`;
        const endFull = `${endDate} 23:59:59`;

        const dateFilter = `AND o.created_at >= ? AND o.created_at <= ?`;
        const params = [retailerId, startFull, endFull];

        // --- A. KEY METRICS ---
        const [stats] = await db.query(
            `SELECT 
                COALESCE(SUM(total_amount), 0) as total_revenue,
                COUNT(*) as total_orders,
                COALESCE(SUM(total_amount) / NULLIF(COUNT(*),0), 0) as avg_order_value
             FROM retailer_orders o 
             WHERE retailer_id = ? ${dateFilter}`, 
            params
        );

        // --- B. PAYMENT SPLIT ---
        const [payments] = await db.query(
            `SELECT payment_mode, COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount 
             FROM retailer_orders o 
             WHERE retailer_id = ? ${dateFilter} 
             GROUP BY payment_mode`,
            params
        );

        // --- C. SALES GRAPH ---
        const [graphData] = await db.query(
            `SELECT DATE(created_at) as date, SUM(total_amount) as total 
             FROM retailer_orders o
             WHERE retailer_id = ? ${dateFilter}
             GROUP BY DATE(created_at) 
             ORDER BY date ASC`,
            params
        );

        // --- D. TOP 5 SELLING PRODUCTS ---
        // Fixed: p.main_image_url
        const [topProducts] = await db.query(
            `SELECT 
                p.name, 
                p.main_image_url, 
                SUM(roi.quantity) as sold_qty, 
                SUM(roi.total) as revenue
             FROM retailer_order_items roi
             JOIN retailer_orders o ON roi.order_id = o.id
             JOIN products p ON roi.product_id = p.id
             WHERE o.retailer_id = ? ${dateFilter}
             GROUP BY roi.product_id
             ORDER BY sold_qty DESC
             LIMIT 5`,
            params
        );

        // --- E. INVENTORY (Snapshot, not filtered by date) ---
        const [inventory] = await db.query(
            `SELECT 
                COUNT(*) as total_items, 
                SUM(stock_quantity * selling_price) as total_value,
                SUM(CASE WHEN stock_quantity < 5 THEN 1 ELSE 0 END) as low_stock
             FROM retailer_inventory WHERE retailer_id = ?`,
            [retailerId]
        );

        res.json({
            status: true,
            data: {
                metrics: stats[0],
                payments: payments,
                graph: graphData,
                top_products: topProducts,
                inventory: {
                    total_items: inventory[0].total_items || 0,
                    total_value: inventory[0].total_value || 0,
                    low_stock: inventory[0].low_stock || 0
                }
            }
        });

    } catch (error) {
        console.error('Dashboard Error:', error);
        res.status(500).json({ status: false, message: 'Server Error' });
    }
};


/**
 * 5. GET DASHBOARD STATS (Total Sales & Total BV)
 */
exports.getSalesStats = async (req, res) => {
    try {
        const retailerId = req.retailer.id;
        const { startDate, endDate } = req.query;

        let whereClause = 'WHERE retailer_id = ?';
        let params = [retailerId];

        if (startDate && endDate) {
            whereClause += ' AND DATE(created_at) BETWEEN ? AND ?';
            params.push(startDate, endDate);
        }

        const sql = `
            SELECT 
                COUNT(*) as total_orders,
                COALESCE(SUM(total_amount), 0) as total_revenue,
                COALESCE(SUM(total_bv), 0) as total_bv_generated
            FROM retailer_orders
            ${whereClause}
        `;

        const [stats] = await db.query(sql, params);

        res.json({
            status: true,
            data: stats[0]
        });

    } catch (error) {
        console.error('getSalesStats error:', error);
        res.status(500).json({ status: false, message: 'Server error' });
    }
};




/**
 * 6. PROCESS RETURN / REFUND
 */
// exports.processReturn = async (req, res) => {
//     const connection = await db.getConnection();
//     try {
//         await connection.beginTransaction();

//         const { orderId, itemsToReturn } = req.body; 
//         const retailerId = req.retailer.id;
//         const now = getISTTime();

//         // 1. Fetch Order Details
//         const [order] = await connection.query('SELECT user_id FROM retailer_orders WHERE id = ? AND retailer_id = ?', [orderId, retailerId]);
        
//         if (order.length === 0) throw new Error("Order not found");
//         const customerId = order[0].user_id;

//         let totalRefundBV = 0;

//         // 2. Loop through items to return
//         for (const item of itemsToReturn) {
//             const returnQty = parseInt(item.quantity);
//             if (returnQty <= 0) continue;

//             // A. Fetch original line item data
//             // We need 'id' (order_item_id) for the ledger reference
//             const [lineItem] = await connection.query(
//                 'SELECT id, quantity, returned_quantity, bv_earned FROM retailer_order_items WHERE order_id = ? AND product_id = ?',
//                 [orderId, item.product_id]
//             );

//             if (lineItem.length === 0) continue;

//             const orderItemId = lineItem[0].id;
//             const originalQty = lineItem[0].quantity;
//             const alreadyReturned = lineItem[0].returned_quantity;
//             const unitBV = parseFloat(lineItem[0].bv_earned);

//             // Validation
//             if (alreadyReturned + returnQty > originalQty) {
//                 throw new Error(`Cannot return ${returnQty} items. Max returnable: ${originalQty - alreadyReturned}`);
//             }

//             // B. Update 'returned_quantity' in Order Items
//             await connection.query(
//                 'UPDATE retailer_order_items SET returned_quantity = returned_quantity + ? WHERE id = ?',
//                 [returnQty, orderItemId]
//             );

//             // C. Restock Inventory
//             await connection.query(
//                 'UPDATE retailer_inventory SET stock_quantity = stock_quantity + ? WHERE retailer_id = ? AND product_id = ?',
//                 [returnQty, retailerId, item.product_id]
//             );

//             // D. Calculate BV to deduct for this specific item
//             const itemRefundBV = unitBV * returnQty;
//             totalRefundBV += itemRefundBV;

//             // E. Add NEGATIVE entry to 'user_business_volume' (Per Item History)
//             if (customerId && itemRefundBV > 0) {
//                 await connection.query(
//                     `INSERT INTO user_business_volume 
//                     (user_id, order_item_id, product_id, net_profit_base, bv_earned, transaction_date, notes) 
//                     VALUES (?, ?, ?, 0, ?, ?, ?)`,
//                     [
//                         customerId,
//                         orderItemId,
//                         item.product_id,
//                         -itemRefundBV, // NEGATIVE BV
//                         now,
//                         `Return/Refund for Order #${orderId}`
//                     ]
//                 );
//             }
//         }

//         // 3. Deduct Total BV from User's Aggregate
//         if (customerId && totalRefundBV > 0) {
//             await connection.query(
//                 `UPDATE users 
//                  SET aggregate_personal_bv = aggregate_personal_bv - ?,
//                      last_12_months_repurchase_bv = last_12_months_repurchase_bv - ?
//                  WHERE id = ?`,
//                 [totalRefundBV, totalRefundBV, customerId]
//             );
//         }

//         await connection.commit();
//         res.json({ status: true, message: 'Return processed successfully. Stock updated & BV deducted.' });

//     } catch (error) {
//         await connection.rollback();
//         console.error('Process Return Error:', error);
//         res.status(500).json({ status: false, message: error.message || 'Server error' });
//     } finally {
//         connection.release();
//     }
// };






exports.processReturn = async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const { orderId, itemsToReturn } = req.body; 
        const retailerId = req.retailer.id;
        const now = getISTTime();

        // 1. Validate Order
        const [order] = await connection.query('SELECT user_id FROM retailer_orders WHERE id = ? AND retailer_id = ?', [orderId, retailerId]);
        if (order.length === 0) throw new Error("Order not found");
        const customerId = order[0].user_id;

        let totalRefundBV = 0;
        let totalRefundAmount = 0; // Track Amount to deduct

        // 2. Process Items
        for (const item of itemsToReturn) {
            const returnQty = parseInt(item.quantity);
            if (returnQty <= 0) continue;

            const [lineItem] = await connection.query(
                'SELECT id, quantity, returned_quantity, bv_earned, price FROM retailer_order_items WHERE order_id = ? AND product_id = ?',
                [orderId, item.product_id]
            );

            if (lineItem.length === 0) continue;

            const orderItemId = lineItem[0].id;
            const originalQty = lineItem[0].quantity;
            const alreadyReturned = lineItem[0].returned_quantity;
            const unitBV = parseFloat(lineItem[0].bv_earned);
            const unitPrice = parseFloat(lineItem[0].price);

            if (alreadyReturned + returnQty > originalQty) {
                throw new Error(`Cannot return ${returnQty}. Max: ${originalQty - alreadyReturned}`);
            }

            // A. Update Item Table
            await connection.query(
                'UPDATE retailer_order_items SET returned_quantity = returned_quantity + ? WHERE id = ?',
                [returnQty, orderItemId]
            );

            // B. Restock Inventory
            await connection.query(
                'UPDATE retailer_inventory SET stock_quantity = stock_quantity + ? WHERE retailer_id = ? AND product_id = ?',
                [returnQty, retailerId, item.product_id]
            );

            // C. Calculate Refund Values
            const itemRefundBV = unitBV * returnQty;
            const itemRefundAmount = unitPrice * returnQty;
            
            totalRefundBV += itemRefundBV;
            totalRefundAmount += itemRefundAmount;

            // D. Add Negative BV Ledger Entry (Per Item)
            if (customerId && itemRefundBV > 0) {
                await connection.query(
                    `INSERT INTO user_business_volume 
                    (user_id, order_item_id, product_id, net_profit_base, bv_earned, transaction_date, notes) 
                    VALUES (?, ?, ?, 0, ?, ?, ?)`,
                    [customerId, orderItemId, item.product_id, -itemRefundBV, now, `Return for Order #${orderId}`]
                );
            }
        }

        // 3. UPDATE ORDER HEADER (Crucial Step for UI History)
        await connection.query(
            `UPDATE retailer_orders 
             SET total_amount = total_amount - ?, 
                 total_bv = total_bv - ? 
             WHERE id = ?`,
            [totalRefundAmount, totalRefundBV, orderId]
        );

        // 4. Deduct User Aggregate BV
        if (customerId && totalRefundBV > 0) {
            await connection.query(
                `UPDATE users 
                 SET aggregate_personal_bv = aggregate_personal_bv - ?,
                     last_12_months_repurchase_bv = last_12_months_repurchase_bv - ?
                 WHERE id = ?`,
                [totalRefundBV, totalRefundBV, customerId]
            );
        }

        await connection.commit();
        res.json({ status: true, message: 'Return processed. Order updated.' });

    } catch (error) {
        await connection.rollback();
        console.error('Process Return Error:', error);
        res.status(500).json({ status: false, message: error.message });
    } finally {
        connection.release();
    }
};