// Controllers/sellerProductController.js
const db = require('../../db');
const SellerProduct = require('../Models/sellerProductModel');

// A seller (or Admin) adds their offer for a master product
// exports.addSellerOffer = async (req, res) => {
//     // This route should be protected. Auth middleware must set req.user
//     // Example: req.user = { id: 1, type: 'Admin' } or { id: 15, type: 'Merchant' }
//     try {
//         const {
//             productId, sku, mrp, sellingPrice, purchasePrice, quantity, pincode
//         } = req.body;

//         // const loggedInUser = req.user; // Assuming auth middleware provides this
//         const loggedInUser = {
//             id: 1,
//             type: 'admin'
//         };

//         if (!loggedInUser) {
//             console.log("Error is here")
//             return res.status(401).json({ status: false, message: "Authentication required." });
//         }

//         // 1. Find the master seller ID from the 'sellers' table
//         const [sellerRows] = await db.query(
//             'SELECT id FROM sellers WHERE sellerable_id = ? AND sellerable_type = ?',
//             [loggedInUser.id, loggedInUser.type]
//         );

//         if (sellerRows.length === 0) {
//             return res.status(403).json({ status: false, message: "No valid seller profile found for this user." });
//         }
//         const sellerId = sellerRows[0].id;

//         // 2. Validation
//         if (!productId || !mrp || !sellingPrice || !purchasePrice || !quantity || !pincode) {
//             return res.status(400).json({ status: false, message: "Product, price, quantity, and pincode are required." });
//         }

//         // 3. Insert the offer
//         const query = `
//             INSERT INTO seller_products 
//               (seller_id, product_id, sku, mrp, selling_price, purchase_price, quantity, pincode) 
//             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
//         `;
//         const [result] = await db.query(query, [sellerId, productId, sku, mrp, sellingPrice, purchasePrice, quantity, pincode]);

//         res.status(201).json({ status: true, message: "Product offer added to your inventory.", offerId: result.insertId });

//     } catch (error) {
//         if (error.code === 'ER_DUP_ENTRY') {
//             return res.status(409).json({ status: false, message: "You already have a listing for this product at this pincode." });
//         }
//         console.error("Error adding seller product:", error);
//         res.status(500).json({ status: false, message: "An error occurred." });
//     }
// };




//  After pincode solution 

exports.addSellerOffer = async (req, res) => {
    // ==========================================================
    // === THE FIX IS HERE ===
    // ==========================================================
    // No more hardcoding. The `req.user` object is reliably populated
    // by the authMiddleware we created.
    const loggedInUser = req.user; 
    // ==========================================================
    // === END OF FIX ===
    // ==========================================================

    const connection = await db.getConnection();

    try {
        const {
            productId, sku, mrp, sellingPrice, purchasePrice, quantity,
            pincodes, low_stock_threshold
        } = req.body;

        // The loggedInUser object contains { id, role } from the JWT
        const [sellerRows] = await connection.query(
            'SELECT id FROM sellers WHERE sellerable_id = ? AND sellerable_type = ?',
            [loggedInUser.id, loggedInUser.role] // Use the role from the token
        );

        if (sellerRows.length === 0) {
            // Check if the user is an admin; if so, they can act as a default seller
            // This is an example of authorization logic.
            if (loggedInUser.role.toLowerCase() === 'admin') {
                // You might have a default "Earn24 Fulfilled" seller profile for the admin
                // For now, let's assume admin has a seller profile.
                return res.status(403).json({ status: false, message: "Admin user does not have an associated seller profile." });
            }
            return res.status(403).json({ status: false, message: "No valid seller profile found for this user." });
        }
        const sellerId = sellerRows[0].id;

        if (!productId || !mrp || !sellingPrice || !quantity || !Array.isArray(pincodes) || pincodes.length === 0 || low_stock_threshold === undefined) {
            return res.status(400).json({ status: false, message: "Product, price, quantity, pincodes, and low stock threshold are required." });
        }

        await connection.beginTransaction();

        const offerQuery = `
            INSERT INTO seller_products 
              (seller_id, product_id, sku, mrp, selling_price, purchase_price, quantity, low_stock_threshold) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const [result] = await connection.query(offerQuery, [sellerId, productId, sku, mrp, sellingPrice, purchasePrice, quantity, low_stock_threshold]);
        const newOfferId = result.insertId;

        const pincodeValues = pincodes.map(pincode => [newOfferId, pincode.trim()]);
        await connection.query('INSERT INTO seller_product_pincodes (seller_product_id, pincode) VALUES ?', [pincodeValues]);

        await connection.commit();
        res.status(201).json({ status: true, message: "Product offer added successfully.", offerId: newOfferId });

    } catch (error) {
        if (connection) await connection.rollback();
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: false, message: "You already have a listing for this master product." });
        }
        console.error("Error adding seller product:", error);
        res.status(500).json({ status: false, message: "An error occurred while adding the offer." });
    } finally {
        if (connection) connection.release();
    }
};





// Public API for the mobile app to search for products
exports.findProductsByPincode = async (req, res) => {
    try {
        const { search, pincode } = req.query;

        console.log("ssss")
        if (!pincode) {
            return res.status(400).json({ status: false, message: "Pincode is required to find products." });
        }

        const searchTerm = `%${search || ''}%`;
        const query = `
            SELECT
                p.name, p.main_image_url, b.name as brand_name,
                sp.id as offer_id, sp.selling_price, sp.mrp, sp.quantity,
                s.display_name as seller_name
            FROM seller_products sp
            JOIN products p ON sp.product_id = p.id
            JOIN sellers s ON sp.seller_id = s.id
            LEFT JOIN brands b ON p.brand_id = b.id
            WHERE 
                sp.pincode = ?
                AND (p.name LIKE ? OR b.name LIKE ?)
                AND sp.is_active = TRUE AND p.is_active = TRUE AND p.is_approved = TRUE
        `;

        const [rows] = await db.query(query, [pincode, searchTerm, searchTerm]);
        res.status(200).json({ status: true, data: rows });

    } catch (error) {
        console.error("Error finding products by pincode:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};



/**
 * Get all seller offers for the Admin Panel, now including their list of pincodes.
 */
// exports.getAllSellerOffers = async (req, res) => {
//     try {
//         const page = parseInt(req.query.page, 10) || 1;
//         const limit = parseInt(req.query.limit, 10) || 10;
//         const search = req.query.search || '';
//         const offset = (page - 1) * limit;
//         const searchPattern = `%${search}%`;

//         const dataQuery = `
//             SELECT 
//                 sp.id, sp.sku, sp.mrp, sp.selling_price, sp.purchase_price, sp.quantity, sp.is_active,
//                 p.name as product_name, p.main_image_url,
//                 s.display_name as seller_name,
//                 -- This subquery creates a temporary 'pincodes' column with a comma-separated string
//                 (
//                     SELECT GROUP_CONCAT(pincode) 
//                     FROM seller_product_pincodes 
//                     WHERE seller_product_id = sp.id
//                 ) as pincodes
//             FROM seller_products sp
//             JOIN products p ON sp.product_id = p.id
//             JOIN sellers s ON sp.seller_id = s.id
//             WHERE (p.name LIKE ? OR s.display_name LIKE ?)
//             GROUP BY sp.id -- Group by the main offer to get one row per offer
//             ORDER BY sp.created_at DESC
//             LIMIT ? OFFSET ?
//         `;
//         const [rows] = await db.query(dataQuery, [searchPattern, searchPattern, limit, offset]);

//         // Post-process the data to turn the pincode string into a proper JavaScript array
//         const data = rows.map(offer => ({
//             ...offer,
//             pincodes: offer.pincodes ? offer.pincodes.split(',') : []
//         }));
        
//         const countQuery = `
//             SELECT COUNT(DISTINCT sp.id) as total 
//             FROM seller_products sp
//             JOIN products p ON sp.product_id = p.id
//             JOIN sellers s ON sp.seller_id = s.id
//             WHERE (p.name LIKE ? OR s.display_name LIKE ?)
//         `;
//         const [countRows] = await db.query(countQuery, [searchPattern, searchPattern]);
        
//         res.status(200).json({
//             status: true,
//             data,
//             pagination: {
//                 currentPage: page,
//                 totalPages: Math.ceil(countRows[0].total / limit),
//                 totalRecords: countRows[0].total,
//                 limit
//             }
//         });

//     } catch (error) {
//         console.error("Error fetching all seller offers:", error);
//         res.status(500).json({ status: false, message: "An error occurred." });
//     }
// };




// exports.getAllSellerOffers = async (req, res) => {
//     try {
//         const page = parseInt(req.query.page, 10) || 1;
//         const limit = parseInt(req.query.limit, 10) || 10;
//         const search = req.query.search || '';
//         const offset = (page - 1) * limit;
//         const searchPattern = `%${search}%`;

//         // ==========================================================
//         // === THE FIX IS IN THIS SQL QUERY ===
//         // ==========================================================
//         const dataQuery = `
//             SELECT 
//                 sp.id, sp.sku, sp.mrp, sp.selling_price, sp.purchase_price, sp.quantity, sp.is_active,
//                 p.id as product_id, p.name as product_name, p.main_image_url, p.description,
//                 s.display_name as seller_name,
//                 h.gst_percentage, -- <-- THIS IS THE NEW, CRITICAL FIELD
//                 (
//                     SELECT GROUP_CONCAT(pincode) 
//                     FROM seller_product_pincodes 
//                     WHERE seller_product_id = sp.id
//                 ) as pincodes,
//                 (
//                     SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('attribute_name', attr.name, 'value', av.value)), ']')
//                     FROM product_attributes pa
//                     JOIN attribute_values av ON pa.attribute_value_id = av.id
//                     JOIN attributes attr ON av.attribute_id = attr.id
//                     WHERE pa.product_id = p.id
//                 ) as attributes
//             FROM seller_products sp
//             JOIN products p ON sp.product_id = p.id
//             JOIN sellers s ON sp.seller_id = s.id
//             LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id -- <-- NEW JOIN
//             WHERE (p.name LIKE ? OR s.display_name LIKE ?)
//             GROUP BY sp.id
//             ORDER BY sp.created_at DESC
//             LIMIT ? OFFSET ?
//         `;
//         const [rows] = await db.query(dataQuery, [searchPattern, searchPattern, limit, offset]);

//         // Post-process the data to turn strings into proper arrays/objects
//         const data = rows.map(offer => ({
//             ...offer,
//             pincodes: offer.pincodes ? offer.pincodes.split(',') : [],
//             attributes: offer.attributes ? JSON.parse(offer.attributes) : [],
//             gst_percentage: parseFloat(offer.gst_percentage) || 0 // Ensure it's a number
//         }));
        
//         const countQuery = `
//             SELECT COUNT(DISTINCT sp.id) as total 
//             FROM seller_products sp
//             JOIN products p ON sp.product_id = p.id
//             JOIN sellers s ON sp.seller_id = s.id
//             WHERE (p.name LIKE ? OR s.display_name LIKE ?)
//         `;
//         const [countRows] = await db.query(countQuery, [searchPattern, searchPattern]);
        
//         res.status(200).json({
//             status: true,
//             data,
//             pagination: {
//                 currentPage: page,
//                 totalPages: Math.ceil(countRows[0].total / limit),
//                 totalRecords: countRows[0].total,
//                 limit
//             }
//         });

//     } catch (error) {
//         console.error("Error fetching all seller offers:", error);
//         res.status(500).json({ status: false, message: "An error occurred." });
//     }
// };



exports.getAllSellerOffers = async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const search = req.query.search || '';
        const offset = (page - 1) * limit;
        const searchPattern = `%${search}%`;

        const dataQuery = `
            SELECT 
                sp.id,
                sp.sku,
                sp.mrp,
                sp.selling_price,
                sp.purchase_price,
                sp.quantity,
                sp.is_active,
                sp.low_stock_threshold,
                p.id AS product_id,
                p.name AS product_name,
                p.main_image_url,
                p.description,
                s.display_name AS seller_name,
                h.gst_percentage,
                (
                    SELECT GROUP_CONCAT(pincode) 
                    FROM seller_product_pincodes 
                    WHERE seller_product_id = sp.id
                ) AS pincodes,
                (
                    SELECT CONCAT(
                        '[',
                        GROUP_CONCAT(
                            JSON_OBJECT(
                                'attribute_name', attr.name,
                                'value', av.value
                            )
                        ),
                        ']'
                    )
                    FROM product_attributes pa
                    JOIN attribute_values av ON pa.attribute_value_id = av.id
                    JOIN attributes attr ON av.attribute_id = attr.id
                    WHERE pa.product_id = p.id
                ) AS attributes
            FROM seller_products sp
            JOIN products p ON sp.product_id = p.id
            JOIN sellers s ON sp.seller_id = s.id
            LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
            WHERE (p.name LIKE ? OR s.display_name LIKE ?)
            GROUP BY sp.id
            ORDER BY sp.created_at DESC
            LIMIT ? OFFSET ?
        `;

        const [rows] = await db.query(dataQuery, [
            searchPattern,
            searchPattern,
            limit,
            offset
        ]);

        const data = rows.map(offer => ({
            ...offer,
            pincodes: offer.pincodes ? offer.pincodes.split(',') : [],
            attributes: offer.attributes ? JSON.parse(offer.attributes) : [],
            gst_percentage: parseFloat(offer.gst_percentage) || 0
        }));

        const countQuery = `
            SELECT COUNT(DISTINCT sp.id) AS total
            FROM seller_products sp
            JOIN products p ON sp.product_id = p.id
            JOIN sellers s ON sp.seller_id = s.id
            WHERE (p.name LIKE ? OR s.display_name LIKE ?)
        `;

        const [countRows] = await db.query(countQuery, [
            searchPattern,
            searchPattern
        ]);

        res.status(200).json({
            status: true,
            data,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(countRows[0].total / limit),
                totalRecords: countRows[0].total,
                limit
            }
        });

    } catch (error) {
        console.error("Error fetching all seller offers:", error);
        res.status(500).json({
            status: false,
            message: "An error occurred."
        });
    }
};





// exports.updateSellerOffer = async (req, res) => {
//     try {
//         const { id } = req.params;
//         const {
//             sku,
//             mrp,
//             sellingPrice,
//             purchasePrice,
//             quantity,
//             pincode,
//             is_active
//         } = req.body;

//         // 1. First, verify the offer actually exists.
//         const [existingOffer] = await db.query('SELECT id FROM seller_products WHERE id = ?', [id]);
//         if (existingOffer.length === 0) {
//             return res.status(404).json({ status: false, message: "Offer not found." });
//         }

//         const fields = [];
//         const values = [];

//         // 2. Build the query dynamically, checking each field.
//         if (sku !== undefined) {
//             fields.push('sku = ?');
//             values.push(sku);
//         }
//         if (mrp !== undefined) {
//             fields.push('mrp = ?');
//             values.push(mrp);
//         }
//         if (sellingPrice !== undefined) {
//             fields.push('selling_price = ?');
//             values.push(sellingPrice);
//         }
//         if (purchasePrice !== undefined) {
//             fields.push('purchase_price = ?');
//             values.push(purchasePrice);
//         }
//         if (quantity !== undefined) {
//             fields.push('quantity = ?');
//             values.push(quantity);
//         }
//         if (pincode !== undefined) {
//             fields.push('pincode = ?');
//             values.push(pincode);
//         }
//         if (is_active !== undefined) {
//             fields.push('is_active = ?');
//             values.push(is_active === true || is_active === 'true' ? 1 : 0);
//         }

//         // 3. Check if any fields were actually provided for the update.
//         if (fields.length === 0) {
//             return res.status(400).json({ status: false, message: "No valid fields provided to update." });
//         }

//         // 4. Construct and execute the final UPDATE query.
//         const query = `UPDATE seller_products SET ${fields.join(', ')} WHERE id = ?`;
//         values.push(id);
//         await db.query(query, values);

//         // 5. Fetch the full, updated offer to return to the frontend.
//         const getUpdatedOfferQuery = `
//             SELECT 
//                 sp.id, 
//                 sp.selling_price, 
//                 sp.purchase_price,
//                 sp.quantity, 
//                 sp.pincode, 
//                 sp.is_active,
//                 sp.mrp, 
//                 sp.sku, 
//                 sp.product_id,
//                 p.name as product_name,
//                 p.main_image_url,
//                 s.display_name as seller_name
//             FROM seller_products sp
//             JOIN products p ON sp.product_id = p.id
//             JOIN sellers s ON sp.seller_id = s.id
//             WHERE sp.id = ?
//         `;
//         const [updatedRows] = await db.query(getUpdatedOfferQuery, [id]);

//         res.status(200).json({
//             status: true,
//             message: "Inventory offer updated successfully.",
//             data: updatedRows[0] // Return the complete, fresh data object
//         });

//     } catch (error) {
//         console.error("Error updating seller product:", error);
//         res.status(500).json({ status: false, message: "An error occurred during the update." });
//     }
// };




/**
 * Update an existing seller offer. We use a "replace" strategy for pincodes.
 */
// exports.updateSellerOffer = async (req, res) => {
//     const { id } = req.params; // This is the seller_product_id
//     const {
//         sku, mrp, sellingPrice, purchasePrice, quantity, is_active,
//         pincodes // <-- EXPECT A COMPLETE NEW ARRAY of pincodes
//     } = req.body;

//     const connection = await db.getConnection();

//     try {
//         await connection.beginTransaction();

//         const fields = [], values = [];
//         if (sku !== undefined) { fields.push('sku = ?'); values.push(sku); }
//         if (mrp !== undefined) { fields.push('mrp = ?'); values.push(mrp); }
//         if (sellingPrice !== undefined) { fields.push('selling_price = ?'); values.push(sellingPrice); }
//         if (purchasePrice !== undefined) { fields.push('purchase_price = ?'); values.push(purchasePrice); }
//         if (quantity !== undefined) { fields.push('quantity = ?'); values.push(quantity); }
//         if (is_active !== undefined) { fields.push('is_active = ?'); values.push(Boolean(is_active)); }
        
//         if (fields.length > 0) {
//             const updateQuery = `UPDATE seller_products SET ${fields.join(', ')} WHERE id = ?`;
//             await connection.query(updateQuery, [...values, id]);
//         }

//         // Update pincodes: First, delete all old pincodes, then insert the new ones.
//         if (Array.isArray(pincodes)) {
//             await connection.query('DELETE FROM seller_product_pincodes WHERE seller_product_id = ?', [id]);
//             if (pincodes.length > 0) {
//                 const pincodeValues = pincodes.map(pincode => [id, pincode.trim()]);
//                 await connection.query('INSERT INTO seller_product_pincodes (seller_product_id, pincode) VALUES ?', [pincodeValues]);
//             }
//         }
        
//         await connection.commit();
//         res.status(200).json({ status: true, message: "Inventory offer updated successfully." });

//     } catch (error) {
//         if (connection) await connection.rollback();
//         console.error("Error updating seller product:", error);
//         res.status(500).json({ status: false, message: "An error occurred during the update." });
//     } finally {
//         if (connection) connection.release();
//     }
// };





exports.updateSellerOffer = async (req, res) => {
    const { id } = req.params;
    const {
        sku,
        mrp,
        sellingPrice,
        purchasePrice,
        quantity,
        is_active,
        pincodes,
        low_stock_threshold
    } = req.body;

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const fields = [];
        const values = [];

        if (sku !== undefined) {
            fields.push('sku = ?');
            values.push(sku);
        }

        if (mrp !== undefined) {
            fields.push('mrp = ?');
            values.push(mrp);
        }

        if (sellingPrice !== undefined) {
            fields.push('selling_price = ?');
            values.push(sellingPrice);
        }

        if (purchasePrice !== undefined) {
            fields.push('purchase_price = ?');
            values.push(purchasePrice);
        }

        if (quantity !== undefined) {
            fields.push('quantity = ?');
            values.push(quantity);
        }

        if (is_active !== undefined) {
            fields.push('is_active = ?');
            values.push(Boolean(is_active));
        }

        if (low_stock_threshold !== undefined) {
            fields.push('low_stock_threshold = ?');
            values.push(low_stock_threshold);
        }

        if (fields.length > 0) {
            const updateQuery = `
                UPDATE seller_products 
                SET ${fields.join(', ')} 
                WHERE id = ?
            `;
            await connection.query(updateQuery, [...values, id]);
        }

        if (Array.isArray(pincodes)) {
            // Remove old pincodes
            await connection.query(
                'DELETE FROM seller_product_pincodes WHERE seller_product_id = ?',
                [id]
            );

            // Insert new pincodes
            if (pincodes.length > 0) {
                const pincodeValues = pincodes.map(pincode => [id, pincode.trim()]);
                await connection.query(
                    'INSERT INTO seller_product_pincodes (seller_product_id, pincode) VALUES ?',
                    [pincodeValues]
                );
            }
        }

        await connection.commit();
        res.status(200).json({
            status: true,
            message: "Inventory offer updated successfully."
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error updating seller product:", error);
        res.status(500).json({
            status: false,
            message: "An error occurred during the update."
        });
    } finally {
        if (connection) connection.release();
    }
};






exports.toggleOfferStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { is_active } = req.body;

        // Validation: is_active must be a boolean
        if (typeof is_active !== 'boolean') {
            return res.status(400).json({ status: false, message: "A valid 'is_active' status (true or false) is required." });
        }

        const query = 'UPDATE seller_products SET is_active = ? WHERE id = ?';
        const [result] = await db.query(query, [is_active, id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: false, message: "Inventory offer not found." });
        }

        res.status(200).json({ status: true, message: `Offer status updated to ${is_active ? 'Active' : 'Inactive'}.` });

    } catch (error) {
        console.error("Error toggling offer status:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};



// File: /Controllers/sellerProductController.js

/**
 * Fetches all necessary data for the home screen, optimized and corrected.
 * This function now correctly queries products based on a pincode by joining a
 * dedicated 'seller_product_pincodes' table.
 */
// exports.getHomeScreenData = async (req, res) => {

//     // Pincode is mandatory and must be provided in the request query.
//     const { pincode } = req.query;

//     if (!pincode) {
//         return res.status(400).json({ status: false, message: "Pincode is required to fetch local data." });
//     }

//     try {
//         // --- 1. Fetch Active Banners ---
//         const [banners] = await db.query(
//             `SELECT image_url, link_to, title FROM banners WHERE is_active = TRUE ORDER BY display_order ASC`
//         );

//         // --- 2. Fetch Top Main Categories ---
//         const [categories] = await db.query(
//             `SELECT id, name, image_url FROM product_categories WHERE is_active = TRUE AND is_deleted = FALSE ORDER BY display_order ASC LIMIT 10`
//         );

//         // --- 3. Fetch App Settings for BV Calculation ---
//         const [settingsRows] = await db.query("SELECT setting_key, setting_value FROM app_settings WHERE setting_key = 'bv_generation_pct_of_profit'");
//         const bvSetting = settingsRows.find(s => s.setting_key === 'bv_generation_pct_of_profit');
//         const bvGenerationPct = bvSetting ? parseFloat(bvSetting.setting_value) : 80.0; // Default to 80% if not set

//         // --- 4. Fetch Products for each Category, filtered by Pincode ---
//         // This runs all category product lookups in parallel for speed.
//         const productPromises = categories.map(category =>
//             db.query(`
//                 SELECT 
//                     p.id as product_id, 
//                     p.name,
//                     p.description,
//                     p.main_image_url, 
//                     p.gallery_image_urls,
//                     sp.id as offer_id, 
//                     b.name as brand_name, 
//                     sp.selling_price, 
//                     sp.mrp,
//                     sp.purchase_price,
//                     sp.minimum_order_quantity,
//                     -- BV Calculation
//                     ((sp.selling_price / (1 + (h.gst_percentage / 100))) - sp.purchase_price) * (? / 100) as bv_earned,
                    
//                     -- Subquery to aggregate all product attributes into a JSON array string
//                     (
//                         SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('attribute_name', attr.name, 'value', av.value)), ']') 
//                         FROM product_attributes pa
//                         JOIN attribute_values av ON pa.attribute_value_id = av.id
//                         JOIN attributes attr ON av.attribute_id = attr.id
//                         WHERE pa.product_id = p.id
//                     ) as attributes,

//                     -- CORRECTED: Subquery to get all available pincodes for this specific seller_product offering
//                     (
//                         SELECT GROUP_CONCAT(spp_inner.pincode) 
//                         FROM seller_product_pincodes spp_inner 
//                         WHERE spp_inner.seller_product_id = sp.id
//                     ) as available_pincodes
                
//                 FROM seller_products sp
//                 -- CORRECTED: JOIN the linking table that connects seller products to pincodes
//                 JOIN seller_product_pincodes spp ON sp.id = spp.seller_product_id
//                 JOIN products p ON sp.product_id = p.id
//                 LEFT JOIN brands b ON p.brand_id = b.id
//                 LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id 
//                 WHERE 
//                     -- CORRECTED: Filter by the pincode from the correct linking table
//                     spp.pincode = ? AND 
//                     p.category_id = ? AND 
//                     sp.is_active = TRUE
//                 ORDER BY p.popularity DESC, p.created_at DESC
//                 LIMIT 10
//             `,
//             [bvGenerationPct, pincode, category.id]
//             )
//         );

//         // Wait for all the product queries to complete
//         const productResults = await Promise.all(productPromises);

//         // Process the results to create the final data structure
//         const categorizedProducts = categories.map((category, index) => {
//             const rawProducts = productResults[index][0];
//             const productsWithParsedData = rawProducts.map(p => ({
//                 ...p,
//                 // Parse the gallery and attributes strings from the DB into actual JSON arrays
//                 gallery_image_urls: p.gallery_image_urls ? JSON.parse(p.gallery_image_urls) : [],
//                 attributes: p.attributes ? JSON.parse(p.attributes) : [],
//                 // Convert the comma-separated pincode string into an array, as expected by the model
//                 pincodes: p.available_pincodes ? p.available_pincodes.split(',') : []
//             }));

//             return {
//                 id: category.id,
//                 title: `Best in ${category.name}`,
//                 products: productsWithParsedData
//             };
//         }).filter(section => section.products.length > 0); // Remove empty sections

//         console.log("data==>",{
//                 banners,
//                 categories,
//                 productSections: categorizedProducts,
//             } )

//         // --- 5. Combine all data and send the final successful response ---
//         res.status(200).json({
//             status: true,
//             data: {
//                 banners,
//                 categories,
//                 productSections: categorizedProducts,
//             }
//         });

//     } catch (error) {
//         // Catch any database or processing errors
//         console.error("Error fetching home screen data:", error);
//         res.status(500).json({ status: false, message: "An internal server error occurred." });
//     }
// };






//  Working 
// exports.getHomeScreenData = async (req, res) => {
//     const { pincode } = req.query;

//     if (!pincode) {
//         return res.status(400).json({ status: false, message: "Pincode is required." });
//     }

//     try {
//         // --- 1. Fetch Active Banners (Unchanged) ---
//         const [banners] = await db.query(
//             `SELECT id, image_url, link_to, title FROM banners WHERE is_active = TRUE ORDER BY display_order ASC`
//         );

//         // ==========================================================
//         // === 2. UPGRADED: Fetch Categories and Sub-Categories   ===
//         // ==========================================================
        
//         // Step 2a: Fetch all PARENT categories
//         const [parentCategories] = await db.query(
//             `SELECT id, name, image_url FROM product_categories WHERE is_active = TRUE AND is_deleted = FALSE ORDER BY display_order ASC`
//         );

//         // Step 2b: Fetch all SUB-categories
//         const [subCategories] = await db.query(
//             `SELECT id, category_id, name, image_url FROM product_subcategories WHERE is_active = TRUE AND is_deleted = FALSE ORDER BY name ASC`
//         );

//         // Step 2c: Build the nested tree structure in Node.js
//         const categoryTree = parentCategories.map(parent => {
//             // Find all children that belong to this parent
//             const children = subCategories
//                 .filter(sub => sub.category_id === parent.id)
//                 .map(sub => ({ // Format to match the frontend's expectation
//                     id: sub.id,
//                     name: sub.name,
//                     image_url: sub.image_url,
//                 }));

//             return {
//                 id: parent.id,
//                 name: parent.name,
//                 image_url: parent.image_url,
//                 subCategories: children // The nested array of sub-categories
//             };
//         });
//         // The `categoryTree` variable now holds your correctly nested data.

//         // --- 3. Fetch App Settings (Unchanged) ---
//         const [settingsRows] = await db.query("SELECT setting_key, setting_value FROM app_settings WHERE setting_key = 'bv_generation_pct_of_profit'");
//         const bvSetting = settingsRows.find(s => s.setting_key === 'bv_generation_pct_of_profit');
//         const bvGenerationPct = bvSetting ? parseFloat(bvSetting.setting_value) : 80.0;

//         // --- 4. Fetch Products for each MAIN Category (Unchanged) ---
//         const productPromises = categoryTree.map(category => 
//             db.query(`
//                 SELECT 
//                     p.id as product_id, p.name, p.description, p.main_image_url, p.gallery_image_urls,
//                     sp.id as offer_id, b.name as brand_name, sp.selling_price, sp.mrp,
//                     sp.purchase_price, sp.minimum_order_quantity,
//                     ((sp.selling_price / (1 + (h.gst_percentage / 100))) - sp.purchase_price) * (? / 100) as bv_earned,
//                     (
//                         SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('attribute_name', attr.name, 'value', av.value)), ']') 
//                         FROM product_attributes pa
//                         JOIN attribute_values av ON pa.attribute_value_id = av.id
//                         JOIN attributes attr ON av.attribute_id = attr.id
//                         WHERE pa.product_id = p.id
//                     ) as attributes,
//                     (
//                         SELECT GROUP_CONCAT(spp_inner.pincode) 
//                         FROM seller_product_pincodes spp_inner 
//                         WHERE spp_inner.seller_product_id = sp.id
//                     ) as available_pincodes
//                 FROM seller_products sp
//                 JOIN seller_product_pincodes spp ON sp.id = spp.seller_product_id
//                 JOIN products p ON sp.product_id = p.id
//                 LEFT JOIN brands b ON p.brand_id = b.id
//                 LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id 
//                 WHERE 
//                     spp.pincode = ? AND 
//                     p.category_id = ? AND 
//                     sp.is_active = TRUE
//                 GROUP BY sp.id -- Group by the specific offer to avoid ambiguity
//                 ORDER BY p.popularity DESC
//                 LIMIT 10
//             `,
//             [bvGenerationPct, pincode, category.id]
//             )
//         );

//         const productResults = await Promise.all(productPromises);

//         const categorizedProducts = categoryTree.map((category, index) => {
//             const rawProducts = productResults[index][0];
//             const productsWithParsedData = rawProducts.map(p => ({
//                 ...p,
//                 gallery_image_urls: p.gallery_image_urls ? JSON.parse(p.gallery_image_urls) : [],
//                 attributes: p.attributes ? JSON.parse(p.attributes) : [],
//                 pincodes: p.available_pincodes ? p.available_pincodes.split(',') : []
//             }));
//             return {
//                 id: category.id,
//                 title: `Best in ${category.name}`,
//                 products: productsWithParsedData
//             };
//         }).filter(section => section.products.length > 0);


//         // --- 5. Combine all data and send the final response ---
//         res.status(200).json({
//             status: true,
//             data: {
//                 banners,
//                 categories: categoryTree, // <-- SEND THE NEW NESTED TREE
//                 productSections: categorizedProducts,
//             }
//         });

//     } catch (error) {
//         console.error("Error fetching home screen data:", error);
//         res.status(500).json({ status: false, message: "An internal server error occurred." });
//     }
// };





exports.getHomeScreenData = async (req, res) => {
    const { pincode } = req.query;

    if (!pincode) {
        return res.status(400).json({ status: false, message: "Pincode is required." });
    }

    try {
        // --- 1. Fetch Active Banners (Unchanged) ---
        const [banners] = await db.query(
            `SELECT id, image_url, link_to, title FROM banners WHERE is_active = TRUE ORDER BY display_order ASC`
        );

        // --- 2. Fetch Categories and Sub-Categories (Unchanged) ---
        const [parentCategories] = await db.query(
            `SELECT id, name, image_url FROM product_categories WHERE is_active = TRUE AND is_deleted = FALSE ORDER BY display_order ASC`
        );
        const [subCategories] = await db.query(
            `SELECT id, category_id, name, image_url FROM product_subcategories WHERE is_active = TRUE AND is_deleted = FALSE ORDER BY name ASC`
        );
        const categoryTree = parentCategories.map(parent => {
            const children = subCategories
                .filter(sub => sub.category_id === parent.id)
                .map(sub => ({
                    id: sub.id,
                    name: sub.name,
                    image_url: sub.image_url,
                }));
            return {
                id: parent.id,
                name: parent.name,
                image_url: parent.image_url,
                subCategories: children
            };
        });

        // --- 3. Fetch App Settings (Unchanged) ---
        const [settingsRows] = await db.query("SELECT setting_key, setting_value FROM app_settings WHERE setting_key = 'bv_generation_pct_of_profit'");
        const bvSetting = settingsRows.find(s => s.setting_key === 'bv_generation_pct_of_profit');
        const bvGenerationPct = bvSetting ? parseFloat(bvSetting.setting_value) : 80.0;

        // --- 4. Fetch Products for each MAIN Category (Unchanged) ---
        const productPromises = categoryTree.map(category => 
            db.query(`
                SELECT 
                    p.id as product_id, p.name, p.description, p.main_image_url, p.gallery_image_urls,
                    sp.id as offer_id, b.name as brand_name, sp.selling_price, sp.mrp,
                    sp.purchase_price, sp.minimum_order_quantity,
                    ((sp.selling_price / (1 + (h.gst_percentage / 100))) - sp.purchase_price) * (? / 100) as bv_earned,
                    (
                        SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('attribute_name', attr.name, 'value', av.value)), ']') 
                        FROM product_attributes pa
                        JOIN attribute_values av ON pa.attribute_value_id = av.id
                        JOIN attributes attr ON av.attribute_id = attr.id
                        WHERE pa.product_id = p.id
                    ) as attributes,
                    (
                        SELECT GROUP_CONCAT(spp_inner.pincode) 
                        FROM seller_product_pincodes spp_inner 
                        WHERE spp_inner.seller_product_id = sp.id
                    ) as available_pincodes
                FROM seller_products sp
                JOIN seller_product_pincodes spp ON sp.id = spp.seller_product_id
                JOIN products p ON sp.product_id = p.id
                LEFT JOIN brands b ON p.brand_id = b.id
                LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id 
                WHERE 
                    spp.pincode = ? AND 
                    p.category_id = ? AND 
                    sp.is_active = TRUE
                GROUP BY sp.id
                ORDER BY p.popularity DESC
                LIMIT 10
            `,
            [bvGenerationPct, pincode, category.id]
            )
        );

        const productResults = await Promise.all(productPromises);

        // ==========================================================
        // === THE FIX IS HERE                                    ===
        // ==========================================================
        const categorizedProducts = categoryTree.map((category, index) => {
            const rawProducts = productResults[index][0];
            const productsWithParsedData = rawProducts.map(p => ({
                ...p,
                gallery_image_urls: p.gallery_image_urls ? JSON.parse(p.gallery_image_urls) : [],
                attributes: p.attributes ? JSON.parse(p.attributes) : [],
                pincodes: p.available_pincodes ? p.available_pincodes.split(',') : []
            }));

            return {
                id: category.id,
                title: `Best in ${category.name}`,
                // --- THIS IS THE MISSING LINE THAT FIXES THE PROBLEM ---
                parent_category_id: category.id, 
                products: productsWithParsedData
            };
        }).filter(section => section.products.length > 0);


        // --- 5. Combine all data and send the final response ---
        res.status(200).json({
            status: true,
            data: {
                banners,
                categories: categoryTree,
                productSections: categorizedProducts,
            }
        });

    } catch (error) {
        console.error("Error fetching home screen data:", error);
        res.status(500).json({ status: false, message: "An internal server error occurred." });
    }
};
















// --- NEW FUNCTION for Related Products ---
// --- THIS IS THE CORRECTED getRelatedProducts FUNCTION ---
// exports.getRelatedProducts = async (req, res) => {
//     const { productId } = req.params;
//     const { pincode } = req.query; // The user's primary pincode

//     console.log("productId",productId)
//     console.log("pincode",pincode)


//     if (!productId) {
//         return res.status(400).json({ status: false, message: "Product ID is required." });
//     }

//     try {
//         // Step 1: Get the category of the current product
//         const [productRows] = await db.query('SELECT category_id FROM products WHERE id = ?', [productId]);
//         if (productRows.length === 0) {
//             return res.status(404).json({ status: false, message: "Original product not found." });
//         }
//         const categoryId = productRows[0].category_id;

//         // ==========================================================
//         // === THE FIX IS HERE in the baseSelect constant         ===
//         // ==========================================================
//         const baseSelect = `
//             SELECT 
//                 p.id as product_id, p.name, p.main_image_url, p.description, p.gallery_image_urls,
//                 b.name as brand_name, 
//                 sp.id as offer_id, sp.selling_price, sp.mrp, sp.minimum_order_quantity,
//                 ((sp.selling_price / (1 + (h.gst_percentage / 100))) - sp.purchase_price) * 80 / 100 as bv_earned,
//                 -- THIS SUBQUERY DYNAMICALLY BUILDS THE 'attributes' FIELD
//                 (
//                     SELECT CONCAT('[', GROUP_CONCAT(
//                         JSON_OBJECT(
//                             'attribute_name', attr.name, 
//                             'value', av.value
//                         )
//                     ), ']') 
//                     FROM product_attributes pa
//                     JOIN attribute_values av ON pa.attribute_value_id = av.id
//                     JOIN attributes attr ON av.attribute_id = attr.id
//                     WHERE pa.product_id = p.id
//                 ) as attributes
//         `;
//         // ==========================================================
//         // === END OF FIX                                         ===
//         // ==========================================================
        
//         const baseJoins = `
//             FROM seller_products sp
//             JOIN products p ON sp.product_id = p.id
//             LEFT JOIN brands b ON p.brand_id = b.id
//             LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
//         `;

//         // --- Priority 1: Search in same category and same pincode ---
//         let query = `
//             ${baseSelect} ${baseJoins}
//             WHERE p.category_id = ? AND sp.pincode = ? AND p.id != ? AND sp.is_active = TRUE
//             GROUP BY p.id
//             ORDER BY RAND()
//             LIMIT 10
//         `;
//         let [relatedProducts] = await db.query(query, [categoryId, pincode, productId]);

//         // --- Priority 2 (Fallback): If no results, search in same category, ANY pincode ---
//         if (relatedProducts.length === 0) {
//             console.log(`Fallback 1: No products in pincode ${pincode} for category ${categoryId}. Searching globally in the same category.`);
//             query = `
//                 ${baseSelect} ${baseJoins}
//                 WHERE p.category_id = ? AND p.id != ? AND sp.is_active = TRUE
//                 GROUP BY p.id
//                 ORDER BY RAND()
//                 LIMIT 10
//             `;
//             [relatedProducts] = await db.query(query, [categoryId, productId]);
//         }

//         // --- Priority 3 (Ultimate Fallback): If still no results, search ANY category, ANY pincode ---
//         if (relatedProducts.length === 0) {
//             console.log(`Fallback 2: No products found in category ${categoryId}. Searching globally for any popular products.`);
//             query = `
//                 ${baseSelect} ${baseJoins}
//                 WHERE p.id != ? AND sp.is_active = TRUE
//                 GROUP BY p.id
//                 ORDER BY p.popularity DESC, RAND()
//                 LIMIT 10
//             `;
//             [relatedProducts] = await db.query(query, [productId]);
//         }
        
//         // Before sending, parse the JSON strings for each product
//         const processedProducts = relatedProducts.map(p => ({
//             ...p,
//             gallery_image_urls: p.gallery_image_urls ? JSON.parse(p.gallery_image_urls) : [],
//             attributes: p.attributes ? JSON.parse(p.attributes) : []
//         }));

//         res.status(200).json({ status: true, data: processedProducts });

//     } catch (error) {
//         console.error("Error fetching related products:", error);
//         res.status(500).json({ status: false, message: "An error occurred while fetching related products." });
//     }
// };






// File: /Controllers/sellerProductController.js

// exports.getRelatedProducts = async (req, res) => {
//     const { productId } = req.params;
//     const { pincode } = req.query; // May be undefined if not sent by the app

//     console.log("pincode-->",pincode)
//     console.log("productId-->",productId)


//     console.log("Fetching related products for productId:", productId);
//     console.log("Using pincode:", pincode);

//     if (!productId) {
//         return res.status(400).json({ status: false, message: "Product ID is required." });
//     }

//     try {
//         // Step 1: Get the category of the current product
//         const [productRows] = await db.query('SELECT category_id FROM products WHERE id = ?', [productId]);
//         if (productRows.length === 0) {
//             return res.status(404).json({ status: false, message: "Original product not found." });
//         }
//         const categoryId = productRows[0].category_id;

//         // --- Corrected Base Query Parts ---
//         const baseSelect = `
//             SELECT 
//                 p.id as product_id, p.name, p.main_image_url, p.description, p.gallery_image_urls,
//                 b.name as brand_name, 
//                 sp.id as offer_id, sp.selling_price, sp.mrp, sp.minimum_order_quantity,
//                 ((sp.selling_price / (1 + (h.gst_percentage / 100))) - sp.purchase_price) * 80 / 100 as bv_earned,
//                 (
//                     SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('attribute_name', attr.name, 'value', av.value)), ']') 
//                     FROM product_attributes pa
//                     JOIN attribute_values av ON pa.attribute_value_id = av.id
//                     JOIN attributes attr ON av.attribute_id = attr.id
//                     WHERE pa.product_id = p.id
//                 ) as attributes,
//                 -- CORRECTED: Added this to fetch all pincodes for consistency
//                 (
//                     SELECT GROUP_CONCAT(spp_inner.pincode) 
//                     FROM seller_product_pincodes spp_inner 
//                     WHERE spp_inner.seller_product_id = sp.id
//                 ) as available_pincodes
//         `;
        
//         // CORRECTED: The JOIN now includes the pincode linking table
//         const baseJoins = `
//             FROM seller_products sp
//             JOIN products p ON sp.product_id = p.id
//             JOIN seller_product_pincodes spp ON sp.id = spp.seller_product_id
//             LEFT JOIN brands b ON p.brand_id = b.id
//             LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
//         `;
//         // --- End of Corrected Base Parts ---

//         let relatedProducts = [];

//         // --- Priority 1: Search in same category and SAME Pincode (only if pincode is provided) ---
//         if (pincode) {
//             const query = `
//                 ${baseSelect} ${baseJoins}
//                 WHERE p.category_id = ? 
//                 AND spp.pincode = ?  -- CORRECTED: Filter on the correct table
//                 AND p.id != ? 
//                 AND sp.is_active = TRUE
//                 GROUP BY p.id
//                 ORDER BY RAND()
//                 LIMIT 10
//             `;
//             [relatedProducts] = await db.query(query, [categoryId, pincode, productId]);
//         }

//         // --- Priority 2 (Fallback): If no results OR no pincode was given, search in same category, ANY pincode ---
//         if (relatedProducts.length === 0) {
//             if (pincode) {
//                  console.log(`Fallback 1: No products in pincode ${pincode} for category ${categoryId}. Searching globally in the same category.`);
//             } else {
//                  console.log(`Fallback 1: No pincode provided. Searching globally in the same category.`);
//             }
           
//             const query = `
//                 ${baseSelect} ${baseJoins}
//                 WHERE p.category_id = ? 
//                 AND p.id != ? 
//                 AND sp.is_active = TRUE
//                 GROUP BY p.id
//                 ORDER BY RAND()
//                 LIMIT 10
//             `;
//             [relatedProducts] = await db.query(query, [categoryId, productId]);
//         }

//         // --- Priority 3 (Ultimate Fallback): If still no results, search ANY category, ANY pincode ---
//         if (relatedProducts.length === 0) {
//             console.log(`Fallback 2: No products found in category ${categoryId}. Searching globally for any popular products.`);
//             const query = `
//                 ${baseSelect} ${baseJoins}
//                 WHERE p.id != ? 
//                 AND sp.is_active = TRUE
//                 GROUP BY p.id
//                 ORDER BY p.popularity DESC, RAND()
//                 LIMIT 10
//             `;
//             [relatedProducts] = await db.query(query, [productId]);
//         }
        
//         // Before sending, parse the JSON strings and pincodes for each product
//         const processedProducts = relatedProducts.map(p => ({
//             ...p,
//             gallery_image_urls: p.gallery_image_urls ? JSON.parse(p.gallery_image_urls) : [],
//             attributes: p.attributes ? JSON.parse(p.attributes) : [],
//             // CORRECTED: Added pincode parsing to match other functions
//             pincodes: p.available_pincodes ? p.available_pincodes.split(',') : []
//         }));

//         res.status(200).json({ status: true, data: processedProducts });

//     } catch (error) {
//         console.error("Error fetching related products:", error);
//         res.status(500).json({ status: false, message: "An error occurred while fetching related products." });
//     }
// };







// exports.getRelatedProducts = async (req, res) => {
//     const { productId } = req.params;
//     const { pincode } = req.query; // May be undefined if not sent by the app

//     console.log("pincode-->", pincode)

//     console.log(`Fetching related products for productId: ${productId} with pincode: ${pincode || 'None'}`);

//     if (!productId) {
//         return res.status(400).json({ status: false, message: "Product ID is required." });
//     }

//     try {
//         // Step 1: Get the category of the original product
//         const [productRows] = await db.query('SELECT category_id FROM products WHERE id = ?', [productId]);
//         if (productRows.length === 0) {
//             return res.status(404).json({ status: false, message: "Original product not found." });
//         }
//         const categoryId = productRows[0].category_id;

//         // --- Define the common parts of the SQL query ---
//         const baseSelect = `
//             SELECT 
//                 p.id as product_id, p.name, p.main_image_url, p.description, p.gallery_image_urls,
//                 b.name as brand_name, 
//                 sp.id as offer_id, sp.selling_price, sp.mrp, sp.minimum_order_quantity,
//                 ((sp.selling_price / (1 + (h.gst_percentage / 100))) - sp.purchase_price) * 80 / 100 as bv_earned,
//                 (
//                     SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('attribute_name', attr.name, 'value', av.value)), ']') 
//                     FROM product_attributes pa
//                     JOIN attribute_values av ON pa.attribute_value_id = av.id
//                     JOIN attributes attr ON av.attribute_id = attr.id
//                     WHERE pa.product_id = p.id
//                 ) as attributes
//         `;
        
//         const baseJoins = `
//             FROM seller_products sp
//             JOIN products p ON sp.product_id = p.id
//             LEFT JOIN brands b ON p.brand_id = b.id
//             LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
//         `;

//         let relatedProducts = [];

//         // --- Main Logic: Use a single, prioritized query if a pincode is available ---
//         if (pincode) {
//             // console.log(`Priority Search: Finding products in category ${categoryId}, prioritizing pincode ${pincode}.`);
            
//             const priorityQuery = `
//                 ${baseSelect},
//                 -- This creates a priority score: 1 if it's in the user's pincode, 2 otherwise
//                 CASE 
//                     WHEN EXISTS (
//                         SELECT 1 FROM seller_product_pincodes spp 
//                         WHERE spp.seller_product_id = sp.id AND spp.pincode = ?
//                     ) THEN 1 
//                     ELSE 2 
//                 END as pincode_priority
//                 ${baseJoins}
//                 WHERE 
//                     p.category_id = ? 
//                     AND p.id != ? 
//                     AND sp.is_active = TRUE
//                 GROUP BY p.id
//                 -- Order by the priority score first, then shuffle randomly within each group
//                 ORDER BY pincode_priority ASC, RAND()
//                 LIMIT 10
//             `;
//             [relatedProducts] = await db.query(priorityQuery, [pincode, categoryId, productId]);
//         }
        
//         // --- Fallback 1: If the prioritized query found nothing, OR if no pincode was ever provided ---
//         if (relatedProducts.length === 0) {
//             if (pincode) {
//                 console.log(`Fallback 1: No products found in category ${categoryId} at all. Searching globally within the category.`);
//             } else {
//                 console.log(`Fallback 1: No pincode provided. Searching globally in category ${categoryId}.`);
//             }
           
//             const categoryFallbackQuery = `
//                 ${baseSelect}
//                 ${baseJoins}
//                 WHERE p.category_id = ? 
//                 AND p.id != ? 
//                 AND sp.is_active = TRUE
//                 GROUP BY p.id
//                 ORDER BY RAND()
//                 LIMIT 10
//             `;
//             [relatedProducts] = await db.query(categoryFallbackQuery, [categoryId, productId]);
//         }

//         // --- Fallback 2 (Ultimate): If still no results, search any category for popular items ---
//         if (relatedProducts.length === 0) {
//             console.log(`Fallback 2: No products found in category ${categoryId}. Searching globally for any popular products.`);
//             const globalFallbackQuery = `
//                 ${baseSelect}
//                 ${baseJoins}
//                 WHERE p.id != ? 
//                 AND sp.is_active = TRUE
//                 GROUP BY p.id
//                 ORDER BY p.popularity DESC, RAND()
//                 LIMIT 10
//             `;
//             [relatedProducts] = await db.query(globalFallbackQuery, [productId]);
//         }
        
//         // --- Data Processing: Manually parse and structure the raw data ---
//         // This is the part that replaces the "model".
//         const processedProducts = relatedProducts.map(row => {
//             return {
//                 ...row, // Keep all existing fields from the row
//                 gallery_image_urls: row.gallery_image_urls ? JSON.parse(row.gallery_image_urls) : [],
//                 attributes: row.attributes ? JSON.parse(row.attributes) : []
//                 // The 'pincode_priority' field will also be included if it exists, which can be useful for debugging
//             };
//         });

//         res.status(200).json({ status: true, data: processedProducts });

//     } catch (error) {
//         console.error("Error fetching related products:", error.message);
//         res.status(500).json({ status: false, message: "An error occurred while fetching related products.", error:error.message });
//     }
// };





exports.getRelatedProducts = async (req, res) => {
    const { productId } = req.params;
    const { pincode } = req.query;
    const G_LIMIT = 10;

    console.log(`Executing STRICT pincode search for productId: ${productId} with pincode: ${pincode || 'None'}`);

    // If no pincode is provided by the app, we cannot find related products.
    // Return an empty list, as per the strict logic.
    if (!pincode) {
        return res.status(200).json({ status: true, data: [] });
    }

    if (!productId) {
        return res.status(400).json({ status: false, message: "Product ID is required." });
    }

    try {
        const [productRows] = await db.query('SELECT category_id FROM products WHERE id = ?', [productId]);
        if (productRows.length === 0) {
            return res.status(404).json({ status: false, message: "Original product not found." });
        }
        const categoryId = productRows[0].category_id;

        const baseSelect = `
            p.id as product_id, p.name, p.main_image_url, p.description, p.gallery_image_urls,
            b.name as brand_name, 
            sp.id as offer_id, sp.selling_price, sp.mrp, sp.minimum_order_quantity,
            ((sp.selling_price / (1 + (h.gst_percentage / 100))) - sp.purchase_price) * 80 / 100 as bv_earned,
            (
                SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('attribute_name', attr.name, 'value', av.value)), ']') 
                FROM product_attributes pa
                JOIN attribute_values av ON pa.attribute_value_id = av.id
                JOIN attributes attr ON av.attribute_id = attr.id
                WHERE pa.product_id = p.id
            ) as attributes
        `;

        // The UNION query is the best way to handle the two priority levels.
        const strictPincodeQuery = `
            -- This subquery wrapper allows us to order the combined results
            SELECT * FROM (
                -- Priority 1: Same Category, Same Pincode
                (SELECT 
                    1 as priority, ${baseSelect}
                FROM seller_products sp
                JOIN products p ON sp.product_id = p.id
                JOIN seller_product_pincodes spp ON sp.id = spp.seller_product_id
                LEFT JOIN brands b ON p.brand_id = b.id
                LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
                WHERE p.category_id = ? AND spp.pincode = ? AND p.id != ? AND sp.is_active = TRUE
                GROUP BY sp.id)
                
                UNION ALL
                
                -- Priority 2: Any Category, Same Pincode
                (SELECT 
                    2 as priority, ${baseSelect}
                FROM seller_products sp
                JOIN products p ON sp.product_id = p.id
                JOIN seller_product_pincodes spp ON sp.id = spp.seller_product_id
                LEFT JOIN brands b ON p.brand_id = b.id
                LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
                WHERE spp.pincode = ? AND p.id != ? AND sp.is_active = TRUE
                -- Exclude products already found in the first query to avoid duplicates
                AND p.id NOT IN (
                    SELECT p_inner.id FROM seller_products sp_inner
                    JOIN products p_inner ON sp_inner.product_id = p_inner.id
                    JOIN seller_product_pincodes spp_inner ON sp_inner.id = spp_inner.seller_product_id
                    WHERE p_inner.category_id = ? AND spp_inner.pincode = ?
                )
                GROUP BY sp.id)
            ) as combined_results
            ORDER BY priority ASC, RAND()
            LIMIT ?
        `;
        
        const [relatedProducts] = await db.query(strictPincodeQuery, [
            categoryId, pincode, productId, // Params for Priority 1
            pincode, productId,             // Params for Priority 2
            categoryId, pincode,             // Params for the sub-query exclusion
            G_LIMIT                         // Final LIMIT
        ]);

        // THE FALLBACK TO OTHER PINCODES HAS BEEN REMOVED.
        
        const processedProducts = relatedProducts.map(row => ({
            ...row,
            priority: undefined, // Remove the helper field
            gallery_image_urls: row.gallery_image_urls ? JSON.parse(row.gallery_image_urls) : [],
            attributes: row.attributes ? JSON.parse(row.attributes) : []
        }));

        res.status(200).json({ status: true, data: processedProducts });

    } catch (error) {
        console.error("Error fetching related products:", error);
        res.status(500).json({ status: false, message: "An error occurred while fetching related products.", error: error.message });
    }
};