// const db = require('../../db');
// const moment = require('moment-timezone');

// const getISTTime = () => moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

// /**
//  * 1. SEARCH GLOBAL PRODUCTS
//  * Updates:
//  * - Joins with 'seller_products' (sp) to get MRP and SKU.
//  * - Uses GROUP BY p.id because multiple sellers might sell the same product.
//  */
// exports.searchMasterProducts = async (req, res) => {
//     try {
//         const { search = '' } = req.query;
//         const retailerId = req.retailer.id;
//         const term = `%${search}%`;

//         const sql = `
//             SELECT 
//                 p.id, 
//                 p.name, 
//                 p.main_image_url as image_url,
//                 -- We pick the maximum MRP found in seller listings as a reference
//                 MAX(sp.mrp) as mrp,
//                 MAX(sp.sku) as sku,
//                 ri.id as inventory_id,
//                 CASE WHEN ri.id IS NOT NULL THEN 1 ELSE 0 END as is_in_inventory
//             FROM products p
//             -- Join to get MRP/SKU info
//             LEFT JOIN seller_products sp ON p.id = sp.product_id
//             -- Join to check if retailer already has it
//             LEFT JOIN retailer_inventory ri ON p.id = ri.product_id AND ri.retailer_id = ?
//             WHERE p.is_active = 1 AND p.is_deleted = 0
//             AND (p.name LIKE ?) 
//             GROUP BY p.id
//             ORDER BY p.id DESC
//             LIMIT 20
//         `;

//         const [products] = await db.query(sql, [retailerId, term]);

//         // Map to handle potential nulls if a product has no seller yet
//         const mappedProducts = products.map(p => ({
//             ...p,
//             mrp: p.mrp || 0,
//             sku: p.sku || 'N/A'
//         }));

//         res.status(200).json({ status: true, data: mappedProducts });

//     } catch (error) {
//         console.error('searchMasterProducts error:', error);
//         res.status(500).json({ status: false, message: 'Server error' });
//     }
// };

// /**
//  * 2. ADD PRODUCT TO INVENTORY
//  * (No changes needed here, logic remains the same)
//  */
// exports.addToInventory = async (req, res) => {
//     try {
//         const { product_id, stock_quantity, selling_price } = req.body;
//         const retailerId = req.retailer.id;

//         if (!product_id || !selling_price) {
//             return res.status(400).json({ status: false, message: 'Product ID and Selling Price are required.' });
//         }

//         const now = getISTTime();

//         const sql = `
//             INSERT INTO retailer_inventory 
//             (retailer_id, product_id, stock_quantity, selling_price, is_active, created_at, updated_at)
//             VALUES (?, ?, ?, ?, 1, ?, ?)
//             ON DUPLICATE KEY UPDATE
//             stock_quantity = stock_quantity + VALUES(stock_quantity),
//             selling_price = VALUES(selling_price),
//             updated_at = VALUES(updated_at)
//         `;

//         await db.query(sql, [retailerId, product_id, stock_quantity || 0, selling_price, now, now]);

//         res.status(200).json({ status: true, message: 'Product added to your inventory successfully.' });

//     } catch (error) {
//         console.error('addToInventory error:', error);
//         res.status(500).json({ status: false, message: 'Server error' });
//     }
// };

// /**
//  * 3. GET MY SHOP INVENTORY
//  * Updates:
//  * - Joins 'seller_products' to display the original MRP reference
//  */
// exports.getMyInventory = async (req, res) => {
//     try {
//         const retailerId = req.retailer.id;
//         const { search = '' } = req.query;

//         let sql = `
//             SELECT 
//                 ri.id as inventory_id,
//                 ri.stock_quantity,
//                 ri.selling_price,
//                 ri.is_active,
//                 p.name as product_name,
//                 p.main_image_url as image_url,
//                 MAX(sp.mrp) as mrp,
//                 MAX(sp.sku) as sku
//             FROM retailer_inventory ri
//             JOIN products p ON ri.product_id = p.id
//             LEFT JOIN seller_products sp ON p.id = sp.product_id
//             WHERE ri.retailer_id = ?
//         `;

//         const params = [retailerId];

//         if (search) {
//             sql += ` AND (p.name LIKE ?)`;
//             params.push(`%${search}%`);
//         }

//         sql += ` GROUP BY ri.id ORDER BY ri.updated_at DESC`;

//         const [inventory] = await db.query(sql, params);

//         const mappedInventory = inventory.map(item => ({
//             ...item,
//             mrp: item.mrp || 0,
//             sku: item.sku || 'N/A'
//         }));

//         res.status(200).json({ status: true, data: mappedInventory });

//     } catch (error) {
//         console.error('getMyInventory error:', error);
//         res.status(500).json({ status: false, message: 'Server error' });
//     }
// };

// /**
//  * 4. UPDATE STOCK OR PRICE
//  * (No changes needed here)
//  */
// exports.updateInventoryItem = async (req, res) => {
//     try {
//         const { inventory_id } = req.params;
//         const { stock_quantity, selling_price, is_active } = req.body;
//         const retailerId = req.retailer.id;

//         const fields = [];
//         const values = [];

//         if (stock_quantity !== undefined) {
//             fields.push('stock_quantity = ?');
//             values.push(stock_quantity);
//         }
//         if (selling_price !== undefined) {
//             fields.push('selling_price = ?');
//             values.push(selling_price);
//         }
//         if (is_active !== undefined) {
//             fields.push('is_active = ?');
//             values.push(is_active);
//         }

//         if (fields.length === 0) return res.status(400).json({ status: false, message: 'No fields to update' });

//         const now = getISTTime();
//         fields.push('updated_at = ?');
//         values.push(now);

//         values.push(inventory_id, retailerId);

//         const sql = `UPDATE retailer_inventory SET ${fields.join(', ')} WHERE id = ? AND retailer_id = ?`;

//         const [result] = await db.query(sql, values);

//         if (result.affectedRows === 0) {
//             return res.status(404).json({ status: false, message: 'Item not found in your inventory.' });
//         }

//         res.status(200).json({ status: true, message: 'Inventory updated.' });

//     } catch (error) {
//         console.error('updateInventoryItem error:', error);
//         res.status(500).json({ status: false, message: 'Server error' });
//     }
// };






const db = require('../../db');
const moment = require('moment-timezone');

const getISTTime = () => moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');


const getAppSettings = async (connection) => {
    const [rows] = await connection.query("SELECT setting_key, setting_value FROM app_settings");
    return rows.reduce((acc, setting) => {
        acc[setting.setting_key] = parseFloat(setting.setting_value);
        return acc;
    }, {});
};

/**
 * 1. SEARCH GLOBAL PRODUCTS (With Pagination & Distributor Price)
 */
exports.searchMasterProducts = async (req, res) => {
    try {
        // Pagination Params
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        
        const { search = '' } = req.query;
        const retailerId = req.retailer.id;
        const term = `%${search}%`;

        // 1. Count Total Distinct Products
        const countSql = `
            SELECT COUNT(DISTINCT p.id) as total
            FROM products p
            WHERE p.is_active = 1 AND p.is_deleted = 0 AND (p.name LIKE ?)
        `;
        const [countRows] = await db.query(countSql, [term]);
        const totalItems = countRows[0].total;
        const totalPages = Math.ceil(totalItems / limit);

        // 2. Fetch Data
        // - We join 'seller_products' to get MRP/SKU/Distributor Price
        // - 'sp.selling_price' is the PRICE THE RETAILER BUYS AT (Distributor Price)
        const sql = `
            SELECT 
                p.id, 
                p.name, 
                p.main_image_url as image_url,
                MAX(sp.mrp) as mrp,
                MAX(sp.selling_price) as distributor_price,
                MAX(sp.sku) as sku,
                ri.id as inventory_id,
                CASE WHEN ri.id IS NOT NULL THEN 1 ELSE 0 END as is_in_inventory
            FROM products p
            LEFT JOIN seller_products sp ON p.id = sp.product_id
            LEFT JOIN retailer_inventory ri ON p.id = ri.product_id AND ri.retailer_id = ?
            WHERE p.is_active = 1 AND p.is_deleted = 0
            AND (p.name LIKE ?) 
            GROUP BY p.id
            ORDER BY p.id DESC
            LIMIT ? OFFSET ?
        `;

        const [products] = await db.query(sql, [retailerId, term, limit, offset]);

        const mappedProducts = products.map(p => ({
            ...p,
            mrp: p.mrp || 0,
            distributor_price: p.distributor_price || 0,
            sku: p.sku || 'N/A'
        }));

        res.status(200).json({ 
            status: true, 
            data: mappedProducts,
            pagination: { currentPage: page, totalPages, totalItems, limit } 
        });

    } catch (error) {
        console.error('searchMasterProducts error:', error);
        res.status(500).json({ status: false, message: 'Server error' });
    }
};

/**
 * 2. ADD PRODUCT TO INVENTORY
 */
exports.addToInventory = async (req, res) => {
    try {
        const { product_id, stock_quantity, selling_price } = req.body;
        const retailerId = req.retailer.id;

        if (!product_id || !selling_price) {
            return res.status(400).json({ status: false, message: 'Product and Price are required.' });
        }

        const now = getISTTime();

        // Upsert: Insert or Update if exists
        const sql = `
            INSERT INTO retailer_inventory 
            (retailer_id, product_id, stock_quantity, selling_price, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?)
            ON DUPLICATE KEY UPDATE
            stock_quantity = stock_quantity + VALUES(stock_quantity),
            selling_price = VALUES(selling_price),
            updated_at = VALUES(updated_at)
        `;

        await db.query(sql, [retailerId, product_id, stock_quantity || 0, selling_price, now, now]);

        res.status(200).json({ status: true, message: 'Added to inventory.' });

    } catch (error) {
        console.error('addToInventory error:', error);
        res.status(500).json({ status: false, message: 'Server error' });
    }
};

/**
 * 3. GET MY INVENTORY (With Pagination)
 */
// exports.getMyInventory = async (req, res) => {
//     try {
//         const page = parseInt(req.query.page) || 1;
//         const limit = parseInt(req.query.limit) || 10;
//         const offset = (page - 1) * limit;
        
//         const retailerId = req.retailer.id;
//         const { search = '' } = req.query;
//         const term = `%${search}%`;

//         // 1. Count Total
//         const countSql = `
//             SELECT COUNT(*) as total 
//             FROM retailer_inventory ri
//             JOIN products p ON ri.product_id = p.id
//             WHERE ri.retailer_id = ? AND (p.name LIKE ?)
//         `;
//         const [countRows] = await db.query(countSql, [retailerId, term]);
//         const totalItems = countRows[0].total;
//         const totalPages = Math.ceil(totalItems / limit);

//         // 2. Fetch Data
//         // 'ri.selling_price' is the RETAILER'S SELLING PRICE
//         // let sql = `
//         //     SELECT 
//         //         ri.id as inventory_id,
//         //         ri.stock_quantity,
//         //         ri.selling_price as my_price,
//         //         ri.is_active,
//         //         p.name as product_name,
//         //         p.main_image_url as image_url,
//         //         MAX(sp.mrp) as mrp,
//         //         MAX(sp.selling_price) as distributor_price,
//         //         MAX(sp.sku) as sku
//         //     FROM retailer_inventory ri
//         //     JOIN products p ON ri.product_id = p.id
//         //     LEFT JOIN seller_products sp ON p.id = sp.product_id
//         //     WHERE ri.retailer_id = ?
//         //     AND (p.name LIKE ?)
//         //     GROUP BY ri.id
//         //     ORDER BY ri.updated_at DESC
//         //     LIMIT ? OFFSET ?
//         // `;


//         let sql = `
//             SELECT 
//                 p.id as product_id,  -- <--- ADD THIS LINE (Crucial Fix)
//                 ri.id as inventory_id,
//                 ri.stock_quantity,
//                 ri.selling_price as my_price,
//                 ri.is_active,
//                 p.name as product_name,
//                 p.main_image_url as image_url,
//                 MAX(sp.mrp) as mrp,
//                 MAX(sp.selling_price) as distributor_price,
//                 MAX(sp.sku) as sku
//             FROM retailer_inventory ri
//             JOIN products p ON ri.product_id = p.id
//             LEFT JOIN seller_products sp ON p.id = sp.product_id
//             WHERE ri.retailer_id = ?
//             AND (p.name LIKE ?)
//             GROUP BY ri.id
//             ORDER BY ri.updated_at DESC
//             LIMIT ? OFFSET ?
//         `;

//         const [inventory] = await db.query(sql, [retailerId, term, limit, offset]);

//         const mappedInventory = inventory.map(item => ({
//             ...item,
//             mrp: item.mrp || 0,
//             distributor_price: item.distributor_price || 0,
//             sku: item.sku || 'N/A'
//         }));

//         res.status(200).json({ 
//             status: true, 
//             data: mappedInventory,
//             pagination: { currentPage: page, totalPages, totalItems, limit }
//         });

//     } catch (error) {
//         console.error('getMyInventory error:', error);
//         res.status(500).json({ status: false, message: 'Server error' });
//     }
// };






exports.getMyInventory = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        const retailerId = req.retailer.id;
        const { search = '' } = req.query;
        const term = `%${search}%`;

        // 1. Settings
        const settings = await getAppSettings(connection);
        const globalBvPercent = settings['bv_generation_pct_of_profit'] || 0; 

        // 2. Count
        const countSql = `
            SELECT COUNT(*) as total 
            FROM retailer_inventory ri
            JOIN products p ON ri.product_id = p.id
            WHERE ri.retailer_id = ? AND (p.name LIKE ?)
        `;
        const [countRows] = await connection.query(countSql, [retailerId, term]);
        const totalItems = countRows[0].total;
        const totalPages = Math.ceil(totalItems / limit);

        // 3. Fetch Data
        let sql = `
            SELECT 
                p.id as product_id,
                ri.id as inventory_id,
                ri.stock_quantity,
                ri.selling_price as my_price,
                ri.is_active,
                p.name as product_name,
                p.main_image_url as image_url,
                MAX(sp.mrp) as mrp,
                MAX(sp.selling_price) as distributor_price,
                MAX(sp.purchase_price) as purchase_price,
                MAX(h.gst_percentage) as gst_percentage,
                MAX(sp.sku) as sku
            FROM retailer_inventory ri
            JOIN products p ON ri.product_id = p.id
            LEFT JOIN seller_products sp ON p.id = sp.product_id
            LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id 
            WHERE ri.retailer_id = ?
            AND (p.name LIKE ?)
            GROUP BY ri.id
            ORDER BY ri.updated_at DESC
            LIMIT ? OFFSET ?
        `;

        const [inventory] = await connection.query(sql, [retailerId, term, limit, offset]);

        // 4. Map & Calculate BV (Using Your App's Exact Formula)
        const mappedInventory = inventory.map(item => {
            const distPrice = parseFloat(item.distributor_price || 0); // 150
            const purchasePrice = parseFloat(item.purchase_price || 0); // 100
            const gst = parseFloat(item.gst_percentage || 0); // 5

            // --- CORRECTED FORMULA ---
            // 1. Calculate Base Selling Price (Remove Tax)
            // 150 / 1.05 = 142.857
            const baseSellingPrice = distPrice / (1 + (gst / 100));

            // 2. Calculate Net Profit
            // 142.857 - 100 = 42.857
            let netProfit = baseSellingPrice - purchasePrice;
            if(netProfit < 0) netProfit = 0;

            // 3. Calculate BV (80% of Net Profit)
            // 42.857 * 0.80 = 34.285... -> 34.29
            const calculatedBV = netProfit * (globalBvPercent / 100);

            return {
                ...item,
                mrp: item.mrp || 0,
                distributor_price: distPrice,
                sku: item.sku || 'N/A',
                hsn: 'N/A', 
                bv: parseFloat(calculatedBV.toFixed(2)), // Result: 34.29
                gst_percentage: gst
            };
        });

        res.status(200).json({ 
            status: true, 
            data: mappedInventory,
            pagination: { currentPage: page, totalPages, totalItems, limit }
        });

    } catch (error) {
        console.error('getMyInventory error:', error);
        res.status(500).json({ status: false, message: 'Server error' });
    } finally {
        connection.release();
    }
};









/**
 * 4. UPDATE STOCK OR PRICE
 */
exports.updateInventoryItem = async (req, res) => {
    try {
        const { inventory_id } = req.params;
        const { stock_quantity, selling_price } = req.body;
        const retailerId = req.retailer.id;

        const now = getISTTime();

        // Ensure user owns this item
        const sql = `UPDATE retailer_inventory SET stock_quantity=?, selling_price=?, updated_at=? WHERE id=? AND retailer_id=?`;
        
        const [result] = await db.query(sql, [stock_quantity, selling_price, now, inventory_id, retailerId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: false, message: 'Item not found.' });
        }

        res.status(200).json({ status: true, message: 'Inventory updated.' });

    } catch (error) {
        console.error('updateInventoryItem error:', error);
        res.status(500).json({ status: false, message: 'Server error' });
    }
};


