// Controllers/sellerProductController.js
const db = require('../../db');
const SellerProduct = require('../Models/sellerProductModel');


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




// Working
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



//  Working
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