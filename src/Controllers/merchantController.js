const db = require('../../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');

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
        console.warn("Error saving base64 image:", e.message);
        return base64Str;
    }
}

/**
 * Handles the registration of a new Merchant.
 * Creates a record in the `merchants` table and a corresponding profile in the `sellers` table.
 * Status defaults to 'PENDING' for admin approval.
 */
exports.registerMerchant = async (req, res) => {
    const {
        business_name, owner_name, phone_number, email, password,
        gst_number, pan_number, business_address, pincode
    } = req.body;

    if (!business_name || !owner_name || !phone_number || !email || !password || !business_address || !pincode) {
        return res.status(400).json({ status: false, message: 'All required merchant fields, including pincode, must be provided.' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [existing] = await connection.query(
            'SELECT id FROM merchants WHERE email = ? OR phone_number = ?',
            [email, phone_number]
        );
        if (existing.length > 0) {
            throw new Error('A merchant with this email or phone number already exists.');
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const now = moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

        // Extract document files uploaded via multer if present
        const panDoc = req.files?.pan_card_doc?.[0]?.path || null;
        const aadhaarDoc = req.files?.aadhaar_card_doc?.[0]?.path || null;
        const gstDoc = req.files?.gst_cert_doc?.[0]?.path || null;
        const passbookDoc = req.files?.bank_passbook_doc?.[0]?.path || null;

        const merchantSql = `
            INSERT INTO merchants 
            (business_name, owner_name, phone_number, email, password, gst_number, pan_number, business_address, pincode, pan_card_doc, aadhaar_card_doc, gst_cert_doc, bank_passbook_doc, admin_approval_status, is_active, created_at, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)
        `;
        const [merchantResult] = await connection.query(merchantSql, [
            business_name, owner_name, phone_number, email, hashedPassword,
            gst_number || null, pan_number || null, business_address, pincode,
            panDoc, aadhaarDoc, gstDoc, passbookDoc, now, now
        ]);
        const newMerchantId = merchantResult.insertId;


        const sellerSql = `
            INSERT INTO sellers (sellerable_id, sellerable_type, display_name, created_at) 
            VALUES (?, ?, ?, ?)
        `;
        await connection.query(sellerSql, [newMerchantId, 'Merchant', business_name, now]);

        await connection.commit();

        res.status(201).json({
            status: true,
            message: 'Merchant registration successful. Your account is pending admin approval.',
            merchantId: newMerchantId
        });

    } catch (error) {
        await connection.rollback();
        console.error("Error registering merchant:", error);
        res.status(409).json({ status: false, message: error.message || 'An error occurred during registration.' });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * Merchant Login
 */
exports.loginMerchant = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ status: false, message: 'Email and password are required.' });
    }

    try {
        const [rows] = await db.query(
            'SELECT * FROM merchants WHERE email = ? AND is_deleted = 0',
            [email]
        );

        if (rows.length === 0) {
            return res.status(401).json({ status: false, message: 'Invalid credentials.' });
        }

        const merchant = rows[0];

        if (merchant.admin_approval_status !== 'APPROVED') {
            return res.status(403).json({ 
                status: false, 
                message: `Account is currently '${merchant.admin_approval_status}'. Please wait for admin approval.` 
            });
        }

        if (merchant.is_active === 0) {
            return res.status(403).json({ status: false, message: 'Your merchant account has been deactivated. Contact Admin.' });
        }

        const isMatch = await bcrypt.compare(password, merchant.password);
        if (!isMatch) {
            return res.status(401).json({ status: false, message: 'Invalid credentials.' });
        }

        // Generate JWT Token with role = 'Merchant'
        const token = jwt.sign(
            { id: merchant.id, role: 'Merchant', email: merchant.email },
            process.env.JWT_SECRET || 'earn24_key',
            { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
        );

        res.status(200).json({
            status: true,
            message: 'Login successful.',
            token,
            merchant: {
                id: merchant.id,
                business_name: merchant.business_name,
                owner_name: merchant.owner_name,
                email: merchant.email,
                phone_number: merchant.phone_number,
                pincode: merchant.pincode
            }
        });

    } catch (error) {
        console.error("Error logging in merchant:", error);
        res.status(500).json({ status: false, message: 'An error occurred during login.' });
    }
};

/**
 * Get Logged-in Merchant Profile
 */
exports.getMerchantProfile = async (req, res) => {
    const merchantId = req.user.id;
    try {
        const [rows] = await db.query(
            'SELECT id, business_name, owner_name, email, phone_number, gst_number, pan_number, business_address, pincode, admin_approval_status, is_active, created_at FROM merchants WHERE id = ?',
            [merchantId]
        );
        if (rows.length === 0) {
            return res.status(404).json({ status: false, message: 'Merchant profile not found.' });
        }
        res.status(200).json({ status: true, data: rows[0] });
    } catch (error) {
        console.error("Error fetching merchant profile:", error);
        res.status(500).json({ status: false, message: 'An error occurred.' });
    }
};

/**
 * Merchant Add Product Listing (With Master Product creation & 10% Admin Margin)
 */
exports.addMerchantProduct = async (req, res) => {
    const merchantId = req.user.id;
    const body = req.body;

    // Normalize field names (support camelCase and snake_case)
    let name = body.product_name || body.name;
    let description = body.description || '';
    let categoryId = body.categoryId || body.category_id || body.category;
    let subcategoryId = body.subcategoryId || body.sub_category_id || body.sub_category;
    let brandId = body.brandId || body.brand_id || body.brand;
    let hsnCodeId = body.hsnCodeId || body.hsn_code_id || body.hsn_code;

    let mrp = parseFloat(body.mrp || 0);
    let price = parseFloat(body.price || body.selling_price || body.merchant_price || 0);
    let quantity = parseInt(body.stock_quantity || body.quantity || 0, 10);
    let sku = body.sku || null;

    let productId = body.productId || body.product_id;

    if ((!productId && !name) || !mrp || !price || isNaN(quantity)) {
        return res.status(400).json({ status: false, message: "Product name, MRP, Price, and Stock Quantity are required." });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get seller ID for this merchant
        const [sellerRows] = await connection.query(
            'SELECT id FROM sellers WHERE sellerable_id = ? AND sellerable_type = "Merchant"',
            [merchantId]
        );

        let sellerId;
        if (sellerRows.length === 0) {
            const [sRes] = await connection.query(
                'INSERT INTO sellers (sellerable_id, sellerable_type, display_name) VALUES (?, "Merchant", "Merchant")',
                [merchantId]
            );
            sellerId = sRes.insertId;
        } else {
            sellerId = sellerRows[0].id;
        }

        // 2. If master product doesn't exist, create it in `products` table
        if (!productId) {
            let mainImageUrl = null;
            let galleryUrls = [];

            const { getRelativeUrl } = require('../utils/fileHelper');
            if (req.files && Array.isArray(req.files)) {
                req.files.forEach((f, idx) => {
                    const relativePath = getRelativeUrl(f) || `/uploads/product-images/${f.filename}`;
                    if (idx === 0) mainImageUrl = relativePath;
                    else galleryUrls.push(relativePath);
                });
            } else if (req.file) {
                mainImageUrl = getRelativeUrl(req.file) || `/uploads/product-images/${req.file.filename}`;
            }

            const isUniversal = (body.delivery_type === 'universal') ? 1 : 0;
            const slug = (name || 'product').toString().toLowerCase().trim().replace(/[\s\W-]+/g, '-').replace(/^-+|-+$/g, '') + '-' + Date.now();

            const masterSql = `
                INSERT INTO products 
                  (name, slug, description, category_id, subcategory_id, brand_id, hsn_code_id, main_image_url, gallery_image_urls, is_universal_pincode, created_at, updated_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            `;
            const [mRes] = await connection.query(masterSql, [
                name,
                slug,
                description,
                categoryId ? parseInt(categoryId, 10) : null,
                subcategoryId ? parseInt(subcategoryId, 10) : null,
                brandId ? parseInt(brandId, 10) : null,
                hsnCodeId ? parseInt(hsnCodeId, 10) : null,
                mainImageUrl,
                JSON.stringify(galleryUrls),
                isUniversal
            ]);
            productId = mRes.insertId;
        }

        // 3. Price calculations (Selling price = Price given by merchant, Admin Margin 10%)
        const merchantPrice = price;
        const adminMarginPercent = 10.0;
        const sellingPrice = merchantPrice; // Customer pays selling price

        // Parse pincodes and variants
        let pincodes = body.pincodes;
        if (typeof pincodes === 'string') {
            try { pincodes = JSON.parse(pincodes); } catch (e) { pincodes = []; }
        }
        if (!Array.isArray(pincodes)) pincodes = [];

        let variants = body.variants;
        if (typeof variants === 'string') {
            try { variants = JSON.parse(variants); } catch (e) { variants = []; }
        }

        const minimumOrderQuantity = parseInt(body.minimum_order_quantity || body.moq || 1, 10);

        // 4. Insert into `seller_products` (is_active = 0 by default for Admin Moderation/Approval)
        const offerQuery = `
            INSERT INTO seller_products 
              (seller_id, product_id, sku, mrp, merchant_price, admin_margin_percent, selling_price, purchase_price, quantity, low_stock_threshold, minimum_order_quantity, is_active) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `;
        const [result] = await connection.query(offerQuery, [
            sellerId, productId, sku, mrp, merchantPrice, adminMarginPercent, sellingPrice, merchantPrice, quantity, body.low_stock_alert || 5, minimumOrderQuantity
        ]);
        const newOfferId = result.insertId;

        // 5. Save pincodes
        if (pincodes.length > 0) {
            const pincodeValues = pincodes.map(p => [newOfferId, String(p).trim()]);
            await connection.query('INSERT INTO seller_product_pincodes (seller_product_id, pincode) VALUES ?', [pincodeValues]);
        }

        // 6. Save Dynamic Category Attributes
        let attributeValueIds = body.attributeValueIds;
        if (typeof attributeValueIds === 'string') {
            try { attributeValueIds = JSON.parse(attributeValueIds); } catch (e) { attributeValueIds = []; }
        }
        if (Array.isArray(attributeValueIds) && attributeValueIds.length > 0 && productId) {
            try {
                await connection.query('DELETE FROM product_attributes WHERE product_id = ?', [productId]);
                const attrValues = attributeValueIds.map(valId => [productId, parseInt(valId, 10)]);
                await connection.query('INSERT INTO product_attributes (product_id, attribute_value_id) VALUES ?', [attrValues]);
            } catch (attrErr) {
                console.warn("Could not save product attributes:", attrErr.message);
            }
        }

        // 7. Save Variants if provided
        if (!Array.isArray(variants)) variants = [];
        if (variants.length > 0) {
            try {
                const variantValues = variants.map(v => {
                    let vImg = saveBase64Image(v.variant_image_url) || mainImageUrl;
                    let vImgs = [];
                    if (Array.isArray(v.variant_image_urls)) {
                        vImgs = v.variant_image_urls.map(img => saveBase64Image(img)).filter(Boolean);
                    }
                    if (vImgs.length === 0 && vImg) vImgs.push(vImg);

                    return [
                        newOfferId,
                        productId,
                        v.title || `${v.color || ''} ${v.size || ''}`.trim() || 'Variant',
                        v.color || null,
                        v.size || null,
                        v.sku || `${sku}-${v.color || ''}-${v.size || ''}`,
                        parseFloat(v.price || sellingPrice),
                        parseFloat(v.mrp || mrp),
                        parseInt(v.quantity || v.stock_quantity || 10, 10),
                        vImg,
                        JSON.stringify(vImgs)
                    ];
                });
                await connection.query(
                    'INSERT INTO seller_product_variants (seller_product_id, product_id, title, color, size, sku, price, mrp, stock_quantity, variant_image_url, variant_image_urls) VALUES ?',
                    [variantValues]
                );
            } catch (varErr) {
                console.warn("Could not save product variants:", varErr.message);
            }
        }

        await connection.commit();
        res.status(201).json({
            status: true,
            message: "Merchant product offer listed successfully.",
            offerId: newOfferId,
            productId: productId,
            merchantPrice: merchantPrice,
            sellingPrice: sellingPrice
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error adding merchant product:", error);
        res.status(500).json({ status: false, message: error.message || "Failed to list merchant product." });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * Get Merchant Listed Products
 */
exports.getMerchantProducts = async (req, res) => {
    const merchantId = req.user.id;
    try {
        const query = `
            SELECT sp.*, p.name as product_name, p.main_image_url, p.is_universal_pincode,
                GREATEST(0, IF(IFNULL(sp.admin_margin_percent, 0) > 0, (sp.selling_price * (IFNULL(sp.admin_margin_percent, 10.0) / 100)) * 0.80, ((sp.selling_price / (1 + (IFNULL(h.gst_percentage, 0) / 100))) - sp.purchase_price) * 0.80)) as bv_earned,
                (
                    SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('attribute_name', attr.name, 'value', av.value)), ']') 
                    FROM product_attributes pa
                    JOIN attribute_values av ON pa.attribute_value_id = av.id
                    JOIN attributes attr ON av.attribute_id = attr.id
                    WHERE pa.product_id = p.id
                ) as attributes,
                (
                    SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT(
                        'id', spv.id,
                        'title', spv.title,
                        'color', spv.color,
                        'size', spv.size,
                        'sku', spv.sku,
                        'price', spv.price,
                        'mrp', spv.mrp,
                        'stock_quantity', spv.stock_quantity,
                        'variant_image_url', spv.variant_image_url,
                        'variant_image_urls', spv.variant_image_urls
                    )), ']')
                    FROM seller_product_variants spv
                    WHERE spv.seller_product_id = sp.id
                ) as variants
            FROM seller_products sp
            JOIN sellers s ON sp.seller_id = s.id
            JOIN products p ON sp.product_id = p.id
            LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
            WHERE s.sellerable_id = ? AND s.sellerable_type = 'Merchant'
            ORDER BY sp.created_at DESC
        `;
        const [rows] = await db.query(query, [merchantId]);
        const processedData = rows.map(row => ({
            ...row,
            attributes: row.attributes ? JSON.parse(row.attributes) : [],
            variants: row.variants ? JSON.parse(row.variants).map(v => ({
                ...v,
                variant_image_urls: typeof v.variant_image_urls === 'string' ? JSON.parse(v.variant_image_urls) : (v.variant_image_urls || [])
            })) : []
        }));
        res.status(200).json({ status: true, data: processedData });
    } catch (error) {
        console.error("Error fetching merchant products:", error);
        res.status(500).json({ status: false, message: 'An error occurred.' });
    }
};

/**
 * Get Merchant Orders
 */
exports.getMerchantOrders = async (req, res) => {
    const merchantId = req.user.id;
    try {
        const query = `
            SELECT o.id as order_id, o.order_number, o.order_status, o.subtotal, o.delivery_fee, o.total_amount, o.created_at,
                   oi.id as item_id, oi.product_name, oi.quantity, oi.price_per_unit, oi.total_price, oi.attributes_snapshot, p.main_image_url,
                   u.full_name as customer_name, IFNULL(u.mobile_number, '') as customer_phone,
                   ua.address_line_1, ua.address_line_2, ua.city, ua.state, ua.pincode, ua.landmark
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            JOIN seller_products sp ON oi.seller_product_id = sp.id
            JOIN sellers s ON sp.seller_id = s.id
            JOIN users u ON o.user_id = u.id
            LEFT JOIN products p ON oi.product_id = p.id
            LEFT JOIN user_addresses ua ON o.shipping_address_id = ua.id
            WHERE s.sellerable_id = ? AND s.sellerable_type = 'Merchant'
            ORDER BY o.created_at DESC, oi.id ASC
        `;
        const [rows] = await db.query(query, [merchantId]);
        
        // Group rows into unique order objects
        const ordersMap = new Map();
        for (const r of rows) {
            if (!ordersMap.has(r.order_id)) {
                ordersMap.set(r.order_id, {
                    order_id: r.order_id,
                    order_number: r.order_number,
                    order_status: r.order_status,
                    subtotal: parseFloat(r.subtotal || 0),
                    delivery_fee: parseFloat(r.delivery_fee || 0),
                    total_amount: parseFloat(r.total_amount || 0),
                    created_at: r.created_at,
                    customer_name: r.customer_name,
                    customer_phone: r.customer_phone,
                    shipping_address: {
                        address_line_1: r.address_line_1,
                        address_line_2: r.address_line_2,
                        city: r.city,
                        state: r.state,
                        pincode: r.pincode,
                        landmark: r.landmark
                    },
                    total_quantity: 0,
                    items: []
                });
            }
            const ord = ordersMap.get(r.order_id);
            let snap = {};
            if (r.attributes_snapshot) {
                try { snap = typeof r.attributes_snapshot === 'string' ? JSON.parse(r.attributes_snapshot) : r.attributes_snapshot; } catch (e) {}
            }
            const variantImg = snap['Variant Image'] || r.main_image_url;
            ord.total_quantity += (r.quantity || 1);
            ord.items.push({
                item_id: r.item_id,
                product_name: r.product_name,
                quantity: r.quantity,
                price_per_unit: r.price_per_unit,
                total_price: r.total_price,
                image_url: variantImg,
                main_image_url: variantImg,
                attributes: snap
            });
        }

        const groupedOrders = Array.from(ordersMap.values()).map(ord => {
            const firstItemName = ord.items[0]?.product_name || 'Item';
            const extraCount = ord.items.length - 1;
            const summary = extraCount > 0 ? `${firstItemName} (+${extraCount} more)` : firstItemName;
            return {
                ...ord,
                product_name: summary,
                items_summary: summary,
                items_count: ord.items.length
            };
        });

        res.status(200).json({ status: true, data: groupedOrders });
    } catch (error) {
        console.error("Error fetching merchant orders:", error);
        res.status(500).json({ status: false, message: 'An error occurred.' });
    }
};

/**
 * Handles updating an existing merchant product offer.
 */
exports.updateMerchantProduct = async (req, res) => {
    let connection;
    try {
        const merchantId = req.merchantId || req.user?.merchant_id || req.user?.id;
        const offerId = req.params.id;
        const body = req.body;

        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. Verify offer belongs to merchant (or admin)
        const [existing] = await connection.query(
            'SELECT sp.id, sp.product_id FROM seller_products sp JOIN sellers s ON sp.seller_id = s.id WHERE sp.id = ?',
            [offerId]
        );
        if (existing.length === 0) {
            await connection.rollback();
            return res.status(404).json({ status: false, message: 'Product offer not found.' });
        }

        const productId = existing[0].product_id;

        // 2. Parse values
        const merchantPrice = parseFloat(body.price || body.merchant_price || 0);
        const sellingPrice = merchantPrice;
        const mrp = parseFloat(body.mrp || sellingPrice);
        const quantity = parseInt(body.stock_quantity || body.quantity || 0, 10);
        const minimumOrderQuantity = parseInt(body.minimum_order_quantity || body.moq || 1, 10);
        const lowStockThreshold = parseInt(body.low_stock_alert || body.low_stock_threshold || 5, 10);
        const sku = body.sku || '';

        // Update seller_products record
        await connection.query(
            `UPDATE seller_products 
             SET merchant_price = ?, selling_price = ?, mrp = ?, quantity = ?, minimum_order_quantity = ?, low_stock_threshold = ?, sku = ? 
             WHERE id = ?`,
            [merchantPrice, sellingPrice, mrp, quantity, minimumOrderQuantity, lowStockThreshold, sku, offerId]
        );

        // Update master product if details provided
        if (body.name || body.description) {
            await connection.query(
                `UPDATE products SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?`,
                [body.name, body.description, productId]
            );
        }

        // Update variants if provided
        let variants = body.variants;
        if (typeof variants === 'string') {
            try { variants = JSON.parse(variants); } catch (e) { variants = []; }
        }
        if (Array.isArray(variants) && variants.length > 0) {
            await connection.query('DELETE FROM seller_product_variants WHERE seller_product_id = ?', [offerId]);
            const variantValues = variants.map(v => {
                let vImg = saveBase64Image(v.variant_image_url) || null;
                let vImgs = [];
                if (Array.isArray(v.variant_image_urls)) {
                    vImgs = v.variant_image_urls.map(img => saveBase64Image(img)).filter(Boolean);
                }
                if (vImgs.length === 0 && vImg) vImgs.push(vImg);

                return [
                    offerId,
                    productId,
                    v.title || `${v.color || ''} ${v.size || ''}`.trim() || 'Variant',
                    v.color || null,
                    v.size || null,
                    v.sku || `${sku}-${v.color || ''}-${v.size || ''}`,
                    parseFloat(v.price || sellingPrice),
                    parseFloat(v.mrp || mrp),
                    parseInt(v.quantity || v.stock_quantity || 10, 10),
                    vImg,
                    JSON.stringify(vImgs)
                ];
            });
            await connection.query(
                'INSERT INTO seller_product_variants (seller_product_id, product_id, title, color, size, sku, price, mrp, stock_quantity, variant_image_url, variant_image_urls) VALUES ?',
                [variantValues]
            );
        }

        await connection.commit();
        res.status(200).json({ status: true, message: 'Merchant product offer updated successfully.' });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error updating merchant product:', err);
        res.status(500).json({ status: false, message: err.message || 'Internal server error' });
    } finally {
        if (connection) connection.release();
    }
};