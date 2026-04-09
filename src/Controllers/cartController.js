const db = require('../../db');

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

    if (!pincode) {
        return res.status(400).json({ status: false, message: 'A pincode is required to validate the cart.' });
    }

    try {
        const cartId = await getOrCreateCart(db, userId);

        const [settingsRows] = await db.query("SELECT setting_key, setting_value FROM app_settings WHERE setting_key = 'bv_generation_pct_of_profit'");
        const bvSetting = settingsRows.find(s => s.setting_key === 'bv_generation_pct_of_profit');
        const bvGenerationPct = bvSetting ? parseFloat(bvSetting.setting_value) : 80.0;

        // Base Query
        let query = `
            SELECT 
                ci.id as cart_item_id, ci.quantity, sp.id as offer_id, p.id as product_id, p.name,
                p.main_image_url, b.name as brand_name, sp.selling_price, sp.mrp,
                sp.minimum_order_quantity, sp.purchase_price, h.gst_percentage,
                GREATEST(0, ((sp.selling_price / (1 + (IFNULL(h.gst_percentage, 0) / 100))) - sp.purchase_price) * (? / 100)) as bv_earned,
                (EXISTS (SELECT 1 FROM seller_product_pincodes spp WHERE spp.seller_product_id = ci.seller_product_id AND spp.pincode = ?)) AS is_available
            FROM cart_items ci
            JOIN seller_products sp ON ci.seller_product_id = sp.id
            JOIN products p ON sp.product_id = p.id
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
            WHERE ci.cart_id = ?
        `;
        
        const params = [bvGenerationPct, pincode, cartId];

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
        
        const processedItems = items.map(item => ({
            ...item,
            is_available: Boolean(item.is_available)
        }));

        res.status(200).json({ status: true, data: processedItems });
    } catch (error) {
        console.error("Error getting cart:", error);
        res.status(500).json({ status: false, message: 'Failed to retrieve cart.' });
    }
};

// POST /add - Add an item to the cart
exports.addItemToCart = async (req, res) => {
    const userId = req.user.id;
    const { sellerProductId, quantity } = req.body;

    if (!sellerProductId || !quantity || quantity < 1) {
        return res.status(400).json({ status: false, message: 'Product ID and a valid quantity are required.' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const cartId = await getOrCreateCart(connection, userId);

        const query = `
            INSERT INTO cart_items (cart_id, seller_product_id, quantity)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)
        `;
        await connection.query(query, [cartId, sellerProductId, quantity]);
        await connection.commit();
        
        res.status(200).json({ status: true, message: 'Item added to cart.' });
    } catch (error) {
        await connection.rollback();
        console.error("Error adding item to cart:", error);
        res.status(500).json({ status: false, message: 'Failed to add item to cart.' });
    } finally {
        connection.release();
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
        const [pincodeRows] = await db.query(
            `SELECT seller_product_id, pincode FROM seller_product_pincodes WHERE seller_product_id IN (?)`,
            [offerIds]
        );
        
        const availabilityMap = pincodeRows.reduce((acc, row) => {
            if (!acc[row.seller_product_id]) { acc[row.seller_product_id] = new Set(); }
            acc[row.seller_product_id].add(row.pincode.toString());
            return acc;
        }, {});

        const validatedItems = items.map(item => {
            const availablePincodes = availabilityMap[item.offer_id] || new Set();
            return {
                ...item, 
                is_available: availablePincodes.has(pincode.toString()) 
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