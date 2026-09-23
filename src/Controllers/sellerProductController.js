// // Controllers/sellerProductController.js
// const db = require('../../db');
// const SellerProduct = require('../Models/sellerProductModel');


// //  After pincode solution 

// exports.addSellerOffer = async (req, res) => {
//     // ==========================================================
//     // === THE FIX IS HERE ===
//     // ==========================================================
//     // No more hardcoding. The `req.user` object is reliably populated
//     // by the authMiddleware we created.
//     const loggedInUser = req.user; 
//     // ==========================================================
//     // === END OF FIX ===
//     // ==========================================================

//     const connection = await db.getConnection();

//     try {
//         const {
//             productId, sku, mrp, sellingPrice, purchasePrice, quantity,
//             pincodes, low_stock_threshold
//         } = req.body;

//         // The loggedInUser object contains { id, role } from the JWT
//         const [sellerRows] = await connection.query(
//             'SELECT id FROM sellers WHERE sellerable_id = ? AND sellerable_type = ?',
//             [loggedInUser.id, loggedInUser.role] // Use the role from the token
//         );

//         if (sellerRows.length === 0) {
//             // Check if the user is an admin; if so, they can act as a default seller
//             // This is an example of authorization logic.
//             if (loggedInUser.role.toLowerCase() === 'admin') {
//                 // You might have a default "Earn24 Fulfilled" seller profile for the admin
//                 // For now, let's assume admin has a seller profile.
//                 return res.status(403).json({ status: false, message: "Admin user does not have an associated seller profile." });
//             }
//             return res.status(403).json({ status: false, message: "No valid seller profile found for this user." });
//         }
//         const sellerId = sellerRows[0].id;

//         if (!productId || !mrp || !sellingPrice || !quantity || !Array.isArray(pincodes) || pincodes.length === 0 || low_stock_threshold === undefined) {
//             return res.status(400).json({ status: false, message: "Product, price, quantity, pincodes, and low stock threshold are required." });
//         }

//         await connection.beginTransaction();

//         const offerQuery = `
//             INSERT INTO seller_products 
//               (seller_id, product_id, sku, mrp, selling_price, purchase_price, quantity, low_stock_threshold) 
//             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
//         `;
//         const [result] = await connection.query(offerQuery, [sellerId, productId, sku, mrp, sellingPrice, purchasePrice, quantity, low_stock_threshold]);
//         const newOfferId = result.insertId;

//         const pincodeValues = pincodes.map(pincode => [newOfferId, pincode.trim()]);
//         await connection.query('INSERT INTO seller_product_pincodes (seller_product_id, pincode) VALUES ?', [pincodeValues]);

//         await connection.commit();
//         res.status(201).json({ status: true, message: "Product offer added successfully.", offerId: newOfferId });

//     } catch (error) {
//         if (connection) await connection.rollback();
//         if (error.code === 'ER_DUP_ENTRY') {
//             return res.status(409).json({ status: false, message: "You already have a listing for this master product." });
//         }
//         console.error("Error adding seller product:", error);
//         res.status(500).json({ status: false, message: "An error occurred while adding the offer." });
//     } finally {
//         if (connection) connection.release();
//     }
// };




// // Working
// // Public API for the mobile app to search for products
// exports.findProductsByPincode = async (req, res) => {
//     try {
//         const { search, pincode } = req.query;

//         console.log("ssss")
//         if (!pincode) {
//             return res.status(400).json({ status: false, message: "Pincode is required to find products." });
//         }

//         const searchTerm = `%${search || ''}%`;
//         const query = `
//             SELECT
//                 p.name, p.main_image_url, b.name as brand_name,
//                 sp.id as offer_id, sp.selling_price, sp.mrp, sp.quantity,
//                 s.display_name as seller_name
//             FROM seller_products sp
//             JOIN products p ON sp.product_id = p.id
//             JOIN sellers s ON sp.seller_id = s.id
//             LEFT JOIN brands b ON p.brand_id = b.id
//             WHERE 
//                 sp.pincode = ?
//                 AND (p.name LIKE ? OR b.name LIKE ?)
//                 AND sp.is_active = TRUE AND p.is_active = TRUE AND p.is_approved = TRUE
//         `;

//         const [rows] = await db.query(query, [pincode, searchTerm, searchTerm]);
//         res.status(200).json({ status: true, data: rows });

//     } catch (error) {
//         console.error("Error finding products by pincode:", error);
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

//         const dataQuery = `
//             SELECT 
//                 sp.id,
//                 sp.sku,
//                 sp.mrp,
//                 sp.selling_price,
//                 sp.purchase_price,
//                 sp.quantity,
//                 sp.is_active,
//                 sp.low_stock_threshold,
//                 p.id AS product_id,
//                 p.name AS product_name,
//                 p.main_image_url,
//                 p.description,
//                 s.display_name AS seller_name,
//                 h.gst_percentage,
//                 (
//                     SELECT GROUP_CONCAT(pincode) 
//                     FROM seller_product_pincodes 
//                     WHERE seller_product_id = sp.id
//                 ) AS pincodes,
//                 (
//                     SELECT CONCAT(
//                         '[',
//                         GROUP_CONCAT(
//                             JSON_OBJECT(
//                                 'attribute_name', attr.name,
//                                 'value', av.value
//                             )
//                         ),
//                         ']'
//                     )
//                     FROM product_attributes pa
//                     JOIN attribute_values av ON pa.attribute_value_id = av.id
//                     JOIN attributes attr ON av.attribute_id = attr.id
//                     WHERE pa.product_id = p.id
//                 ) AS attributes
//             FROM seller_products sp
//             JOIN products p ON sp.product_id = p.id
//             JOIN sellers s ON sp.seller_id = s.id
//             LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
//             WHERE (p.name LIKE ? OR s.display_name LIKE ?)
//             GROUP BY sp.id
//             ORDER BY sp.created_at DESC
//             LIMIT ? OFFSET ?
//         `;

//         const [rows] = await db.query(dataQuery, [
//             searchPattern,
//             searchPattern,
//             limit,
//             offset
//         ]);

//         const data = rows.map(offer => ({
//             ...offer,
//             pincodes: offer.pincodes ? offer.pincodes.split(',') : [],
//             attributes: offer.attributes ? JSON.parse(offer.attributes) : [],
//             gst_percentage: parseFloat(offer.gst_percentage) || 0
//         }));

//         const countQuery = `
//             SELECT COUNT(DISTINCT sp.id) AS total
//             FROM seller_products sp
//             JOIN products p ON sp.product_id = p.id
//             JOIN sellers s ON sp.seller_id = s.id
//             WHERE (p.name LIKE ? OR s.display_name LIKE ?)
//         `;

//         const [countRows] = await db.query(countQuery, [
//             searchPattern,
//             searchPattern
//         ]);

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
//         res.status(500).json({
//             status: false,
//             message: "An error occurred."
//         });
//     }
// };




// exports.updateSellerOffer = async (req, res) => {
//     const { id } = req.params;
//     const {
//         sku,
//         mrp,
//         sellingPrice,
//         purchasePrice,
//         quantity,
//         is_active,
//         pincodes,
//         low_stock_threshold
//     } = req.body;

//     const connection = await db.getConnection();

//     try {
//         await connection.beginTransaction();

//         const fields = [];
//         const values = [];

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

//         if (is_active !== undefined) {
//             fields.push('is_active = ?');
//             values.push(Boolean(is_active));
//         }

//         if (low_stock_threshold !== undefined) {
//             fields.push('low_stock_threshold = ?');
//             values.push(low_stock_threshold);
//         }

//         if (fields.length > 0) {
//             const updateQuery = `
//                 UPDATE seller_products 
//                 SET ${fields.join(', ')} 
//                 WHERE id = ?
//             `;
//             await connection.query(updateQuery, [...values, id]);
//         }

//         if (Array.isArray(pincodes)) {
//             // Remove old pincodes
//             await connection.query(
//                 'DELETE FROM seller_product_pincodes WHERE seller_product_id = ?',
//                 [id]
//             );

//             // Insert new pincodes
//             if (pincodes.length > 0) {
//                 const pincodeValues = pincodes.map(pincode => [id, pincode.trim()]);
//                 await connection.query(
//                     'INSERT INTO seller_product_pincodes (seller_product_id, pincode) VALUES ?',
//                     [pincodeValues]
//                 );
//             }
//         }

//         await connection.commit();
//         res.status(200).json({
//             status: true,
//             message: "Inventory offer updated successfully."
//         });

//     } catch (error) {
//         if (connection) await connection.rollback();
//         console.error("Error updating seller product:", error);
//         res.status(500).json({
//             status: false,
//             message: "An error occurred during the update."
//         });
//     } finally {
//         if (connection) connection.release();
//     }
// };






// exports.toggleOfferStatus = async (req, res) => {
//     try {
//         const { id } = req.params;
//         const { is_active } = req.body;

//         // Validation: is_active must be a boolean
//         if (typeof is_active !== 'boolean') {
//             return res.status(400).json({ status: false, message: "A valid 'is_active' status (true or false) is required." });
//         }

//         const query = 'UPDATE seller_products SET is_active = ? WHERE id = ?';
//         const [result] = await db.query(query, [is_active, id]);

//         if (result.affectedRows === 0) {
//             return res.status(404).json({ status: false, message: "Inventory offer not found." });
//         }

//         res.status(200).json({ status: true, message: `Offer status updated to ${is_active ? 'Active' : 'Inactive'}.` });

//     } catch (error) {
//         console.error("Error toggling offer status:", error);
//         res.status(500).json({ status: false, message: "An error occurred." });
//     }
// };



// //  Working
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

//         // --- 2. Fetch Categories and Sub-Categories (Unchanged) ---
//         const [parentCategories] = await db.query(
//             `SELECT id, name, image_url FROM product_categories WHERE is_active = TRUE AND is_deleted = FALSE ORDER BY display_order ASC`
//         );
//         const [subCategories] = await db.query(
//             `SELECT id, category_id, name, image_url FROM product_subcategories WHERE is_active = TRUE AND is_deleted = FALSE ORDER BY name ASC`
//         );
//         const categoryTree = parentCategories.map(parent => {
//             const children = subCategories
//                 .filter(sub => sub.category_id === parent.id)
//                 .map(sub => ({
//                     id: sub.id,
//                     name: sub.name,
//                     image_url: sub.image_url,
//                 }));
//             return {
//                 id: parent.id,
//                 name: parent.name,
//                 image_url: parent.image_url,
//                 subCategories: children
//             };
//         });

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
//                 GROUP BY sp.id
//                 ORDER BY p.popularity DESC
//                 LIMIT 10
//             `,
//             [bvGenerationPct, pincode, category.id]
//             )
//         );

//         const productResults = await Promise.all(productPromises);

//         // ==========================================================
//         // === THE FIX IS HERE                                    ===
//         // ==========================================================
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
//                 // --- THIS IS THE MISSING LINE THAT FIXES THE PROBLEM ---
//                 parent_category_id: category.id, 
//                 products: productsWithParsedData
//             };
//         }).filter(section => section.products.length > 0);


//         // --- 5. Combine all data and send the final response ---
//         res.status(200).json({
//             status: true,
//             data: {
//                 banners,
//                 categories: categoryTree,
//                 productSections: categorizedProducts,
//             }
//         });

//     } catch (error) {
//         console.error("Error fetching home screen data:", error);
//         res.status(500).json({ status: false, message: "An internal server error occurred." });
//     }
// };




// exports.getRelatedProducts = async (req, res) => {
//     const { productId } = req.params;
//     const { pincode } = req.query;
//     const G_LIMIT = 10;

//     console.log(`Executing STRICT pincode search for productId: ${productId} with pincode: ${pincode || 'None'}`);

//     // If no pincode is provided by the app, we cannot find related products.
//     // Return an empty list, as per the strict logic.
//     if (!pincode) {
//         return res.status(200).json({ status: true, data: [] });
//     }

//     if (!productId) {
//         return res.status(400).json({ status: false, message: "Product ID is required." });
//     }

//     try {
//         const [productRows] = await db.query('SELECT category_id FROM products WHERE id = ?', [productId]);
//         if (productRows.length === 0) {
//             return res.status(404).json({ status: false, message: "Original product not found." });
//         }
//         const categoryId = productRows[0].category_id;

//         const baseSelect = `
//             p.id as product_id, p.name, p.main_image_url, p.description, p.gallery_image_urls,
//             b.name as brand_name, 
//             sp.id as offer_id, sp.selling_price, sp.mrp, sp.minimum_order_quantity,
//             ((sp.selling_price / (1 + (h.gst_percentage / 100))) - sp.purchase_price) * 80 / 100 as bv_earned,
//             (
//                 SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('attribute_name', attr.name, 'value', av.value)), ']') 
//                 FROM product_attributes pa
//                 JOIN attribute_values av ON pa.attribute_value_id = av.id
//                 JOIN attributes attr ON av.attribute_id = attr.id
//                 WHERE pa.product_id = p.id
//             ) as attributes
//         `;

//         // The UNION query is the best way to handle the two priority levels.
//         const strictPincodeQuery = `
//             -- This subquery wrapper allows us to order the combined results
//             SELECT * FROM (
//                 -- Priority 1: Same Category, Same Pincode
//                 (SELECT 
//                     1 as priority, ${baseSelect}
//                 FROM seller_products sp
//                 JOIN products p ON sp.product_id = p.id
//                 JOIN seller_product_pincodes spp ON sp.id = spp.seller_product_id
//                 LEFT JOIN brands b ON p.brand_id = b.id
//                 LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
//                 WHERE p.category_id = ? AND spp.pincode = ? AND p.id != ? AND sp.is_active = TRUE
//                 GROUP BY sp.id)
                
//                 UNION ALL
                
//                 -- Priority 2: Any Category, Same Pincode
//                 (SELECT 
//                     2 as priority, ${baseSelect}
//                 FROM seller_products sp
//                 JOIN products p ON sp.product_id = p.id
//                 JOIN seller_product_pincodes spp ON sp.id = spp.seller_product_id
//                 LEFT JOIN brands b ON p.brand_id = b.id
//                 LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
//                 WHERE spp.pincode = ? AND p.id != ? AND sp.is_active = TRUE
//                 -- Exclude products already found in the first query to avoid duplicates
//                 AND p.id NOT IN (
//                     SELECT p_inner.id FROM seller_products sp_inner
//                     JOIN products p_inner ON sp_inner.product_id = p_inner.id
//                     JOIN seller_product_pincodes spp_inner ON sp_inner.id = spp_inner.seller_product_id
//                     WHERE p_inner.category_id = ? AND spp_inner.pincode = ?
//                 )
//                 GROUP BY sp.id)
//             ) as combined_results
//             ORDER BY priority ASC, RAND()
//             LIMIT ?
//         `;
        
//         const [relatedProducts] = await db.query(strictPincodeQuery, [
//             categoryId, pincode, productId, // Params for Priority 1
//             pincode, productId,             // Params for Priority 2
//             categoryId, pincode,             // Params for the sub-query exclusion
//             G_LIMIT                         // Final LIMIT
//         ]);

//         // THE FALLBACK TO OTHER PINCODES HAS BEEN REMOVED.
        
//         const processedProducts = relatedProducts.map(row => ({
//             ...row,
//             priority: undefined, // Remove the helper field
//             gallery_image_urls: row.gallery_image_urls ? JSON.parse(row.gallery_image_urls) : [],
//             attributes: row.attributes ? JSON.parse(row.attributes) : []
//         }));

//         res.status(200).json({ status: true, data: processedProducts });

//     } catch (error) {
//         console.error("Error fetching related products:", error);
//         res.status(500).json({ status: false, message: "An error occurred while fetching related products.", error: error.message });
//     }
// };
















// ----------------------------------------Testing----------------------









// Controllers/sellerProductController.js
const db = require('../../db');
const SellerProduct = require('../Models/sellerProductModel');
const path = require('path');
const fs = require('fs');

const ensureSellerProductColumns = async (targetDb = db) => {
    try {
        const [existing] = await targetDb.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'seller_products'`
        );
        const colMap = new Set((existing || []).map(r => r.COLUMN_NAME));

        const colDefs = [
            { col: 'has_return_policy', def: 'TINYINT(1) DEFAULT 1' },
            { col: 'return_window_days', def: 'INT DEFAULT 7' },
            { col: 'is_replacement_available', def: 'TINYINT(1) DEFAULT 1' },
            { col: 'replacement_window_days', def: 'INT DEFAULT 7' },
            { col: 'is_cod_available', def: 'TINYINT(1) DEFAULT 1' },
            { col: 'warranty_type', def: "VARCHAR(50) NULL DEFAULT 'no_warranty'" },
            { col: 'warranty_months', def: 'INT NULL DEFAULT 0' },
            { col: 'warranty_covered_by', def: 'VARCHAR(255) NULL' },
            { col: 'warranty_period', def: 'VARCHAR(100) NULL' },
            { col: 'low_stock_threshold', def: 'INT DEFAULT 5' },
            { col: 'minimum_order_quantity', def: 'INT DEFAULT 1' },
            { col: 'has_variants', def: 'TINYINT(1) DEFAULT 0' }
        ];

        for (const item of colDefs) {
            if (!colMap.has(item.col)) {
                await targetDb.query(`ALTER TABLE \`seller_products\` ADD COLUMN \`${item.col}\` ${item.def}`).catch(err => {
                    if (err.errno !== 1060 && err.code !== 'ER_DUP_FIELDNAME') {
                        console.warn(`[MIGRATION] Note adding column ${item.col}:`, err.message);
                    }
                });
            }
        }
    } catch (err) {
        console.warn("[MIGRATION] ensureSellerProductColumns check error:", err.message);
    }
};

// Immediate background execution on module load
ensureSellerProductColumns().catch(() => {});

const safeJsonParse = (input, fallback = []) => {
  if (!input) return fallback;
  if (typeof input !== 'string') return Array.isArray(input) ? input : fallback;
  try {
    return JSON.parse(input);
  } catch (e) {
    return fallback;
  }
};

function saveBase64Image(base64Str) {
    if (!base64Str || typeof base64Str !== 'string') return null;
    if (!base64Str.startsWith('data:image/')) return base64Str;

    try {
        const matches = base64Str.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) return base64Str;

        const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
        const dataBuffer = Buffer.from(matches[2], 'base64');
        const filename = `variant_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
        const uploadDir = path.join(__dirname, '../../uploads/product-images');

        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const filePath = path.join(uploadDir, filename);
        fs.writeFileSync(filePath, dataBuffer);
        return `/uploads/product-images/${filename}`;
    } catch (e) {
        console.warn("Error saving base64 variant image:", e.message);
        return base64Str;
    }
}


exports.addSellerOffer = async (req, res) => {
    const loggedInUser = req.user; 
    const connection = await db.getConnection();

    try {
        const {
            productId, sku, mrp, sellingPrice, purchasePrice, quantity,
            pincodes, low_stock_threshold, minimum_order_quantity
        } = req.body;

        const [sellerRows] = await connection.query(
            'SELECT id FROM sellers WHERE sellerable_id = ? AND sellerable_type = ?',
            [loggedInUser.id, loggedInUser.role]
        );

        if (sellerRows.length === 0) {
            if (loggedInUser.role.toLowerCase() === 'admin') {
                return res.status(403).json({ status: false, message: "Admin user does not have an associated seller profile." });
            }
            return res.status(403).json({ status: false, message: "No valid seller profile found for this user." });
        }
        const sellerId = sellerRows[0].id;

        const isPanIndia = req.body.is_pan_india === true || req.body.is_pan_india === 1 || req.body.is_pan_india === 'true' || req.body.delivery_type === 'universal' || req.body.is_universal_pincode === 1 || req.body.is_universal_pincode === '1' || (Array.isArray(pincodes) && (pincodes.includes('ALL') || pincodes.includes('PAN_INDIA')));

        if (!productId || !mrp || !sellingPrice || !quantity || (!isPanIndia && (!Array.isArray(pincodes) || pincodes.length === 0)) || low_stock_threshold === undefined || minimum_order_quantity === undefined) {
            return res.status(400).json({ status: false, message: "Product, price, quantity, pincodes, and low stock threshold are required." });
        }

        await connection.beginTransaction();

        const hasReturnPolicy = (req.body.has_return_policy === 1 || req.body.has_return_policy === '1' || req.body.has_return_policy === true || req.body.has_return_policy === 'true') ? 1 : 0;
        const returnWindowDays = hasReturnPolicy ? parseInt(req.body.return_window_days || req.body.return_window || 7, 10) : 0;
        const isReplacementAvailable = (req.body.is_replacement_available === 1 || req.body.is_replacement_available === '1' || req.body.is_replacement_available === true || req.body.is_replacement_available === 'true') ? 1 : 0;
        const replacementWindowDays = isReplacementAvailable ? parseInt(req.body.replacement_window_days || req.body.replacement_window || 7, 10) : 0;
        const isCodAvailable = (req.body.is_cod_available === 0 || req.body.is_cod_available === '0' || req.body.is_cod_available === false || req.body.is_cod_available === 'false') ? 0 : 1;

        // Ensure columns exist on live schema
        await ensureSellerProductColumns(connection);

        const offerQuery = `
            INSERT INTO seller_products 
              (seller_id, product_id, sku, mrp, selling_price, purchase_price, quantity, low_stock_threshold, minimum_order_quantity, warranty_type, warranty_months, warranty_covered_by, has_return_policy, return_window_days, is_replacement_available, replacement_window_days, is_cod_available) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const [result] = await connection.query(offerQuery, [
            sellerId, productId, sku, mrp, sellingPrice, purchasePrice, quantity, low_stock_threshold, minimum_order_quantity,
            req.body.warranty_type || 'no_warranty', parseInt(req.body.warranty_months || 0, 10), req.body.warranty_covered_by || null,
            hasReturnPolicy, returnWindowDays, isReplacementAvailable, replacementWindowDays, isCodAvailable
        ]);
        const newOfferId = result.insertId;

        if (isPanIndia) {
            await connection.query('INSERT INTO seller_product_pincodes (seller_product_id, pincode) VALUES (?, ?)', [newOfferId, 'ALL']);
        } else if (Array.isArray(pincodes) && pincodes.length > 0) {
            const pincodeValues = pincodes.map(pincode => [newOfferId, pincode.trim()]);
            await connection.query('INSERT INTO seller_product_pincodes (seller_product_id, pincode) VALUES ?', [pincodeValues]);
        }

        let variantsList = req.body.variants;
        if (typeof variantsList === 'string') {
            try { variantsList = JSON.parse(variantsList); } catch(e) { variantsList = []; }
        }
        if (Array.isArray(variantsList) && variantsList.length > 0) {
            for (const v of variantsList) {
                if (v && (v.title || v.size || v.color || v.price)) {
                    const vImg = saveBase64Image(v.variant_image_url || v.image_url) || null;
                    await connection.query(
                        `INSERT INTO seller_product_variants (seller_product_id, title, color, size, sku, price, mrp, stock_quantity, variant_image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [newOfferId, v.title || `${v.color || ''} ${v.size || ''}`.trim() || 'Variant', v.color || null, v.size || null, v.sku || null, parseFloat(v.price || sellingPrice || 0), parseFloat(v.mrp || mrp || 0), parseInt(v.quantity || v.stock_quantity || quantity || 0, 10), vImg]
                    ).catch(() => {});
                }
            }
        }

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

// // Updated: Added Attributes to Search API & Universal Pan-India Pincode Support
exports.findProductsByPincode = async (req, res) => {
    try {
        const { search, pincode } = req.query;
        const searchTerm = `%${search || ''}%`;
        const isPincodeProvided = pincode && pincode !== 'ALL' && pincode !== 'null' && pincode !== 'undefined';

        let query = '';
        let queryParams = [];

        if (isPincodeProvided) {
            query = `
                SELECT
                    p.id as product_id, p.name, p.description, p.main_image_url, p.gallery_image_urls, b.name as brand_name,
                    sp.id as offer_id, sp.selling_price, sp.mrp, sp.quantity, sp.minimum_order_quantity,
                    COALESCE(m.business_name, s.display_name, 'Earn24 Official') as seller_name,
                    (SELECT IFNULL(ROUND(AVG(rating), 1), 0) FROM product_reviews WHERE product_id = p.id AND status = 'APPROVED') AS avg_rating,
                    (SELECT COUNT(*) FROM product_reviews WHERE product_id = p.id AND status = 'APPROVED') AS total_reviews,
                    GREATEST(0, IF(IFNULL(sp.admin_margin_percent, 0) > 0, (sp.selling_price * (IFNULL(sp.admin_margin_percent, 10.0) / 100)) * 0.80, ((sp.selling_price / (1 + (IFNULL(h.gst_percentage, 0) / 100))) - sp.purchase_price) * 0.80)) as bv_earned,
                    (
                        SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('attribute_name', attr.name, 'value', av.value)), ']') 
                        FROM product_attributes pa
                        JOIN attribute_values av ON pa.attribute_value_id = av.id
                        JOIN attributes attr ON av.attribute_id = attr.id
                        WHERE pa.product_id = p.id
                    ) as attributes,
                    (
                        SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('id', spv.id, 'title', spv.title, 'color', spv.color, 'size', spv.size, 'sku', spv.sku, 'price', spv.price, 'mrp', spv.mrp, 'stock_quantity', spv.stock_quantity, 'variant_image_url', spv.variant_image_url, 'variant_image_urls', spv.variant_image_urls)), ']')
                        FROM seller_product_variants spv WHERE spv.seller_product_id = sp.id
                    ) as variants
                FROM seller_products sp
                JOIN products p ON sp.product_id = p.id
                JOIN sellers s ON sp.seller_id = s.id
                LEFT JOIN merchants m ON s.sellerable_id = m.id AND s.sellerable_type = 'Merchant'
                LEFT JOIN seller_product_pincodes spp ON sp.id = spp.seller_product_id
                LEFT JOIN brands b ON p.brand_id = b.id
                LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
                WHERE 
                    (spp.pincode = ? OR spp.pincode IS NULL OR spp.pincode = '')
                    AND (p.name LIKE ? OR b.name LIKE ?)
                    AND sp.is_active = TRUE AND p.is_active = TRUE AND p.is_approved = TRUE
                GROUP BY sp.id
            `;
            queryParams = [pincode, searchTerm, searchTerm];
        } else {
            query = `
                SELECT
                    p.id as product_id, p.name, p.description, p.main_image_url, p.gallery_image_urls, b.name as brand_name,
                    sp.id as offer_id, sp.selling_price, sp.mrp, sp.quantity, sp.minimum_order_quantity,
                    COALESCE(m.business_name, s.display_name, 'Earn24 Official') as seller_name,
                    (SELECT IFNULL(ROUND(AVG(rating), 1), 0) FROM product_reviews WHERE product_id = p.id AND status = 'APPROVED') AS avg_rating,
                    (SELECT COUNT(*) FROM product_reviews WHERE product_id = p.id AND status = 'APPROVED') AS total_reviews,
                    GREATEST(0, IF(IFNULL(sp.admin_margin_percent, 0) > 0, (sp.selling_price * (IFNULL(sp.admin_margin_percent, 10.0) / 100)) * 0.80, ((sp.selling_price / (1 + (IFNULL(h.gst_percentage, 0) / 100))) - sp.purchase_price) * 0.80)) as bv_earned,
                    (
                        SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('attribute_name', attr.name, 'value', av.value)), ']') 
                        FROM product_attributes pa
                        JOIN attribute_values av ON pa.attribute_value_id = av.id
                        JOIN attributes attr ON av.attribute_id = attr.id
                        WHERE pa.product_id = p.id
                    ) as attributes,
                    (
                        SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('id', spv.id, 'title', spv.title, 'color', spv.color, 'size', spv.size, 'sku', spv.sku, 'price', spv.price, 'mrp', spv.mrp, 'stock_quantity', spv.stock_quantity, 'variant_image_url', spv.variant_image_url, 'variant_image_urls', spv.variant_image_urls)), ']')
                        FROM seller_product_variants spv WHERE spv.seller_product_id = sp.id
                    ) as variants
                FROM seller_products sp
                JOIN products p ON sp.product_id = p.id
                JOIN sellers s ON sp.seller_id = s.id
                LEFT JOIN merchants m ON s.sellerable_id = m.id AND s.sellerable_type = 'Merchant'
                LEFT JOIN brands b ON p.brand_id = b.id
                LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
                WHERE 
                    (p.name LIKE ? OR b.name LIKE ?)
                    AND sp.is_active = TRUE AND p.is_active = TRUE AND p.is_approved = TRUE
                GROUP BY sp.id
            `;
            queryParams = [searchTerm, searchTerm];
        }

        await db.query("SET SESSION group_concat_max_len = 100000").catch(() => {});
        const [rows] = await db.query(query, queryParams);

        const processedData = rows.map(row => ({
            ...row,
            attributes: safeJsonParse(row.attributes, []),
            gallery_image_urls: safeJsonParse(row.gallery_image_urls, []),
            variants: safeJsonParse(row.variants, [])
        }));

        res.status(200).json({ status: true, data: processedData });

    } catch (error) {
        console.error("Error finding products by pincode:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};

exports.getAllSellerOffers = async (req, res) => {
    try {
        await ensureSellerProductColumns();
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const search = req.query.search || '';
        const offset = (page - 1) * limit;
        const searchPattern = `%${search}%`;

        const dataQuery = `
            SELECT 
                sp.id, sp.sku, sp.mrp, sp.selling_price, sp.purchase_price, sp.merchant_price, sp.admin_margin_percent, sp.quantity,
                sp.is_active, sp.low_stock_threshold, sp.minimum_order_quantity, sp.created_at,
                sp.warranty_type, sp.warranty_months, sp.warranty_covered_by,
                sp.has_return_policy, sp.return_window_days, sp.is_replacement_available, sp.replacement_window_days, sp.is_cod_available,
                p.id AS product_id, p.name AS product_name, p.main_image_url, p.description, p.is_universal_pincode,
                s.display_name AS seller_name, s.sellerable_type, s.sellerable_id,
                m.business_name AS merchant_business_name, m.owner_name AS merchant_owner_name, m.phone_number AS merchant_phone,
                h.gst_percentage,
                (SELECT IFNULL(ROUND(AVG(rating), 1), 0) FROM product_reviews WHERE product_id = p.id AND status = 'APPROVED') AS avg_rating,
                (SELECT COUNT(*) FROM product_reviews WHERE product_id = p.id AND status = 'APPROVED') AS total_reviews,
                GREATEST(0, IF(IFNULL(sp.admin_margin_percent, 0) > 0, (sp.selling_price * (IFNULL(sp.admin_margin_percent, 10.0) / 100)) * 0.80, ((sp.selling_price / (1 + (IFNULL(h.gst_percentage, 0) / 100))) - sp.purchase_price) * 0.80)) as bv_earned,
                (SELECT GROUP_CONCAT(pincode) FROM seller_product_pincodes WHERE seller_product_id = sp.id) AS pincodes,
                (
                    SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('attribute_name', attr.name, 'value', av.value)), ']')
                    FROM product_attributes pa
                    JOIN attribute_values av ON pa.attribute_value_id = av.id
                    JOIN attributes attr ON av.attribute_id = attr.id
                    WHERE pa.product_id = p.id
                ) AS attributes,
                (
                    SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('id', spv.id, 'title', spv.title, 'color', spv.color, 'size', spv.size, 'sku', spv.sku, 'price', spv.price, 'mrp', spv.mrp, 'stock_quantity', spv.stock_quantity, 'variant_image_url', spv.variant_image_url, 'variant_image_urls', spv.variant_image_urls)), ']')
                    FROM seller_product_variants spv WHERE spv.seller_product_id = sp.id
                ) AS variants
            FROM seller_products sp
            JOIN products p ON sp.product_id = p.id
            JOIN sellers s ON sp.seller_id = s.id
            LEFT JOIN merchants m ON s.sellerable_id = m.id AND s.sellerable_type = 'Merchant'
            LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
            WHERE (p.name LIKE ? OR s.display_name LIKE ? OR m.business_name LIKE ? OR m.owner_name LIKE ?)
            GROUP BY sp.id
            ORDER BY sp.created_at DESC
            LIMIT ? OFFSET ?
        `;

        const [rows] = await db.query(dataQuery, [searchPattern, searchPattern, searchPattern, searchPattern, limit, offset]);

        const data = rows.map(offer => {
            let parsedAttributes = [];
            try {
                parsedAttributes = offer.attributes ? (typeof offer.attributes === 'string' ? JSON.parse(offer.attributes) : offer.attributes) : [];
            } catch (e) { parsedAttributes = []; }

            let parsedVariants = [];
            try {
                parsedVariants = offer.variants ? (typeof offer.variants === 'string' ? JSON.parse(offer.variants) : offer.variants) : [];
            } catch (e) { parsedVariants = []; }

            return {
                ...offer,
                pincodes: offer.pincodes ? offer.pincodes.split(',') : [],
                attributes: parsedAttributes,
                variants: parsedVariants,
                gst_percentage: parseFloat(offer.gst_percentage) || 0
            };
        });

        const countQuery = `SELECT COUNT(DISTINCT sp.id) AS total FROM seller_products sp JOIN products p ON sp.product_id = p.id JOIN sellers s ON sp.seller_id = s.id LEFT JOIN merchants m ON s.sellerable_id = m.id AND s.sellerable_type = 'Merchant' WHERE (p.name LIKE ? OR s.display_name LIKE ? OR m.business_name LIKE ? OR m.owner_name LIKE ?)`;
        const [countRows] = await db.query(countQuery, [searchPattern, searchPattern, searchPattern, searchPattern]);

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
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};

exports.updateSellerOffer = async (req, res) => {
    const { id } = req.params;
    console.log(`[UPDATE OFFER] Offer ID: ${id}, Body:`, req.body);
    const { sku, mrp, sellingPrice, purchasePrice, quantity, is_active, pincodes, low_stock_threshold, minimum_order_quantity } = req.body;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();
        const fields = [];
        const values = [];

        if (sku !== undefined) { fields.push('sku = ?'); values.push(sku); }
        if (mrp !== undefined) { fields.push('mrp = ?'); values.push(mrp); }
        if (sellingPrice !== undefined) { fields.push('selling_price = ?'); values.push(sellingPrice); }
        if (purchasePrice !== undefined) { fields.push('purchase_price = ?'); values.push(purchasePrice); }
        if (quantity !== undefined) { fields.push('quantity = ?'); values.push(quantity); }
        if (is_active !== undefined) { fields.push('is_active = ?'); values.push(Boolean(is_active)); }
        if (low_stock_threshold !== undefined) { fields.push('low_stock_threshold = ?'); values.push(low_stock_threshold); }

        if (minimum_order_quantity !== undefined) { 
            fields.push('minimum_order_quantity = ?'); 
            values.push(minimum_order_quantity); 
        }

        if (req.body.warranty_type !== undefined) { fields.push('warranty_type = ?'); values.push(req.body.warranty_type); }
        if (req.body.warranty_months !== undefined) { fields.push('warranty_months = ?'); values.push(parseInt(req.body.warranty_months, 10)); }
        if (req.body.warranty_covered_by !== undefined) { fields.push('warranty_covered_by = ?'); values.push(req.body.warranty_covered_by); }
        if (req.body.warranty_period !== undefined) { fields.push('warranty_period = ?'); values.push(req.body.warranty_period); }

        if (req.body.has_return_policy !== undefined) { fields.push('has_return_policy = ?'); values.push((req.body.has_return_policy === 1 || req.body.has_return_policy === '1' || req.body.has_return_policy === true || req.body.has_return_policy === 'true') ? 1 : 0); }
        if (req.body.return_window_days !== undefined) { fields.push('return_window_days = ?'); values.push(parseInt(req.body.return_window_days, 10)); }
        if (req.body.is_replacement_available !== undefined) { fields.push('is_replacement_available = ?'); values.push((req.body.is_replacement_available === 1 || req.body.is_replacement_available === '1' || req.body.is_replacement_available === true || req.body.is_replacement_available === 'true') ? 1 : 0); }
        if (req.body.replacement_window_days !== undefined) { fields.push('replacement_window_days = ?'); values.push(parseInt(req.body.replacement_window_days, 10)); }
        if (req.body.is_cod_available !== undefined) { fields.push('is_cod_available = ?'); values.push((req.body.is_cod_available === 1 || req.body.is_cod_available === '1' || req.body.is_cod_available === true || req.body.is_cod_available === 'true') ? 1 : 0); }

        if (fields.length > 0) {
            // Ensure columns exist on live schema
            await ensureSellerProductColumns(connection);

            const updateQuery = `UPDATE seller_products SET ${fields.join(', ')} WHERE id = ?`;
            await connection.query(updateQuery, [...values, id]);
        }

        const deliveryType = req.body.delivery_type || req.body.pincode_type;
        const isUniversalProvided = req.body.is_universal_pincode !== undefined || req.body.is_pan_india !== undefined || deliveryType !== undefined;
        let pincodeList = pincodes;
        if (typeof pincodeList === 'string') {
            try { pincodeList = JSON.parse(pincodeList); } catch (e) { pincodeList = pincodeList.split(',').map(p => p.trim()).filter(Boolean); }
        }

        const [spRow] = await connection.query('SELECT product_id FROM seller_products WHERE id = ?', [id]);
        const matchedProductId = spRow && spRow[0] ? spRow[0].product_id : null;

        if (isUniversalProvided) {
            const isUniversal = (deliveryType === 'universal' || deliveryType === 'pan_india' || req.body.is_pan_india === true || req.body.is_pan_india === 1 || req.body.is_pan_india === 'true' || req.body.is_universal_pincode === 1 || req.body.is_universal_pincode === '1' || req.body.is_universal_pincode === true || req.body.is_universal_pincode === 'true') ? 1 : 0;
            if (matchedProductId) {
                await connection.query('UPDATE products SET is_universal_pincode = ? WHERE id = ?', [isUniversal, matchedProductId]);
            }
            await connection.query('DELETE FROM seller_product_pincodes WHERE seller_product_id = ?', [id]);
            if (isUniversal === 1) {
                await connection.query('INSERT INTO seller_product_pincodes (seller_product_id, pincode) VALUES (?, ?)', [id, 'ALL']);
            } else if (Array.isArray(pincodeList) && pincodeList.length > 0) {
                const pincodeValues = pincodeList.map(pincode => [id, String(pincode).trim()]);
                await connection.query('INSERT INTO seller_product_pincodes (seller_product_id, pincode) VALUES ?', [pincodeValues]);
            }
        } else if (pincodeList !== undefined) {
            if (Array.isArray(pincodeList)) {
                await connection.query('DELETE FROM seller_product_pincodes WHERE seller_product_id = ?', [id]);
                if (pincodeList.length > 0) {
                    const pincodeValues = pincodeList.map(pincode => [id, String(pincode).trim()]);
                    await connection.query('INSERT INTO seller_product_pincodes (seller_product_id, pincode) VALUES ?', [pincodeValues]);
                }
            }
        }

        if (req.body.variants !== undefined) {
            let variantsList = req.body.variants;
            if (typeof variantsList === 'string') {
                try { variantsList = JSON.parse(variantsList); } catch(e) { variantsList = []; }
            }
            if (Array.isArray(variantsList)) {
                await connection.query('ALTER TABLE seller_product_variants MODIFY COLUMN product_id INT NULL').catch(() => {});
                await connection.query('ALTER TABLE seller_product_variants MODIFY COLUMN variant_image_url LONGTEXT NULL').catch(() => {});
                await connection.query('DELETE FROM seller_product_variants WHERE seller_product_id = ?', [id]);

                for (const v of variantsList) {
                    if (v && (v.title || v.size || v.color || v.price)) {
                        let vImg = v.variant_image_url || v.image_url || null;
                        if (vImg && typeof vImg === 'string' && vImg.startsWith('data:image/')) {
                            vImg = saveBase64Image(vImg) || null;
                        }
                        await connection.query(
                            `INSERT INTO seller_product_variants (seller_product_id, product_id, title, color, size, sku, price, mrp, stock_quantity, variant_image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [id, matchedProductId, v.title || `${v.color || ''} ${v.size || ''}`.trim() || 'Variant', v.color || null, v.size || null, v.sku || null, parseFloat(v.price || sellingPrice || 0), parseFloat(v.mrp || mrp || 0), parseInt(v.quantity || v.stock_quantity || quantity || 0, 10), vImg]
                        ).catch((err) => console.error('[Variant Insert Warning]:', err.message));
                    }
                }
                const hasVariants = variantsList.length > 0 ? 1 : 0;
                await connection.query('UPDATE seller_products SET has_variants = ? WHERE id = ?', [hasVariants, id]).catch(() => {});
            }
        }

        await connection.commit();
        res.status(200).json({ status: true, message: "Inventory offer updated successfully." });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('[UPDATE OFFER ERROR]:', error);
        res.status(500).json({ status: false, message: error.message || "An error occurred during the update." });
    } finally {
        if (connection) connection.release();
    }
};

exports.toggleOfferStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { is_active } = req.body;
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
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};

exports.getHomeScreenData = async (req, res) => {
    const { pincode } = req.query;
    const isPincodeProvided = pincode && pincode !== 'ALL' && pincode !== 'null' && pincode !== 'undefined';

    try {
        const [banners] = await db.query(`SELECT id, image_url, link_to, title FROM banners WHERE is_active = TRUE ORDER BY display_order ASC`);
        let parentCategories = [];
        let subCategories = [];

        if (isPincodeProvided) {
            const [parents] = await db.query(`
                SELECT DISTINCT pc.id, pc.name, pc.image_url 
                FROM product_categories pc 
                JOIN products p ON p.category_id = pc.id 
                JOIN seller_products sp ON sp.product_id = p.id 
                LEFT JOIN seller_product_pincodes spp ON sp.id = spp.seller_product_id 
                WHERE pc.is_active = TRUE AND pc.is_deleted = FALSE 
                  AND p.is_active = TRUE AND p.is_deleted = FALSE 
                  AND sp.is_active = TRUE AND sp.selling_price > 0 
                  AND (p.is_universal_pincode = 1 OR spp.pincode = ? OR spp.pincode = 'ALL' OR NOT EXISTS (SELECT 1 FROM seller_product_pincodes spp_check WHERE spp_check.seller_product_id = sp.id))
                ORDER BY pc.id ASC
            `, [pincode]);
            parentCategories = parents;

            const [subs] = await db.query(`
                SELECT DISTINCT psc.id, psc.category_id, psc.name, psc.image_url 
                FROM product_subcategories psc 
                JOIN products p ON p.subcategory_id = psc.id 
                JOIN seller_products sp ON sp.product_id = p.id 
                LEFT JOIN seller_product_pincodes spp ON sp.id = spp.seller_product_id 
                WHERE psc.is_active = TRUE AND psc.is_deleted = FALSE 
                  AND p.is_active = TRUE AND p.is_deleted = FALSE 
                  AND sp.is_active = TRUE AND sp.selling_price > 0 
                  AND (p.is_universal_pincode = 1 OR spp.pincode = ? OR spp.pincode = 'ALL' OR NOT EXISTS (SELECT 1 FROM seller_product_pincodes spp_check WHERE spp_check.seller_product_id = sp.id))
                ORDER BY psc.name ASC
            `, [pincode]);
            subCategories = subs;
        } else {
            const [parents] = await db.query(`
                SELECT DISTINCT pc.id, pc.name, pc.image_url 
                FROM product_categories pc 
                JOIN products p ON p.category_id = pc.id 
                JOIN seller_products sp ON sp.product_id = p.id 
                WHERE pc.is_active = TRUE AND pc.is_deleted = FALSE 
                  AND p.is_active = TRUE AND p.is_deleted = FALSE 
                  AND sp.is_active = TRUE AND sp.selling_price > 0 
                  AND (p.is_universal_pincode = 1 OR NOT EXISTS (SELECT 1 FROM seller_product_pincodes spp_check WHERE spp_check.seller_product_id = sp.id))
                ORDER BY pc.id ASC
            `);
            parentCategories = parents;

            const [subs] = await db.query(`
                SELECT DISTINCT psc.id, psc.category_id, psc.name, psc.image_url 
                FROM product_subcategories psc 
                JOIN products p ON p.subcategory_id = psc.id 
                JOIN seller_products sp ON sp.product_id = p.id 
                WHERE psc.is_active = TRUE AND psc.is_deleted = FALSE 
                  AND p.is_active = TRUE AND p.is_deleted = FALSE 
                  AND sp.is_active = TRUE AND sp.selling_price > 0 
                  AND (p.is_universal_pincode = 1 OR NOT EXISTS (SELECT 1 FROM seller_product_pincodes spp_check WHERE spp_check.seller_product_id = sp.id))
                ORDER BY psc.name ASC
            `);
            subCategories = subs;
        }
        
        const categoryTree = parentCategories.map(parent => ({
            id: parent.id, name: parent.name, image_url: parent.image_url,
            subCategories: subCategories.filter(sub => sub.category_id === parent.id)
        }));

        const [settingsRows] = await db.query("SELECT setting_key, setting_value FROM app_settings WHERE setting_key = 'bv_generation_pct_of_profit'");
        const bvGenerationPct = settingsRows[0] ? parseFloat(settingsRows[0].setting_value) : 80.0;

        const productPromises = categoryTree.map(category => {
            if (isPincodeProvided) {
                return db.query(`
                    SELECT 
                        p.id as product_id, p.name, p.description, p.main_image_url, p.gallery_image_urls,
                        sp.id as offer_id, b.name as brand_name, sp.selling_price, sp.mrp,
                        sp.purchase_price, sp.minimum_order_quantity,
                        sp.warranty_type, sp.warranty_months, sp.warranty_covered_by, sp.warranty_period,
                        sp.has_return_policy, sp.return_window_days, sp.is_replacement_available, sp.replacement_window_days,
                        COALESCE(m.business_name, s.display_name, 'Earn24 Official') as seller_name,
                        (SELECT IFNULL(ROUND(AVG(rating), 1), 0) FROM product_reviews WHERE product_id = p.id AND status = 'APPROVED') AS avg_rating,
                        (SELECT COUNT(*) FROM product_reviews WHERE product_id = p.id AND status = 'APPROVED') AS total_reviews,
                        GREATEST(0, IF(IFNULL(sp.admin_margin_percent, 0) > 0, (sp.selling_price * (IFNULL(sp.admin_margin_percent, 10.0) / 100)) * (? / 100), ((sp.selling_price / (1 + (IFNULL(h.gst_percentage, 0) / 100))) - sp.purchase_price) * (? / 100))) as bv_earned,
                        (
                            SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('attribute_name', attr.name, 'value', av.value)), ']') 
                            FROM product_attributes pa
                            JOIN attribute_values av ON pa.attribute_value_id = av.id
                            JOIN attributes attr ON av.attribute_id = attr.id
                            WHERE pa.product_id = p.id
                        ) as attributes,
                        (
                            SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('id', spv.id, 'title', spv.title, 'color', spv.color, 'size', spv.size, 'sku', spv.sku, 'price', spv.price, 'mrp', spv.mrp, 'stock_quantity', spv.stock_quantity, 'variant_image_url', spv.variant_image_url)), ']')
                            FROM seller_product_variants spv WHERE spv.seller_product_id = sp.id
                        ) as variants
                    FROM seller_products sp
                    JOIN sellers s ON sp.seller_id = s.id
                    LEFT JOIN merchants m ON s.sellerable_id = m.id AND s.sellerable_type = 'Merchant'
                    LEFT JOIN seller_product_pincodes spp ON sp.id = spp.seller_product_id
                    JOIN products p ON sp.product_id = p.id
                    LEFT JOIN brands b ON p.brand_id = b.id
                    LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id 
                    WHERE (
                        p.is_universal_pincode = 1 
                        OR spp.pincode = ? 
                        OR spp.pincode = 'ALL'
                        OR NOT EXISTS (SELECT 1 FROM seller_product_pincodes spp_check WHERE spp_check.seller_product_id = sp.id)
                    ) AND p.category_id = ? AND sp.is_active = TRUE
                    GROUP BY sp.id ORDER BY p.popularity DESC LIMIT 10
                `, [bvGenerationPct, bvGenerationPct, pincode, category.id]);
            } else {
                return db.query(`
                    SELECT 
                        p.id as product_id, p.name, p.description, p.main_image_url, p.gallery_image_urls,
                        sp.id as offer_id, b.name as brand_name, sp.selling_price, sp.mrp,
                        sp.purchase_price, sp.minimum_order_quantity,
                        sp.warranty_type, sp.warranty_months, sp.warranty_covered_by, sp.warranty_period,
                        sp.has_return_policy, sp.return_window_days, sp.is_replacement_available, sp.replacement_window_days,
                        COALESCE(m.business_name, s.display_name, 'Earn24 Official') as seller_name,
                        (SELECT IFNULL(ROUND(AVG(rating), 1), 0) FROM product_reviews WHERE product_id = p.id AND status = 'APPROVED') AS avg_rating,
                        (SELECT COUNT(*) FROM product_reviews WHERE product_id = p.id AND status = 'APPROVED') AS total_reviews,
                        GREATEST(0, IF(IFNULL(sp.admin_margin_percent, 0) > 0, (sp.selling_price * (IFNULL(sp.admin_margin_percent, 10.0) / 100)) * (? / 100), ((sp.selling_price / (1 + (IFNULL(h.gst_percentage, 0) / 100))) - sp.purchase_price) * (? / 100))) as bv_earned,
                        (
                            SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('attribute_name', attr.name, 'value', av.value)), ']') 
                            FROM product_attributes pa
                            JOIN attribute_values av ON pa.attribute_value_id = av.id
                            JOIN attributes attr ON av.attribute_id = attr.id
                            WHERE pa.product_id = p.id
                        ) as attributes,
                        (
                            SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('id', spv.id, 'title', spv.title, 'color', spv.color, 'size', spv.size, 'sku', spv.sku, 'price', spv.price, 'mrp', spv.mrp, 'stock_quantity', spv.stock_quantity, 'variant_image_url', spv.variant_image_url)), ']')
                            FROM seller_product_variants spv WHERE spv.seller_product_id = sp.id
                        ) as variants
                    FROM seller_products sp
                    JOIN sellers s ON sp.seller_id = s.id
                    LEFT JOIN merchants m ON s.sellerable_id = m.id AND s.sellerable_type = 'Merchant'
                    JOIN products p ON sp.product_id = p.id
                    LEFT JOIN brands b ON p.brand_id = b.id
                    LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id 
                    WHERE (
                        p.is_universal_pincode = 1 
                        OR NOT EXISTS (SELECT 1 FROM seller_product_pincodes spp_check WHERE spp_check.seller_product_id = sp.id)
                    ) AND p.category_id = ? AND sp.is_active = TRUE
                    GROUP BY sp.id ORDER BY p.popularity DESC LIMIT 10
                `, [bvGenerationPct, bvGenerationPct, category.id]);
            }
        });

        const productResults = await Promise.all(productPromises);

        const categorizedProducts = categoryTree.map((category, index) => {
            const rawProducts = productResults[index][0];
            const productsParsed = rawProducts.map(p => {
                let parsedGallery = [];
                if (p.gallery_image_urls) {
                    try { parsedGallery = typeof p.gallery_image_urls === 'string' ? JSON.parse(p.gallery_image_urls) : p.gallery_image_urls; } catch (e) { parsedGallery = []; }
                }
                let parsedAttr = [];
                if (p.attributes) {
                    try { parsedAttr = typeof p.attributes === 'string' ? JSON.parse(p.attributes) : p.attributes; } catch (e) { parsedAttr = []; }
                }
                let parsedVars = [];
                if (p.variants) {
                    try { parsedVars = typeof p.variants === 'string' ? JSON.parse(p.variants) : p.variants; } catch (e) { parsedVars = []; }
                }
                return {
                    ...p,
                    gallery_image_urls: Array.isArray(parsedGallery) ? parsedGallery : [],
                    attributes: Array.isArray(parsedAttr) ? parsedAttr : [],
                    variants: Array.isArray(parsedVars) ? parsedVars : []
                };
            });
            return {
                id: category.id,
                title: `Best in ${category.name}`,
                parent_category_id: category.id,
                products: productsParsed
            };
        }).filter(section => section.products.length > 0);

        // --- 7. DATABASE-DRIVEN TOP BV & SUPER DEALS ACROSS WHOLE STORE ---
        let topBvQuery = '';
        let topBvParams = [];

        if (isPincodeProvided) {
            topBvQuery = `
                SELECT 
                    p.id as product_id, p.name, p.description, p.main_image_url, p.gallery_image_urls,
                    p.category_id, p.subcategory_id,
                    sp.id as offer_id, b.name as brand_name, sp.selling_price, sp.mrp,
                    sp.purchase_price, sp.minimum_order_quantity,
                    COALESCE(m.business_name, s.display_name, 'Earn24 Official') as seller_name,
                    sp.warranty_type, sp.warranty_months, sp.warranty_covered_by, sp.warranty_period,
                    sp.has_return_policy, sp.return_window_days, sp.is_replacement_available, sp.replacement_window_days,
                    IFNULL(sp.is_cod_available, 1) as is_cod_available,
                    psc.has_return_policy as subcat_has_return_policy, psc.return_window_days as subcat_return_window_days,
                    psc.is_replacement_available as subcat_is_replacement_available, psc.replacement_window_days as subcat_replacement_window_days,
                    (SELECT IFNULL(ROUND(AVG(rating), 1), 0) FROM product_reviews WHERE product_id = p.id AND status = 'APPROVED') AS avg_rating,
                    (SELECT COUNT(*) FROM product_reviews WHERE product_id = p.id AND status = 'APPROVED') AS total_reviews,
                    GREATEST(0, IF(IFNULL(sp.admin_margin_percent, 0) > 0, (sp.selling_price * (IFNULL(sp.admin_margin_percent, 10.0) / 100)) * (? / 100), ((sp.selling_price / (1 + (IFNULL(h.gst_percentage, 0) / 100))) - sp.purchase_price) * (? / 100))) as bv_earned,
                    (
                        SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('attribute_name', attr.name, 'value', av.value)), ']') 
                        FROM product_attributes pa
                        JOIN attribute_values av ON pa.attribute_value_id = av.id
                        JOIN attributes attr ON av.attribute_id = attr.id
                        WHERE pa.product_id = p.id
                    ) as attributes,
                    (
                        SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('id', spv.id, 'title', spv.title, 'color', spv.color, 'size', spv.size, 'sku', spv.sku, 'price', spv.price, 'mrp', spv.mrp, 'stock_quantity', spv.stock_quantity, 'variant_image_url', spv.variant_image_url, 'variant_image_urls', spv.variant_image_urls)), ']')
                        FROM seller_product_variants spv WHERE spv.seller_product_id = sp.id AND (spv.is_active = TRUE OR spv.is_active IS NULL)
                    ) as variants
                FROM seller_products sp
                JOIN sellers s ON sp.seller_id = s.id
                LEFT JOIN merchants m ON s.sellerable_id = m.id AND s.sellerable_type = 'Merchant'
                LEFT JOIN seller_product_pincodes spp ON sp.id = spp.seller_product_id
                JOIN products p ON sp.product_id = p.id
                LEFT JOIN product_subcategories psc ON p.subcategory_id = psc.id
                LEFT JOIN brands b ON p.brand_id = b.id
                LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id 
                WHERE (
                    p.is_universal_pincode = 1 
                    OR spp.pincode = ? 
                    OR spp.pincode = 'ALL'
                    OR NOT EXISTS (SELECT 1 FROM seller_product_pincodes spp_check WHERE spp_check.seller_product_id = sp.id)
                ) AND p.is_active = TRUE AND p.is_deleted = FALSE AND sp.is_active = TRUE AND sp.selling_price > 0
                GROUP BY sp.id 
                ORDER BY bv_earned DESC, ((sp.mrp - sp.selling_price) / sp.mrp) DESC 
                LIMIT 25
            `;
            topBvParams = [bvGenerationPct, bvGenerationPct, pincode];
        } else {
            topBvQuery = `
                SELECT 
                    p.id as product_id, p.name, p.description, p.main_image_url, p.gallery_image_urls,
                    p.category_id, p.subcategory_id,
                    sp.id as offer_id, b.name as brand_name, sp.selling_price, sp.mrp,
                    sp.purchase_price, sp.minimum_order_quantity,
                    COALESCE(m.business_name, s.display_name, 'Earn24 Official') as seller_name,
                    sp.warranty_type, sp.warranty_months, sp.warranty_covered_by, sp.warranty_period,
                    sp.has_return_policy, sp.return_window_days, sp.is_replacement_available, sp.replacement_window_days,
                    IFNULL(sp.is_cod_available, 1) as is_cod_available,
                    psc.has_return_policy as subcat_has_return_policy, psc.return_window_days as subcat_return_window_days,
                    psc.is_replacement_available as subcat_is_replacement_available, psc.replacement_window_days as subcat_replacement_window_days,
                    (SELECT IFNULL(ROUND(AVG(rating), 1), 0) FROM product_reviews WHERE product_id = p.id AND status = 'APPROVED') AS avg_rating,
                    (SELECT COUNT(*) FROM product_reviews WHERE product_id = p.id AND status = 'APPROVED') AS total_reviews,
                    GREATEST(0, IF(IFNULL(sp.admin_margin_percent, 0) > 0, (sp.selling_price * (IFNULL(sp.admin_margin_percent, 10.0) / 100)) * (? / 100), ((sp.selling_price / (1 + (IFNULL(h.gst_percentage, 0) / 100))) - sp.purchase_price) * (? / 100))) as bv_earned,
                    (
                        SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('attribute_name', attr.name, 'value', av.value)), ']') 
                        FROM product_attributes pa
                        JOIN attribute_values av ON pa.attribute_value_id = av.id
                        JOIN attributes attr ON av.attribute_id = attr.id
                        WHERE pa.product_id = p.id
                    ) as attributes,
                    (
                        SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('id', spv.id, 'title', spv.title, 'color', spv.color, 'size', spv.size, 'sku', spv.sku, 'price', spv.price, 'mrp', spv.mrp, 'stock_quantity', spv.stock_quantity, 'variant_image_url', spv.variant_image_url, 'variant_image_urls', spv.variant_image_urls)), ']')
                        FROM seller_product_variants spv WHERE spv.seller_product_id = sp.id AND (spv.is_active = TRUE OR spv.is_active IS NULL)
                    ) as variants
                FROM seller_products sp
                JOIN sellers s ON sp.seller_id = s.id
                LEFT JOIN merchants m ON s.sellerable_id = m.id AND s.sellerable_type = 'Merchant'
                JOIN products p ON sp.product_id = p.id
                LEFT JOIN product_subcategories psc ON p.subcategory_id = psc.id
                LEFT JOIN brands b ON p.brand_id = b.id
                LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id 
                WHERE (
                    p.is_universal_pincode = 1 
                    OR NOT EXISTS (SELECT 1 FROM seller_product_pincodes spp_check WHERE spp_check.seller_product_id = sp.id)
                ) AND p.is_active = TRUE AND p.is_deleted = FALSE AND sp.is_active = TRUE AND sp.selling_price > 0
                GROUP BY sp.id 
                ORDER BY bv_earned DESC, ((sp.mrp - sp.selling_price) / sp.mrp) DESC 
                LIMIT 25
            `;
            topBvParams = [bvGenerationPct, bvGenerationPct];
        }

        const [rawTopBv] = await db.query(topBvQuery, topBvParams);
        const topBvDeals = (rawTopBv || []).map(p => {
            let rawHasReturn;
            if (p.has_return_policy !== null && p.has_return_policy !== undefined) {
                rawHasReturn = (p.has_return_policy === 1 || p.has_return_policy === true || p.has_return_policy === '1' || p.has_return_policy === 'true');
            } else if (p.subcat_has_return_policy !== null && p.subcat_has_return_policy !== undefined) {
                rawHasReturn = (p.subcat_has_return_policy === 1 || p.subcat_has_return_policy === true || p.subcat_has_return_policy === '1' || p.subcat_has_return_policy === 'true');
            } else {
                rawHasReturn = true;
            }

            let rawHasReplacement;
            if (p.is_replacement_available !== null && p.is_replacement_available !== undefined) {
                rawHasReplacement = (p.is_replacement_available === 1 || p.is_replacement_available === true || p.is_replacement_available === '1' || p.is_replacement_available === 'true');
            } else if (p.subcat_is_replacement_available !== null && p.subcat_is_replacement_available !== undefined) {
                rawHasReplacement = (p.subcat_is_replacement_available === 1 || p.subcat_is_replacement_available === true || p.subcat_is_replacement_available === '1' || p.subcat_is_replacement_available === 'true');
            } else {
                rawHasReplacement = true;
            }

            const returnDays = parseInt(p.return_window_days || p.subcat_return_window_days || 7, 10);
            const replacementDays = parseInt(p.replacement_window_days || p.subcat_replacement_window_days || 7, 10);

            let parsedGallery = [];
            try { parsedGallery = typeof p.gallery_image_urls === 'string' ? JSON.parse(p.gallery_image_urls) : p.gallery_image_urls; } catch(e) { parsedGallery = []; }

            let parsedAttr = [];
            try { parsedAttr = typeof p.attributes === 'string' ? JSON.parse(p.attributes) : p.attributes; } catch(e) { parsedAttr = []; }

            let parsedVars = [];
            try { parsedVars = typeof p.variants === 'string' ? JSON.parse(p.variants) : p.variants; } catch(e) { parsedVars = []; }

            return {
                ...p,
                id: p.product_id,
                product_id: p.product_id,
                category_id: p.category_id,
                subcategory_id: p.subcategory_id,
                offer_id: p.offer_id,
                gallery_image_urls: Array.isArray(parsedGallery) ? parsedGallery : [],
                attributes: Array.isArray(parsedAttr) ? parsedAttr : [],
                variants: Array.isArray(parsedVars) ? parsedVars : [],
                has_return_policy: rawHasReturn ? 1 : 0,
                return_window_days: returnDays,
                is_replacement_available: rawHasReplacement ? 1 : 0,
                replacement_window_days: replacementDays,
                hasReturnPolicy: rawHasReturn,
                isReplacementAvailable: rawHasReplacement,
                warranty_type: p.warranty_type || 'no_warranty',
                warranty_months: p.warranty_months || 0,
                warranty_period: p.warranty_period || '',
                warranty_covered_by: p.warranty_covered_by || '',
            };
        });

        res.status(200).json({
            status: true,
            data: {
                banners,
                categories: categoryTree,
                topBvDeals,
                productSections: categorizedProducts
            }
        });

    } catch (error) {
        console.error("Error fetching home screen data:", error);
        res.status(500).json({ status: false, message: "An internal server error occurred." });
    }
};

exports.getRelatedProducts = async (req, res) => {
    const { productId } = req.params;
    const { pincode } = req.query;
    const G_LIMIT = 10;
    const isPincodeProvided = pincode && pincode !== 'ALL' && pincode !== 'null' && pincode !== 'undefined';

    if (!productId) return res.status(400).json({ status: false, message: "Product ID is required." });

    try {
        let [productRows] = await db.query('SELECT category_id, id FROM products WHERE id = ? OR id = (SELECT product_id FROM seller_products WHERE id = ? LIMIT 1)', [productId, productId]);
        if (productRows.length === 0) return res.status(404).json({ status: false, message: "Original product not found." });
        const categoryId = productRows[0].category_id;
        const masterProductId = productRows[0].id;

        const baseSelect = `
            p.id as product_id, p.name, p.main_image_url, p.description, p.gallery_image_urls,
            b.name as brand_name, sp.id as offer_id, sp.selling_price, sp.mrp, sp.minimum_order_quantity,
            COALESCE(m.business_name, s.display_name, 'Earn24 Official') as seller_name,
            (SELECT IFNULL(ROUND(AVG(rating), 1), 0) FROM product_reviews WHERE product_id = p.id AND status = 'APPROVED') AS avg_rating,
            (SELECT COUNT(*) FROM product_reviews WHERE product_id = p.id AND status = 'APPROVED') AS total_reviews,
            GREATEST(0, IF(IFNULL(sp.admin_margin_percent, 0) > 0, (sp.selling_price * (IFNULL(sp.admin_margin_percent, 10.0) / 100)) * 0.80, ((sp.selling_price / (1 + (IFNULL(h.gst_percentage, 0) / 100))) - sp.purchase_price) * 0.80)) as bv_earned,
            (
                SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('attribute_name', attr.name, 'value', av.value)), ']') 
                FROM product_attributes pa
                JOIN attribute_values av ON pa.attribute_value_id = av.id
                JOIN attributes attr ON av.attribute_id = attr.id
                WHERE pa.product_id = p.id
            ) as attributes,
            (
                SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('id', spv.id, 'title', spv.title, 'color', spv.color, 'size', spv.size, 'sku', spv.sku, 'price', spv.price, 'mrp', spv.mrp, 'stock_quantity', spv.stock_quantity, 'variant_image_url', spv.variant_image_url, 'variant_image_urls', spv.variant_image_urls)), ']')
                FROM seller_product_variants spv WHERE spv.seller_product_id = sp.id
            ) as variants
        `;

        let relatedRows = [];
        if (isPincodeProvided) {
            const strictPincodeQuery = `
                SELECT * FROM (
                    (SELECT 1 as priority, ${baseSelect} FROM seller_products sp JOIN sellers s ON sp.seller_id = s.id LEFT JOIN merchants m ON s.sellerable_id = m.id AND s.sellerable_type = 'Merchant' JOIN products p ON sp.product_id = p.id LEFT JOIN seller_product_pincodes spp ON sp.id = spp.seller_product_id LEFT JOIN brands b ON p.brand_id = b.id LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id WHERE p.category_id = ? AND (spp.pincode = ? OR spp.pincode = 'ALL' OR spp.pincode IS NULL) AND p.id != ? AND sp.is_active = TRUE GROUP BY sp.id)
                    UNION ALL
                    (SELECT 2 as priority, ${baseSelect} FROM seller_products sp JOIN sellers s ON sp.seller_id = s.id LEFT JOIN merchants m ON s.sellerable_id = m.id AND s.sellerable_type = 'Merchant' JOIN products p ON sp.product_id = p.id LEFT JOIN seller_product_pincodes spp ON sp.id = spp.seller_product_id LEFT JOIN brands b ON p.brand_id = b.id LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id WHERE (spp.pincode = ? OR spp.pincode = 'ALL' OR spp.pincode IS NULL) AND p.id != ? AND sp.is_active = TRUE AND p.id NOT IN (SELECT p_inner.id FROM seller_products sp_inner JOIN products p_inner ON sp_inner.product_id = p_inner.id LEFT JOIN seller_product_pincodes spp_inner ON sp_inner.id = spp_inner.seller_product_id WHERE p_inner.category_id = ? AND (spp_inner.pincode = ? OR spp_inner.pincode = 'ALL' OR spp_inner.pincode IS NULL)) GROUP BY sp.id)
                ) as combined_results ORDER BY priority ASC, RAND() LIMIT ?
            `;
            const [rows] = await db.query(strictPincodeQuery, [categoryId, pincode, masterProductId, pincode, masterProductId, categoryId, pincode, G_LIMIT]);
            relatedRows = rows;
        } else {
            const allProductsQuery = `
                SELECT ${baseSelect} FROM seller_products sp 
                JOIN sellers s ON sp.seller_id = s.id 
                LEFT JOIN merchants m ON s.sellerable_id = m.id AND s.sellerable_type = 'Merchant'
                JOIN products p ON sp.product_id = p.id 
                LEFT JOIN brands b ON p.brand_id = b.id 
                LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id 
                WHERE p.category_id = ? AND p.id != ? AND sp.is_active = TRUE 
                  AND NOT EXISTS (SELECT 1 FROM seller_product_pincodes spp_check WHERE spp_check.seller_product_id = sp.id)
                GROUP BY sp.id ORDER BY RAND() LIMIT ?
            `;
            const [rows] = await db.query(allProductsQuery, [categoryId, masterProductId, G_LIMIT]);
            relatedRows = rows;
        }

        // Fallback: If no products in same category, load active products from any category so "You Might Also Like" section is never empty
        if (relatedRows.length === 0) {
            const fallbackQuery = `
                SELECT ${baseSelect} FROM seller_products sp 
                JOIN sellers s ON sp.seller_id = s.id 
                LEFT JOIN merchants m ON s.sellerable_id = m.id AND s.sellerable_type = 'Merchant'
                JOIN products p ON sp.product_id = p.id 
                LEFT JOIN brands b ON p.brand_id = b.id 
                LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id 
                WHERE p.id != ? AND sp.is_active = TRUE 
                  AND NOT EXISTS (SELECT 1 FROM seller_product_pincodes spp_check WHERE spp_check.seller_product_id = sp.id)
                GROUP BY sp.id ORDER BY RAND() LIMIT ?
            `;
            const [fallbackRows] = await db.query(fallbackQuery, [masterProductId, G_LIMIT]);
            relatedRows = fallbackRows;
        }

        const processedData = relatedRows.map(row => {
            let parsedAttr = [];
            if (row.attributes) {
                try { parsedAttr = typeof row.attributes === 'string' ? JSON.parse(row.attributes) : row.attributes; } catch (e) { parsedAttr = []; }
            }
            let parsedGallery = [];
            if (row.gallery_image_urls) {
                try { parsedGallery = typeof row.gallery_image_urls === 'string' ? JSON.parse(row.gallery_image_urls) : row.gallery_image_urls; } catch (e) { parsedGallery = []; }
            }
            let parsedVars = [];
            if (row.variants) {
                try { parsedVars = typeof row.variants === 'string' ? JSON.parse(row.variants) : row.variants; } catch (e) { parsedVars = []; }
            }
            return {
                ...row,
                attributes: Array.isArray(parsedAttr) ? parsedAttr : [],
                gallery_image_urls: Array.isArray(parsedGallery) ? parsedGallery : [],
                variants: Array.isArray(parsedVars) ? parsedVars : []
            };
        });

        res.status(200).json({ status: true, data: processedData });

    } catch (error) {
        console.error("Error fetching related products:", error);
        res.status(500).json({ status: false, message: "An error occurred while fetching related products.", error: error.message });
    }
};

/**
 * GET /api/inventory/top-bv-deals
 * Paginated endpoint for unlimited infinite scrolling of Top BV & Super Deals
 */
exports.getPaginatedTopBvDeals = async (req, res) => {
    const { pincode } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const isPincodeProvided = pincode && pincode !== 'ALL' && pincode !== 'null' && pincode !== 'undefined';

    try {
        const [settingsRows] = await db.query("SELECT setting_key, setting_value FROM app_settings WHERE setting_key = 'bv_generation_pct_of_profit'");
        const bvGenerationPct = settingsRows[0] ? parseFloat(settingsRows[0].setting_value) : 80.0;

        let query = '';
        let countQuery = '';
        let params = [];
        let countParams = [];

        if (isPincodeProvided) {
            query = `
                SELECT 
                    p.id as product_id, p.id, p.name, p.description, p.main_image_url, p.gallery_image_urls,
                    p.category_id, p.subcategory_id,
                    sp.id as offer_id, b.name as brand_name, sp.selling_price, sp.mrp,
                    sp.purchase_price, sp.minimum_order_quantity,
                    COALESCE(m.business_name, s.display_name, 'Earn24 Official') as seller_name,
                    sp.warranty_type, sp.warranty_months, sp.warranty_covered_by, sp.warranty_period,
                    sp.has_return_policy, sp.return_window_days, sp.is_replacement_available, sp.replacement_window_days,
                    IFNULL(sp.is_cod_available, 1) as is_cod_available,
                    psc.has_return_policy as subcat_has_return_policy, psc.return_window_days as subcat_return_window_days,
                    psc.is_replacement_available as subcat_is_replacement_available, psc.replacement_window_days as subcat_replacement_window_days,
                    (SELECT IFNULL(ROUND(AVG(rating), 1), 0) FROM product_reviews WHERE product_id = p.id AND status = 'APPROVED') AS avg_rating,
                    (SELECT COUNT(*) FROM product_reviews WHERE product_id = p.id AND status = 'APPROVED') AS total_reviews,
                    GREATEST(0, IF(IFNULL(sp.admin_margin_percent, 0) > 0, (sp.selling_price * (IFNULL(sp.admin_margin_percent, 10.0) / 100)) * (? / 100), ((sp.selling_price / (1 + (IFNULL(h.gst_percentage, 0) / 100))) - sp.purchase_price) * (? / 100))) as bv_earned,
                    (
                        SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('attribute_name', attr.name, 'value', av.value)), ']') 
                        FROM product_attributes pa
                        JOIN attribute_values av ON pa.attribute_value_id = av.id
                        JOIN attributes attr ON av.attribute_id = attr.id
                        WHERE pa.product_id = p.id
                    ) as attributes,
                    (
                        SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('id', spv.id, 'title', spv.title, 'color', spv.color, 'size', spv.size, 'sku', spv.sku, 'price', spv.price, 'mrp', spv.mrp, 'stock_quantity', spv.stock_quantity, 'variant_image_url', spv.variant_image_url, 'variant_image_urls', spv.variant_image_urls)), ']')
                        FROM seller_product_variants spv WHERE spv.seller_product_id = sp.id AND (spv.is_active = TRUE OR spv.is_active IS NULL)
                    ) as variants
                FROM seller_products sp
                JOIN sellers s ON sp.seller_id = s.id
                LEFT JOIN merchants m ON s.sellerable_id = m.id AND s.sellerable_type = 'Merchant'
                LEFT JOIN seller_product_pincodes spp ON sp.id = spp.seller_product_id
                JOIN products p ON sp.product_id = p.id
                LEFT JOIN product_subcategories psc ON p.subcategory_id = psc.id
                LEFT JOIN brands b ON p.brand_id = b.id
                LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id 
                WHERE (
                    p.is_universal_pincode = 1 
                    OR spp.pincode = ? 
                    OR spp.pincode = 'ALL'
                    OR NOT EXISTS (SELECT 1 FROM seller_product_pincodes spp_check WHERE spp_check.seller_product_id = sp.id)
                ) AND p.is_active = TRUE AND p.is_deleted = FALSE AND sp.is_active = TRUE AND sp.selling_price > 0
                GROUP BY sp.id 
                ORDER BY bv_earned DESC, ((sp.mrp - sp.selling_price) / sp.mrp) DESC 
                LIMIT ? OFFSET ?
            `;
            params = [bvGenerationPct, bvGenerationPct, pincode, limit, offset];

            countQuery = `
                SELECT COUNT(DISTINCT sp.id) as total
                FROM seller_products sp
                LEFT JOIN seller_product_pincodes spp ON sp.id = spp.seller_product_id
                JOIN products p ON sp.product_id = p.id
                WHERE (
                    p.is_universal_pincode = 1 
                    OR spp.pincode = ? 
                    OR spp.pincode = 'ALL'
                    OR NOT EXISTS (SELECT 1 FROM seller_product_pincodes spp_check WHERE spp_check.seller_product_id = sp.id)
                ) AND p.is_active = TRUE AND p.is_deleted = FALSE AND sp.is_active = TRUE AND sp.selling_price > 0
            `;
            countParams = [pincode];
        } else {
            query = `
                SELECT 
                    p.id as product_id, p.id, p.name, p.description, p.main_image_url, p.gallery_image_urls,
                    p.category_id, p.subcategory_id,
                    sp.id as offer_id, b.name as brand_name, sp.selling_price, sp.mrp,
                    sp.purchase_price, sp.minimum_order_quantity,
                    COALESCE(m.business_name, s.display_name, 'Earn24 Official') as seller_name,
                    sp.warranty_type, sp.warranty_months, sp.warranty_covered_by, sp.warranty_period,
                    sp.has_return_policy, sp.return_window_days, sp.is_replacement_available, sp.replacement_window_days,
                    IFNULL(sp.is_cod_available, 1) as is_cod_available,
                    psc.has_return_policy as subcat_has_return_policy, psc.return_window_days as subcat_return_window_days,
                    psc.is_replacement_available as subcat_is_replacement_available, psc.replacement_window_days as subcat_replacement_window_days,
                    (SELECT IFNULL(ROUND(AVG(rating), 1), 0) FROM product_reviews WHERE product_id = p.id AND status = 'APPROVED') AS avg_rating,
                    (SELECT COUNT(*) FROM product_reviews WHERE product_id = p.id AND status = 'APPROVED') AS total_reviews,
                    GREATEST(0, IF(IFNULL(sp.admin_margin_percent, 0) > 0, (sp.selling_price * (IFNULL(sp.admin_margin_percent, 10.0) / 100)) * (? / 100), ((sp.selling_price / (1 + (IFNULL(h.gst_percentage, 0) / 100))) - sp.purchase_price) * (? / 100))) as bv_earned,
                    (
                        SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('attribute_name', attr.name, 'value', av.value)), ']') 
                        FROM product_attributes pa
                        JOIN attribute_values av ON pa.attribute_value_id = av.id
                        JOIN attributes attr ON av.attribute_id = attr.id
                        WHERE pa.product_id = p.id
                    ) as attributes,
                    (
                        SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('id', spv.id, 'title', spv.title, 'color', spv.color, 'size', spv.size, 'sku', spv.sku, 'price', spv.price, 'mrp', spv.mrp, 'stock_quantity', spv.stock_quantity, 'variant_image_url', spv.variant_image_url, 'variant_image_urls', spv.variant_image_urls)), ']')
                        FROM seller_product_variants spv WHERE spv.seller_product_id = sp.id AND (spv.is_active = TRUE OR spv.is_active IS NULL)
                    ) as variants
                FROM seller_products sp
                JOIN sellers s ON sp.seller_id = s.id
                LEFT JOIN merchants m ON s.sellerable_id = m.id AND s.sellerable_type = 'Merchant'
                JOIN products p ON sp.product_id = p.id
                LEFT JOIN product_subcategories psc ON p.subcategory_id = psc.id
                LEFT JOIN brands b ON p.brand_id = b.id
                LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id 
                WHERE (
                    p.is_universal_pincode = 1 
                    OR NOT EXISTS (SELECT 1 FROM seller_product_pincodes spp_check WHERE spp_check.seller_product_id = sp.id)
                ) AND p.is_active = TRUE AND p.is_deleted = FALSE AND sp.is_active = TRUE AND sp.selling_price > 0
                GROUP BY sp.id 
                ORDER BY bv_earned DESC, ((sp.mrp - sp.selling_price) / sp.mrp) DESC 
                LIMIT ? OFFSET ?
            `;
            params = [bvGenerationPct, bvGenerationPct, limit, offset];

            countQuery = `
                SELECT COUNT(DISTINCT sp.id) as total
                FROM seller_products sp
                JOIN products p ON sp.product_id = p.id
                WHERE (
                    p.is_universal_pincode = 1 
                    OR NOT EXISTS (SELECT 1 FROM seller_product_pincodes spp_check WHERE spp_check.seller_product_id = sp.id)
                ) AND p.is_active = TRUE AND p.is_deleted = FALSE AND sp.is_active = TRUE AND sp.selling_price > 0
            `;
            countParams = [];
        }

        const [rows] = await db.query(query, params);
        const [countRows] = await db.query(countQuery, countParams);
        const total = countRows[0]?.total || 0;
        const totalPages = Math.ceil(total / limit) || 1;

        const products = rows.map(p => {
            let rawHasReturn;
            if (p.has_return_policy !== null && p.has_return_policy !== undefined) {
                rawHasReturn = (p.has_return_policy === 1 || p.has_return_policy === true || p.has_return_policy === '1' || p.has_return_policy === 'true');
            } else if (p.subcat_has_return_policy !== null && p.subcat_has_return_policy !== undefined) {
                rawHasReturn = (p.subcat_has_return_policy === 1 || p.subcat_has_return_policy === true || p.subcat_has_return_policy === '1' || p.subcat_has_return_policy === 'true');
            } else {
                rawHasReturn = true;
            }

            let rawHasReplacement;
            if (p.is_replacement_available !== null && p.is_replacement_available !== undefined) {
                rawHasReplacement = (p.is_replacement_available === 1 || p.is_replacement_available === true || p.is_replacement_available === '1' || p.is_replacement_available === 'true');
            } else if (p.subcat_is_replacement_available !== null && p.subcat_is_replacement_available !== undefined) {
                rawHasReplacement = (p.subcat_is_replacement_available === 1 || p.subcat_is_replacement_available === true || p.subcat_is_replacement_available === '1' || p.subcat_is_replacement_available === 'true');
            } else {
                rawHasReplacement = true;
            }

            const returnDays = parseInt(p.return_window_days || p.subcat_return_window_days || 7, 10);
            const replacementDays = parseInt(p.replacement_window_days || p.subcat_replacement_window_days || 7, 10);

            let parsedGallery = [];
            try { parsedGallery = typeof p.gallery_image_urls === 'string' ? JSON.parse(p.gallery_image_urls) : p.gallery_image_urls; } catch(e) { parsedGallery = []; }

            let parsedAttr = [];
            try { parsedAttr = typeof p.attributes === 'string' ? JSON.parse(p.attributes) : p.attributes; } catch(e) { parsedAttr = []; }

            let parsedVars = [];
            try { parsedVars = typeof p.variants === 'string' ? JSON.parse(p.variants) : p.variants; } catch(e) { parsedVars = []; }

            return {
                ...p,
                id: p.product_id,
                product_id: p.product_id,
                category_id: p.category_id,
                subcategory_id: p.subcategory_id,
                offer_id: p.offer_id,
                gallery_image_urls: Array.isArray(parsedGallery) ? parsedGallery : [],
                attributes: Array.isArray(parsedAttr) ? parsedAttr : [],
                variants: Array.isArray(parsedVars) ? parsedVars : [],
                has_return_policy: rawHasReturn ? 1 : 0,
                return_window_days: returnDays,
                is_replacement_available: rawHasReplacement ? 1 : 0,
                replacement_window_days: replacementDays,
                hasReturnPolicy: rawHasReturn,
                isReplacementAvailable: rawHasReplacement,
                warranty_type: p.warranty_type || 'no_warranty',
                warranty_months: p.warranty_months || 0,
                warranty_period: p.warranty_period || '',
                warranty_covered_by: p.warranty_covered_by || '',
            };
        });

        res.status(200).json({
            status: true,
            data: products,
            pagination: {
                page,
                limit,
                totalProducts: total,
                totalPages
            }
        });
    } catch (error) {
        console.error("Error in getPaginatedTopBvDeals:", error);
        res.status(500).json({ status: false, message: "Failed to fetch top BV deals.", error: error.message });
    }
};