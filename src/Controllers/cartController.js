const db = require('../../db');

// --- AUTOMATIC SCHEMA MIGRATION: REMOVE RESTRICTIVE UNIQUE INDEX ON CART ITEMS ---
(async () => {
    try {
        await db.query("ALTER TABLE cart_items DROP INDEX cart_product_unique");
        console.log("✅ Successfully dropped legacy cart_product_unique constraint!");
    } catch (e) {}
    try {
        await db.query("ALTER TABLE cart_items DROP INDEX unique_cart_product");
    } catch (e) {}
    try {
        await db.query("ALTER TABLE cart_items DROP INDEX cart_id_seller_product_id");
    } catch (e) {}
    try {
        const [indexes] = await db.query("SHOW INDEX FROM cart_items WHERE Key_name != 'PRIMARY' AND Non_unique = 0");
        for (const idx of indexes) {
            if (idx.Key_name !== 'PRIMARY') {
                try {
                    await db.query(`ALTER TABLE cart_items DROP INDEX \`${idx.Key_name}\``);
                    console.log(`✅ Dropped non-unique index ${idx.Key_name} from cart_items`);
                } catch (err) {}
            }
        }
    } catch (e) {}
})();

// Helper function to get or create a cart for a user
const getOrCreateCart = async (connection, userId) => {
    let [cart] = await connection.query('SELECT id FROM carts WHERE user_id = ?', [userId]);
    if (cart.length === 0) {
        const [newCart] = await connection.query('INSERT INTO carts (user_id) VALUES (?)', [userId]);
        return newCart.insertId;
    }
    return cart[0].id;
};

// ==========================================================
// === GET /?pincode=... - Get cart items with availability ===
// ==========================================================
exports.getCart = async (req, res) => {
    const userId = req.user.id;
    const { pincode, cartItemIds } = req.query;
    const activePincode = (pincode && pincode !== 'ALL' && pincode !== 'null') ? pincode : '';

    try {
        const cartId = await getOrCreateCart(db, userId);

        const [settingsRows] = await db.query("SELECT setting_key, setting_value FROM app_settings WHERE setting_key = 'bv_generation_pct_of_profit'");
        const bvSetting = settingsRows.find(s => s.setting_key === 'bv_generation_pct_of_profit');
        const bvGenerationPct = bvSetting ? parseFloat(bvSetting.setting_value) : 80.0;

        // Auto-migration: ensure seller_product_variant_id column exists
        try {
            await db.query("ALTER TABLE cart_items ADD COLUMN seller_product_variant_id INT NULL AFTER seller_product_id");
        } catch (e) {
            // Column already exists
        }

        let query = `
            SELECT 
                ci.id as cart_item_id, ci.quantity, ci.seller_product_variant_id,
                sp.id as offer_id, p.id as product_id,
                IF(spv.id IS NOT NULL, CONCAT(p.name, ' (', IFNULL(spv.title, CONCAT(IFNULL(spv.color,''), ' ', IFNULL(spv.size,''))), ')'), p.name) as name,
                COALESCE(spv.variant_image_url, p.main_image_url) as main_image_url,
                b.name as brand_name,
                COALESCE(spv.price, sp.selling_price) as selling_price,
                COALESCE(spv.mrp, sp.mrp) as mrp,
                sp.minimum_order_quantity, sp.purchase_price, h.gst_percentage,
                s.display_name as seller_name,
                spv.title as variant_title, spv.color as variant_color, spv.size as variant_size, spv.sku as variant_sku,
                GREATEST(0, IF(IFNULL(sp.admin_margin_percent, 0) > 0, (COALESCE(spv.price, sp.selling_price) * (IFNULL(sp.admin_margin_percent, 10.0) / 100)) * (? / 100), ((COALESCE(spv.price, sp.selling_price) / (1 + (IFNULL(h.gst_percentage, 0) / 100))) - sp.purchase_price) * (? / 100))) as bv_earned,
                (
                    ? = '' 
                    OR NOT EXISTS (SELECT 1 FROM seller_product_pincodes spp_check WHERE spp_check.seller_product_id = ci.seller_product_id)
                    OR EXISTS (SELECT 1 FROM seller_product_pincodes spp WHERE spp.seller_product_id = ci.seller_product_id AND spp.pincode = ?)
                ) AS is_available
            FROM cart_items ci
            JOIN seller_products sp ON ci.seller_product_id = sp.id
            JOIN products p ON sp.product_id = p.id
            JOIN sellers s ON sp.seller_id = s.id
            LEFT JOIN seller_product_variants spv ON ci.seller_product_variant_id = spv.id
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
            WHERE ci.cart_id = ?
        `;
        
        const params = [bvGenerationPct, bvGenerationPct, activePincode, activePincode, cartId];

        // Handle filtering by selected items if cartItemIds is provided
        if (cartItemIds) {
            let idsArray;
            if (Array.isArray(cartItemIds)) {
                idsArray = cartItemIds;
            } else {
                idsArray = cartItemIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
            }
            
            if (idsArray.length > 0) {
                query += ` AND ci.id IN (?)`;
                params.push(idsArray);
            }
        }

        const [items] = await db.query(query, params);
        res.status(200).json({ status: true, data: items });

    } catch (error) {
        console.error("Error fetching cart:", error);
        res.status(500).json({ status: false, message: 'Failed to fetch cart.' });
    }
};

// POST /add - Add an item to the cart (with variant support)
exports.addItemToCart = async (req, res) => {
    const userId = req.user.id;
    const { sellerProductId, variantId, quantity } = req.body;

    if (!sellerProductId || !quantity || quantity < 1) {
        return res.status(400).json({ status: false, message: 'Product ID and a valid quantity are required.' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const cartId = await getOrCreateCart(connection, userId);

        let actualSellerProductId = sellerProductId;
        const [spCheck] = await connection.query("SELECT id FROM seller_products WHERE id = ?", [sellerProductId]);
        if (spCheck.length === 0) {
            const [spByProduct] = await connection.query("SELECT id FROM seller_products WHERE product_id = ? AND is_active = TRUE LIMIT 1", [sellerProductId]);
            if (spByProduct.length > 0) {
                actualSellerProductId = spByProduct[0].id;
            }
        }

        let existingRows = [];
        if (variantId) {
            const [rows] = await connection.query(
                "SELECT id, quantity FROM cart_items WHERE cart_id = ? AND seller_product_id = ? AND seller_product_variant_id = ?",
                [cartId, actualSellerProductId, variantId]
            );
            existingRows = rows;
        } else {
            const [rows] = await connection.query(
                "SELECT id, quantity FROM cart_items WHERE cart_id = ? AND seller_product_id = ? AND (seller_product_variant_id IS NULL OR seller_product_variant_id = 0)",
                [cartId, actualSellerProductId]
            );
            existingRows = rows;
        }

        if (existingRows && existingRows.length > 0) {
            await connection.query(
                "UPDATE cart_items SET quantity = quantity + ? WHERE id = ?",
                [quantity, existingRows[0].id]
            );
        } else {
            try {
                await connection.query(
                    "INSERT INTO cart_items (cart_id, seller_product_id, seller_product_variant_id, quantity) VALUES (?, ?, ?, ?)",
                    [cartId, actualSellerProductId, variantId || null, quantity]
                );
            } catch (insertError) {
                // SELF-HEALING AUTOMATIC DB REPAIR FOR LEGACY UNIQUE CONSTRAINTS (e.g. cart_product_unique)
                if (insertError.code === 'ER_DUP_ENTRY' || insertError.errno === 1062) {
                    console.log("⚠️ Self-Healing: ER_DUP_ENTRY detected! Auto-repairing cart_items table indexes...");
                    
                    let keyName = 'cart_product_unique';
                    if (insertError.sqlMessage) {
                        const match = insertError.sqlMessage.match(/key ['`"](?:.*?\.)?(.*?)['`"]/i);
                        if (match && match[1]) {
                            keyName = match[1];
                        }
                    }

                    try {
                        await db.query(`ALTER TABLE cart_items DROP INDEX \`${keyName}\``);
                        console.log(`✅ Self-Healing: Successfully dropped restrictive index ${keyName}`);
                    } catch (dropErr) {}

                    try {
                        await db.query("ALTER TABLE cart_items DROP INDEX cart_product_unique");
                    } catch (dropErr) {}

                    try {
                        await db.query("ALTER TABLE cart_items DROP INDEX unique_cart_product");
                    } catch (dropErr) {}

                    // Retry insert after dropping restrictive index
                    await connection.query(
                        "INSERT INTO cart_items (cart_id, seller_product_id, seller_product_variant_id, quantity) VALUES (?, ?, ?, ?)",
                        [cartId, actualSellerProductId, variantId || null, quantity]
                    );
                } else {
                    throw insertError;
                }
            }
        }

        await connection.commit();
        
        res.status(200).json({ status: true, message: 'Item added to cart.' });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error adding item to cart:", error);
        res.status(500).json({ status: false, message: 'Failed to add item to cart.' });
    } finally {
        if (connection) connection.release();
    }
};

// PUT /update/:itemId - Update item quantity
exports.updateCartItem = async (req, res) => {
    const userId = req.user.id;
    const { itemId } = req.params;
    const { quantity } = req.body;

    if (!quantity || quantity < 1) {
        return res.status(400).json({ status: false, message: 'A valid quantity is required.' });
    }

    try {
        const query = `
            UPDATE cart_items ci
            JOIN carts c ON ci.cart_id = c.id
            SET ci.quantity = ?
            WHERE ci.id = ? AND c.user_id = ?
        `;
        const [result] = await db.query(query, [quantity, itemId, userId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: false, message: 'Cart item not found.' });
        }

        res.status(200).json({ status: true, message: 'Cart updated successfully.' });
    } catch (error) {
        console.error("Error updating cart item:", error);
        res.status(500).json({ status: false, message: 'Failed to update cart item.' });
    }
};

// DELETE /remove/:itemId - Remove an item from the cart
exports.removeCartItem = async (req, res) => {
    const userId = req.user.id;
    const { itemId } = req.params;

    try {
        const query = `
            DELETE ci FROM cart_items ci
            JOIN carts c ON ci.cart_id = c.id
            WHERE ci.id = ? AND c.user_id = ?
        `;
        const [result] = await db.query(query, [itemId, userId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: false, message: 'Cart item not found.' });
        }
        res.status(200).json({ status: true, message: 'Item removed from cart.' });
    } catch (error) {
        console.error("Error removing cart item:", error);
        res.status(500).json({ status: false, message: 'Failed to remove item.' });
    }
};

// DELETE /clear - Clear all items from the cart
exports.clearCart = async (req, res) => {
    const userId = req.user.id;
    try {
        const cartId = await getOrCreateCart(db, userId);
        await db.query('DELETE FROM cart_items WHERE cart_id = ?', [cartId]);
        res.status(200).json({ status: true, message: 'Cart cleared.' });
    } catch (error) {
        console.error("Error clearing cart:", error);
        res.status(500).json({ status: false, message: 'Failed to clear cart.' });
    }
};

// --- FINAL CHECKOUT VALIDATION ---
exports.validateCartForCheckout = async (req, res) => {
    const { pincode, items } = req.body;

    if (!pincode || !items || !Array.isArray(items)) {
        return res.status(400).json({ status: false, message: 'Pincode and cart items are required.' });
    }

    try {
        if (items.length === 0) {
            return res.status(200).json({ status: true, data: [] });
        }

        const offerIds = items.map(item => item.offer_id);
        const [rows] = await db.query(
            `SELECT 
                sp.id as offer_id,
                p.is_universal_pincode,
                (SELECT COUNT(*) FROM seller_product_pincodes spp_c WHERE spp_c.seller_product_id = sp.id) as restriction_count,
                EXISTS(SELECT 1 FROM seller_product_pincodes spp WHERE spp.seller_product_id = sp.id AND spp.pincode = ?) as is_matched
            FROM seller_products sp
            JOIN products p ON sp.product_id = p.id
            WHERE sp.id IN (?)`,
            [pincode, offerIds]
        );

        const infoMap = rows.reduce((acc, row) => {
            acc[row.offer_id] = row;
            return acc;
        }, {});

        const validatedItems = items.map(item => {
            const info = infoMap[item.offer_id];
            let isAvailable = true;
            if (info) {
                if (info.is_universal_pincode === 1 || info.restriction_count === 0) {
                    isAvailable = true;
                } else {
                    isAvailable = info.is_matched === 1;
                }
            }
            return {
                ...item, 
                is_available: isAvailable 
            };
        });

        res.status(200).json({ status: true, data: validatedItems });

    } catch (error) {
        console.error("Error validating cart for checkout:", error);
        res.status(500).json({ status: false, message: 'Failed to validate cart.' });
    }
};

/*
=============================================================================
                          PREVIOUS CODE REFERENCE
=============================================================================

const db = require('../../db');

// Helper function to get or create a cart for a user ...
// (Includes previous versions of getCart, addItemToCart, etc.)

=============================================================================
*/