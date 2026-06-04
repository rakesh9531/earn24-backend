const db = require("../../db");

/**
 * @desc   Toggle product favorite status (add if not exists, remove if exists)
 * @route  POST /api/me/favorites/toggle
 * @access Private
 */
exports.toggleFavorite = async (req, res) => {
  const userId = req.user.id;
  const { productId } = req.body;

  if (!productId) {
    return res.status(400).json({ status: false, message: "Product ID is required." });
  }

  try {
    // Check if the product exists and is active/not deleted
    const [productRows] = await db.query(
      "SELECT id FROM products WHERE id = ? AND is_deleted = 0 AND is_active = 1",
      [productId]
    );

    if (productRows.length === 0) {
      return res.status(404).json({ status: false, message: "Product not found or unavailable." });
    }

    // Check if already favorited
    const [favRows] = await db.query(
      "SELECT id FROM user_favorites WHERE user_id = ? AND product_id = ?",
      [userId, productId]
    );

    if (favRows.length > 0) {
      // Remove from favorites
      await db.query(
        "DELETE FROM user_favorites WHERE user_id = ? AND product_id = ?",
        [userId, productId]
      );
      return res.status(200).json({
        status: true,
        isFavorite: false,
        message: "Product removed from favorites successfully."
      });
    } else {
      // Add to favorites
      await db.query(
        "INSERT INTO user_favorites (user_id, product_id) VALUES (?, ?)",
        [userId, productId]
      );
      return res.status(200).json({
        status: true,
        isFavorite: true,
        message: "Product added to favorites successfully."
      });
    }

  } catch (error) {
    console.error("Error in toggleFavorite:", error);
    res.status(500).json({ status: false, message: "Internal server error." });
  }
};

/**
 * @desc   Fetch all products favorited by the logged-in user
 * @route  GET /api/me/favorites
 * @access Private
 */
exports.getFavorites = async (req, res) => {
  const userId = req.user.id;

  try {
    // Get BV generation percentage setting
    const [settingsRows] = await db.query(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'bv_generation_pct_of_profit'"
    );
    const bvGenerationPct = settingsRows[0] ? parseFloat(settingsRows[0].setting_value) : 80.0;

    const query = `
      SELECT 
        p.id, 
        p.name, 
        p.slug, 
        p.description, 
        p.main_image_url, 
        p.gallery_image_urls, 
        p.popularity,
        b.name as brand_name,
        sp.id as offer_id, 
        sp.selling_price, 
        sp.mrp, 
        sp.minimum_order_quantity,
        ((sp.selling_price / (1 + (IFNULL(h.gst_percentage, 0) / 100))) - sp.purchase_price) * (? / 100) as bv_earned,
        (
          SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('attribute_name', attr.name, 'value', av.value)), ']') 
          FROM product_attributes pa
          JOIN attribute_values av ON pa.attribute_value_id = av.id
          JOIN attributes attr ON av.attribute_id = attr.id
          WHERE pa.product_id = p.id
        ) as attributes
      FROM user_favorites uf
      JOIN products p ON uf.product_id = p.id
      LEFT JOIN seller_products sp ON p.id = sp.product_id AND sp.is_active = TRUE
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
      WHERE uf.user_id = ? AND p.is_deleted = 0 AND p.is_active = 1
      GROUP BY p.id
      ORDER BY uf.created_at DESC;
    `;

    const [rows] = await db.query(query, [bvGenerationPct, userId]);

    // Helper to safely parse JSON strings or return the value if already parsed
    const safeParseJson = (val, fallback = []) => {
      if (!val) return fallback;
      if (typeof val === 'object') return val;
      try {
        return JSON.parse(val);
      } catch (err) {
        console.error("Failed to parse JSON in getFavorites:", val, err);
        return fallback;
      }
    };

    // Format products identical to standard product categories/search lists
    const formattedProducts = rows.map((product) => ({
      ...product,
      id: product.id,
      product_id: product.id,
      attributes: safeParseJson(product.attributes, []),
      gallery_image_urls: safeParseJson(product.gallery_image_urls, [])
    }));

    res.status(200).json({
      status: true,
      data: formattedProducts
    });

  } catch (error) {
    console.error("Error in getFavorites:", error);
    res.status(500).json({ status: false, message: "Internal server error." });
  }
};
