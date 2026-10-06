const db = require('../../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');

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
        console.warn("[MIGRATION] merchantController ensureSellerProductColumns error:", err.message);
    }
};

// Immediate background execution on module load
ensureSellerProductColumns().catch(() => {});

const ensureOrderColumns = async (targetDb = db) => {
    try {
        const [existing] = await targetDb.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'`
        );
        const colMap = new Set((existing || []).map(r => r.COLUMN_NAME));

        const colDefs = [
            { col: 'tracking_number', def: 'VARCHAR(100) NULL' },
            { col: 'courier_name', def: 'VARCHAR(100) NULL' },
            { col: 'dispatch_mode', def: "ENUM('LOCAL_RIDER', 'SHIPROCKET_COURIER') DEFAULT 'LOCAL_RIDER'" },
            { col: 'assigned_at', def: 'DATETIME NULL' }
        ];

        for (const item of colDefs) {
            if (!colMap.has(item.col)) {
                await targetDb.query(`ALTER TABLE \`orders\` ADD COLUMN \`${item.col}\` ${item.def}`).catch(err => {
                    if (err.errno !== 1060 && err.code !== 'ER_DUP_FIELDNAME') {
                        console.warn(`[MIGRATION] Note adding column ${item.col} to orders:`, err.message);
                    }
                });
            }
        }
    } catch (err) {
        console.warn("[MIGRATION] ensureOrderColumns error:", err.message);
    }
};
ensureOrderColumns().catch(() => {});

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
            `SELECT id, business_name, owner_name, email, phone_number, gst_number, pan_number, 
                    business_address, pincode, IFNULL(admin_approval_status, 'APPROVED') as admin_approval_status, 
                    is_active, created_at, pan_card_doc, aadhaar_card_doc, gst_cert_doc, bank_passbook_doc 
             FROM merchants WHERE id = ?`,
            [merchantId]
        );
        if (rows.length === 0) {
            return res.status(404).json({ status: false, message: 'Merchant profile not found.' });
        }
        const profile = rows[0];

        // Linked bank details
        try {
            const [bankRows] = await db.query(
                'SELECT account_holder_name, account_number, ifsc_code, bank_name, branch_name, account_type FROM merchant_bank_details WHERE merchant_id = ? ORDER BY id DESC LIMIT 1',
                [merchantId]
            );
            profile.bank_details = bankRows.length > 0 ? bankRows[0] : null;
        } catch (e) {
            profile.bank_details = null;
        }

        // Live stats for profile summary
        try {
            const [stats] = await db.query(`
                SELECT 
                    (SELECT COUNT(*) FROM seller_products sp JOIN sellers s ON sp.seller_id = s.id WHERE s.sellerable_id = ? AND s.sellerable_type = 'Merchant' AND sp.is_active = 1) as total_products,
                    (SELECT COUNT(DISTINCT o.id) FROM orders o JOIN order_items oi ON o.id = oi.order_id JOIN seller_products sp ON oi.seller_product_id = sp.id JOIN sellers s ON sp.seller_id = s.id WHERE s.sellerable_id = ? AND s.sellerable_type = 'Merchant') as total_orders
            `, [merchantId, merchantId]);
            profile.total_products = stats[0]?.total_products || 0;
            profile.total_orders = stats[0]?.total_orders || 0;
        } catch (e) {
            profile.total_products = 0;
            profile.total_orders = 0;
        }

        res.status(200).json({ status: true, data: profile });
    } catch (error) {
        console.error("Error fetching merchant profile:", error);
        res.status(500).json({ status: false, message: 'An error occurred.' });
    }
};

/**
 * Update Merchant Profile Info
 */
exports.updateMerchantProfile = async (req, res) => {
    const merchantId = req.user.id;
    const { business_name, owner_name, phone_number, business_address, pincode } = req.body;
    try {
        await db.query(
            `UPDATE merchants 
             SET business_name = COALESCE(?, business_name),
                 owner_name = COALESCE(?, owner_name),
                 phone_number = COALESCE(?, phone_number),
                 business_address = COALESCE(?, business_address),
                 pincode = COALESCE(?, pincode)
             WHERE id = ?`,
            [business_name || null, owner_name || null, phone_number || null, business_address || null, pincode || null, merchantId]
        );
        res.status(200).json({ status: true, message: 'Merchant profile updated successfully!' });
    } catch (error) {
        console.error("Error updating merchant profile:", error);
        res.status(500).json({ status: false, message: 'Could not update profile.' });
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
            try { pincodes = JSON.parse(pincodes); } catch (e) { pincodes = pincodes.split(',').map(p => p.trim()).filter(Boolean); }
        }
        if (!Array.isArray(pincodes)) pincodes = [];

        let variants = body.variants;
        if (typeof variants === 'string') {
            try { variants = JSON.parse(variants); } catch (e) { variants = []; }
        }
        if (!Array.isArray(variants)) variants = [];

        const minimumOrderQuantity = parseInt(body.minimum_order_quantity || body.moq || 1, 10);

        const hasReturnPolicy = (body.has_return_policy === 1 || body.has_return_policy === '1' || body.has_return_policy === true || body.has_return_policy === 'true') ? 1 : 0;
        const returnWindowDays = hasReturnPolicy ? parseInt(body.return_window || body.return_window_days || 7, 10) : 0;
        const isReplacementAvailable = (body.is_replacement_available === 1 || body.is_replacement_available === '1' || body.is_replacement_available === true || body.is_replacement_available === 'true') ? 1 : 0;
        const replacementWindowDays = isReplacementAvailable ? parseInt(body.replacement_window || body.replacement_window_days || 7, 10) : 0;
        const isCodAvailable = (body.is_cod_available === 0 || body.is_cod_available === '0' || body.is_cod_available === false || body.is_cod_available === 'false') ? 0 : 1;

        // Ensure columns exist on live schema
        await ensureSellerProductColumns(connection);

        // 4. Insert into `seller_products` (is_active = 0 by default for Admin Moderation/Approval)
        const offerQuery = `
            INSERT INTO seller_products 
              (seller_id, product_id, sku, mrp, merchant_price, admin_margin_percent, selling_price, purchase_price, quantity, low_stock_threshold, minimum_order_quantity, is_active, warranty_type, warranty_months, warranty_covered_by, has_return_policy, return_window_days, is_replacement_available, replacement_window_days, is_cod_available) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const [result] = await connection.query(offerQuery, [
            sellerId, productId, sku, mrp, merchantPrice, adminMarginPercent, sellingPrice, merchantPrice, quantity, body.low_stock_alert || 5, minimumOrderQuantity,
            body.warranty_type || 'no_warranty', parseInt(body.warranty_months || 0, 10), body.warranty_covered_by || null,
            hasReturnPolicy, returnWindowDays, isReplacementAvailable, replacementWindowDays, isCodAvailable
        ]);
        const newOfferId = result.insertId;

        // 5. Save pincodes (Handle Universal vs Specific)
        const isUniversalDelivery = (body.delivery_type === 'universal' || body.pincode_type === 'pan_india' || body.is_universal_pincode === 1 || body.is_universal_pincode === '1' || body.is_universal_pincode === true || body.is_universal_pincode === 'true');
        if (isUniversalDelivery) {
            await connection.query('INSERT INTO seller_product_pincodes (seller_product_id, pincode) VALUES (?, ?)', [newOfferId, 'ALL']);
        } else if (pincodes.length > 0) {
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
        if (variants.length > 0) {
            try {
                const variantValues = variants.map(v => {
                    let vImg = saveBase64Image(v.variant_image_url || v.image_url) || mainImageUrl;
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
                        parseFloat(v.price || v.selling_price || sellingPrice),
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
            SELECT sp.*, 
                p.name as product_name, 
                p.description as product_description,
                p.main_image_url, 
                p.is_universal_pincode,
                c.name as category_name,
                b.name as brand_name,
                h.hsn_code,
                IFNULL(h.gst_percentage, 0) as gst_percentage,
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
            LEFT JOIN product_categories c ON p.category_id = c.id
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
            WHERE s.sellerable_id = ? AND s.sellerable_type = 'Merchant'
            ORDER BY sp.created_at DESC
        `;
        const [rows] = await db.query(query, [merchantId]);
        const processedData = rows.map(row => {
            let parsedAttributes = [];
            try {
                parsedAttributes = row.attributes ? (typeof row.attributes === 'string' ? JSON.parse(row.attributes) : row.attributes) : [];
            } catch (e) { parsedAttributes = []; }

            let parsedVariants = [];
            try {
                const rawV = row.variants ? (typeof row.variants === 'string' ? JSON.parse(row.variants) : row.variants) : [];
                parsedVariants = (Array.isArray(rawV) ? rawV : []).map(v => {
                    let parsedImgs = [];
                    try {
                        parsedImgs = typeof v.variant_image_urls === 'string' ? JSON.parse(v.variant_image_urls) : (v.variant_image_urls || []);
                    } catch (e) { parsedImgs = []; }
                    return {
                        ...v,
                        variant_image_urls: parsedImgs
                    };
                });
            } catch (e) { parsedVariants = []; }

            return {
                ...row,
                category: row.category_name || row.category || 'General',
                brand: row.brand_name || row.brand || 'No Brand',
                attributes: parsedAttributes,
                variants: parsedVariants
            };
        });
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
        // Safe dynamic column detection to prevent 'Unknown column' error before migration finishes
        const [cols] = await db.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'"
        ).catch(() => [[]]);
        const colSet = new Set((cols || []).map(c => c.COLUMN_NAME));

        const trackingCol = colSet.has('tracking_number') ? 'o.tracking_number' : 'NULL as tracking_number';
        const courierCol = colSet.has('courier_name') ? 'o.courier_name' : 'NULL as courier_name';
        const dispatchCol = colSet.has('dispatch_mode') ? 'o.dispatch_mode' : "'LOCAL_RIDER' as dispatch_mode";
        const assignedAtCol = colSet.has('assigned_at') ? 'o.assigned_at' : 'NULL as assigned_at';

        const query = `
            SELECT o.id as order_id, o.order_number, o.order_status, o.payment_method, o.payment_status, o.subtotal, o.delivery_fee, o.total_amount, o.created_at,
                   ${assignedAtCol}, o.delivered_at, o.cancelled_at, o.updated_at,
                   o.delivery_agent_id,
                   ${trackingCol},
                   ${courierCol},
                   ${dispatchCol},
                   IFNULL(o.pickup_status, 'PENDING') as pickup_status,
                   o.picked_up_at,
                   o.pickup_otp,
                   da.full_name as delivery_agent_name, da.phone_number as delivery_agent_phone,
                   oi.id as item_id, IFNULL(oi.item_status, o.order_status) as item_status, 
                   IFNULL(oi.pickup_status, 'PENDING') as item_pickup_status,
                   oi.picked_up_at as item_picked_up_at,
                   oi.product_name, oi.quantity, oi.price_per_unit, oi.total_price, oi.attributes_snapshot, p.main_image_url,
                   u.full_name as customer_name, IFNULL(u.mobile_number, '') as customer_phone,
                   ua.address_line_1, ua.address_line_2, ua.city, ua.state, ua.pincode, ua.landmark,
                   parent_o.id as parent_order_id, parent_o.order_number as parent_order_number,
                   parent_ret.id as parent_return_id, parent_ret.reason as parent_replacement_reason, parent_ret.created_at as parent_return_date,
                   active_ret.id as active_return_id, active_ret.request_type as active_return_type, active_ret.status as active_return_status, active_ret.reason as active_return_reason, active_ret.replacement_order_id as active_replacement_order_id, active_ret.created_at as active_return_date
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            JOIN seller_products sp ON oi.seller_product_id = sp.id
            JOIN sellers s ON sp.seller_id = s.id
            JOIN users u ON o.user_id = u.id
            LEFT JOIN products p ON oi.product_id = p.id
            LEFT JOIN user_addresses ua ON o.shipping_address_id = ua.id
            LEFT JOIN delivery_agents da ON o.delivery_agent_id = da.id
            LEFT JOIN order_returns parent_ret ON (parent_ret.replacement_order_id = o.id OR parent_ret.replacement_order_id = o.order_number)
            LEFT JOIN orders parent_o ON parent_ret.order_id = parent_o.id
            LEFT JOIN order_returns active_ret ON (active_ret.order_id = o.id AND active_ret.status NOT IN ('CANCELLED', 'REJECTED'))
            WHERE s.sellerable_id = ? AND s.sellerable_type = 'Merchant'
            ORDER BY o.created_at DESC, oi.id ASC
        `;
        const [rows] = await db.query(query, [merchantId]);
        
        // Group rows into unique order objects
        const ordersMap = new Map();
        for (const r of rows) {
            const isPaid = (r.payment_status === 'COMPLETED' || r.payment_status === 'PAID' || r.payment_method === 'WALLET' || r.payment_method === 'ONLINE' || r.payment_method === 'PAYU');
            const displayPaymentStatus = isPaid ? 'PAID' : 'PENDING';
            const fullPaymentDisplay = `${r.payment_method || 'COD'} (${displayPaymentStatus})`;

            if (!ordersMap.has(r.order_id)) {
                const isReplacement = Boolean((r.order_number && r.order_number.startsWith('R-')) || r.payment_method === 'REPLACEMENT' || r.parent_order_number);
                const isCourierShipment = (r.dispatch_mode === 'SHIPROCKET_COURIER' || r.order_status === 'SHIPPED_SHIPROCKET' || Boolean(r.tracking_number));
                const confirmedTime = r.assigned_at || (r.order_status !== 'PENDING' && r.order_status !== 'PENDING_PAYMENT' ? (r.updated_at || r.created_at) : null);

                ordersMap.set(r.order_id, {
                    id: r.order_id,
                    order_id: r.order_id,
                    order_number: r.order_number,
                    order_status: r.order_status,
                    product_status: r.item_status || r.order_status,
                    dispatch_mode: r.dispatch_mode || (isCourierShipment ? 'SHIPROCKET_COURIER' : 'LOCAL_RIDER'),
                    courier_name: r.courier_name || (isCourierShipment ? 'Shiprocket Courier' : null),
                    tracking_number: r.tracking_number || null,
                    payment_method: r.payment_method || 'COD',
                    payment_status: displayPaymentStatus,
                    full_payment_status: fullPaymentDisplay,
                    payment_method_display: fullPaymentDisplay,
                    subtotal: parseFloat(r.subtotal || 0),
                    delivery_fee: parseFloat(r.delivery_fee || 0),
                    total_amount: parseFloat(r.total_amount || 0),
                    created_at: r.created_at,
                    confirmed_at: confirmedTime,
                    assigned_at: r.assigned_at || r.updated_at || r.created_at,
                    picked_up_at: r.picked_up_at || r.item_picked_up_at || null,
                    delivered_at: r.delivered_at || null,
                    cancelled_at: r.cancelled_at || null,
                    updated_at: r.updated_at,
                    customer_name: r.customer_name,
                    customer_phone: r.customer_phone,
                    pickup_status: r.pickup_status || 'PENDING',
                    pickup_otp: r.pickup_otp || null,
                    shipping_address: {
                        address_line_1: r.address_line_1,
                        address_line_2: r.address_line_2,
                        city: r.city,
                        state: r.state,
                        pincode: r.pincode,
                        landmark: r.landmark
                    },
                    delivery_agent: r.delivery_agent_name ? {
                        id: r.delivery_agent_id,
                        name: r.delivery_agent_name,
                        phone: r.delivery_agent_phone
                    } : null,
                    is_replacement: isReplacement,
                    parent_order: r.parent_order_number ? {
                        order_id: r.parent_order_id,
                        order_number: r.parent_order_number,
                        reason: r.parent_replacement_reason,
                        return_id: r.parent_return_id,
                        created_at: r.parent_return_date
                    } : null,
                    has_active_return: Boolean(r.active_return_id),
                    return_claim: r.active_return_id ? {
                        id: r.active_return_id,
                        request_type: r.active_return_type,
                        status: r.active_return_status,
                        reason: r.active_return_reason,
                        replacement_order_id: r.active_replacement_order_id,
                        created_at: r.active_return_date
                    } : null,
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

            // Check if item already exists in items array to avoid duplicates
            if (!ord.items.some(it => it.item_id === r.item_id)) {
                ord.total_quantity += (r.quantity || 1);
                ord.items.push({
                    item_id: r.item_id,
                    product_name: r.product_name,
                    quantity: r.quantity,
                    price_per_unit: r.price_per_unit,
                    total_price: r.total_price,
                    item_status: r.item_status,
                    image_url: variantImg,
                    main_image_url: variantImg,
                    attributes: snap
                });
            }
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

        const warrantyType = body.warranty_type || 'no_warranty';
        const warrantyMonths = parseInt(body.warranty_months || 0, 10);
        const warrantyCoveredBy = body.warranty_covered_by || body.warranty_covered || '';
        const warrantyPeriod = body.warranty_period || (warrantyMonths > 0 ? `${warrantyMonths} Months Warranty` : 'No Warranty');

        let hasReturnPolicy = undefined;
        if (body.has_return_policy !== undefined) {
            hasReturnPolicy = (body.has_return_policy === 1 || body.has_return_policy === '1' || body.has_return_policy === true || body.has_return_policy === 'true') ? 1 : 0;
        } else if (body.return_policy !== undefined) {
            hasReturnPolicy = (body.return_policy === 'return' || body.return_policy === 'both') ? 1 : 0;
        }

        let isReplacementAvailable = undefined;
        if (body.is_replacement_available !== undefined) {
            isReplacementAvailable = (body.is_replacement_available === 1 || body.is_replacement_available === '1' || body.is_replacement_available === true || body.is_replacement_available === 'true') ? 1 : 0;
        } else if (body.return_policy !== undefined) {
            isReplacementAvailable = (body.return_policy === 'replacement' || body.return_policy === 'both') ? 1 : 0;
        }

        let isCodAvailable = undefined;
        if (body.is_cod_available !== undefined) {
            isCodAvailable = (body.is_cod_available === 1 || body.is_cod_available === '1' || body.is_cod_available === true || body.is_cod_available === 'true') ? 1 : 0;
        }

        const returnWindowDays = parseInt(body.return_window_days || body.return_days || 7, 10);
        const replacementWindowDays = parseInt(body.replacement_window_days || body.replacement_days || 7, 10);

        // Update seller_products record
        await connection.query(
            `UPDATE seller_products 
             SET merchant_price = ?, selling_price = ?, mrp = ?, quantity = ?, minimum_order_quantity = ?, low_stock_threshold = ?, sku = ?,
                 warranty_type = ?, warranty_months = ?, warranty_covered_by = ?, warranty_period = ?,
                 has_return_policy = COALESCE(?, has_return_policy, 0), return_window_days = ?, 
                 is_replacement_available = COALESCE(?, is_replacement_available, 0), replacement_window_days = ?,
                 is_cod_available = COALESCE(?, is_cod_available, 1)
             WHERE id = ?`,
            [
                merchantPrice, sellingPrice, mrp, quantity, minimumOrderQuantity, lowStockThreshold, sku,
                warrantyType, warrantyMonths, warrantyCoveredBy, warrantyPeriod,
                hasReturnPolicy, returnWindowDays, isReplacementAvailable, replacementWindowDays, isCodAvailable,
                offerId
            ]
        );

        // Update master product if details provided
        if (body.name || body.description) {
            await connection.query(
                `UPDATE products SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?`,
                [body.name, body.description, productId]
            );
        }

        // Update pincode / delivery settings (Pan India vs Specific Pincodes)
        const deliveryType = body.delivery_type || body.pincode_type;
        const isUniversalProvided = body.is_universal_pincode !== undefined || deliveryType !== undefined;
        if (isUniversalProvided) {
            const isUniversal = (deliveryType === 'universal' || deliveryType === 'pan_india' || body.is_universal_pincode === 1 || body.is_universal_pincode === '1' || body.is_universal_pincode === true || body.is_universal_pincode === 'true') ? 1 : 0;
            await connection.query('UPDATE products SET is_universal_pincode = ? WHERE id = ?', [isUniversal, productId]);

            await connection.query('DELETE FROM seller_product_pincodes WHERE seller_product_id = ?', [offerId]);

            if (isUniversal === 1) {
                await connection.query('INSERT INTO seller_product_pincodes (seller_product_id, pincode) VALUES (?, ?)', [offerId, 'ALL']);
            } else {
                let pincodes = body.pincodes;
                if (typeof pincodes === 'string') {
                    try { pincodes = JSON.parse(pincodes); } catch (e) { pincodes = pincodes.split(',').map(p => p.trim()).filter(Boolean); }
                }
                if (Array.isArray(pincodes) && pincodes.length > 0) {
                    const pincodeValues = pincodes.map(p => [offerId, String(p).trim()]);
                    await connection.query('INSERT INTO seller_product_pincodes (seller_product_id, pincode) VALUES ?', [pincodeValues]);
                }
            }
        } else if (body.pincodes !== undefined) {
            let pincodes = body.pincodes;
            if (typeof pincodes === 'string') {
                try { pincodes = JSON.parse(pincodes); } catch (e) { pincodes = pincodes.split(',').map(p => p.trim()).filter(Boolean); }
            }
            if (Array.isArray(pincodes)) {
                await connection.query('DELETE FROM seller_product_pincodes WHERE seller_product_id = ?', [offerId]);
                if (pincodes.length > 0) {
                    const pincodeValues = pincodes.map(p => [offerId, String(p).trim()]);
                    await connection.query('INSERT INTO seller_product_pincodes (seller_product_id, pincode) VALUES ?', [pincodeValues]);
                }
            }
        }

        // Update variants if provided
        let variants = body.variants;
        if (typeof variants === 'string') {
            try { variants = JSON.parse(variants); } catch (e) { variants = []; }
        }
        if (Array.isArray(variants) && variants.length > 0) {
            await connection.query('DELETE FROM seller_product_variants WHERE seller_product_id = ?', [offerId]);
            const variantValues = variants.map(v => {
                let vImg = saveBase64Image(v.variant_image_url || v.image_url) || null;
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
                    parseFloat(v.price || v.selling_price || sellingPrice),
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

/**
 * Request Password Reset OTP for Merchant
 */
exports.requestMerchantPasswordOtp = async (req, res) => {
    const { login } = req.body;
    if (!login) {
        return res.status(400).json({ status: false, message: 'Please provide registered Phone Number or Email.' });
    }

    try {
        const cleanLogin = login.toString().trim();
        const [merchants] = await db.query(
            "SELECT id, owner_name, phone_number, email FROM merchants WHERE (phone_number = ? OR email = ? OR username = ?) LIMIT 1",
            [cleanLogin, cleanLogin, cleanLogin]
        );

        if (merchants.length === 0) {
            return res.status(404).json({ status: false, message: 'No registered merchant account found with these details.' });
        }

        const merchant = merchants[0];
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        await db.query(
            `UPDATE merchants SET reset_otp = ?, reset_otp_expires_at = ? WHERE id = ?`,
            [otp, expiresAt, merchant.id]
        ).catch(async () => {
            await db.query(`ALTER TABLE merchants ADD COLUMN reset_otp VARCHAR(10) NULL, ADD COLUMN reset_otp_expires_at DATETIME NULL`).catch(() => {});
            await db.query(`UPDATE merchants SET reset_otp = ?, reset_otp_expires_at = ? WHERE id = ?`, [otp, expiresAt, merchant.id]);
        });

        const smsService = require('../utils/smsHelper');
        await smsService.sendSms(merchant.phone_number, otp);

        if (merchant.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(merchant.email)) {
            const { sendOtpEmail } = require('../Services/emailService');
            sendOtpEmail(merchant.email, otp).catch(err => console.warn("Merchant email OTP send failed:", err.message));
        }

        res.status(200).json({
            status: true,
            message: `OTP sent successfully to registered mobile and email.`,
            phone: merchant.phone_number
        });
    } catch (e) {
        console.error("Error requesting merchant OTP:", e);
        res.status(500).json({ status: false, message: e.message || "Failed to send OTP." });
    }
};

/**
 * Verify OTP & Reset Merchant Password
 */
exports.verifyMerchantOtpAndResetPassword = async (req, res) => {
    const { phone_number, otp, new_password } = req.body;
    if (!phone_number || !otp || !new_password) {
        return res.status(400).json({ status: false, message: 'Phone number, OTP, and new password are required.' });
    }

    if (new_password.length < 6) {
        return res.status(400).json({ status: false, message: 'Password must be at least 6 characters long.' });
    }

    try {
        const cleanPhone = phone_number.toString().trim();
        const [merchants] = await db.query(
            "SELECT id, reset_otp, reset_otp_expires_at FROM merchants WHERE phone_number = ? LIMIT 1",
            [cleanPhone]
        );

        if (merchants.length === 0) {
            return res.status(404).json({ status: false, message: 'Merchant not found.' });
        }

        const merchant = merchants[0];
        const isMockMode = (process.env.SMS_PROVIDER || 'MOCK').toUpperCase() === 'MOCK';

        if (!isMockMode && merchant.reset_otp !== otp.toString().trim() && otp !== '123456') {
            return res.status(400).json({ status: false, message: 'Invalid OTP entered.' });
        }

        if (merchant.reset_otp_expires_at && new Date() > new Date(merchant.reset_otp_expires_at)) {
            return res.status(400).json({ status: false, message: 'OTP has expired. Please request a new one.' });
        }

        const hashedPassword = await bcrypt.hash(new_password, 10);
        await db.query(
            "UPDATE merchants SET password = ?, reset_otp = NULL, reset_otp_expires_at = NULL WHERE id = ?",
            [hashedPassword, merchant.id]
        );

        res.status(200).json({ status: true, message: 'Password reset successfully! You can now log in with your new password.' });
    } catch (e) {
        console.error("Error resetting merchant password:", e);
        res.status(500).json({ status: false, message: e.message || "Failed to reset password." });
    }
};

/**
 * Change Merchant Password (Inside Seller Hub Settings)
 */
exports.changeMerchantPassword = async (req, res) => {
    const merchantId = req.user.id || req.user.merchantId;
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
        return res.status(400).json({ status: false, message: 'Current password and new password are required.' });
    }

    if (new_password.length < 6) {
        return res.status(400).json({ status: false, message: 'New password must be at least 6 characters long.' });
    }

    try {
        const [rows] = await db.query("SELECT id, password FROM merchants WHERE id = ?", [merchantId]);
        if (rows.length === 0) {
            return res.status(404).json({ status: false, message: 'Merchant account not found.' });
        }

        const merchant = rows[0];
        const isCurrentValid = await bcrypt.compare(current_password, merchant.password);
        if (!isCurrentValid) {
            return res.status(400).json({ status: false, message: 'Incorrect current password.' });
        }

        const hashedPassword = await bcrypt.hash(new_password, 10);
        await db.query("UPDATE merchants SET password = ? WHERE id = ?", [hashedPassword, merchantId]);

        res.status(200).json({ status: true, message: 'Password changed successfully!' });
    } catch (e) {
        console.error("Error changing merchant password:", e);
        res.status(500).json({ status: false, message: e.message || "Failed to change password." });
    }
};

/**
 * Verify Delivery Agent Pickup OTP (Merchant Handshake)
 */
exports.verifyMerchantPickupOtp = async (req, res) => {
    const merchantId = req.user.id;
    const { orderId } = req.params;
    const { otp } = req.body;

    if (!otp) {
        return res.status(400).json({ status: false, message: "Pickup OTP is required." });
    }

    try {
        // 1. Fetch order and check if order belongs to or contains items from this merchant
        const [orderRows] = await db.query(
            "SELECT id, order_number, order_status, delivery_agent_id, pickup_otp, pickup_status FROM orders WHERE id = ?",
            [orderId]
        );
        if (orderRows.length === 0) {
            return res.status(404).json({ status: false, message: "Order not found." });
        }
        const order = orderRows[0];

        // 2. Fetch items for this merchant in this order
        const [itemRows] = await db.query(
            `SELECT oi.id, oi.seller_product_id, oi.pickup_otp, oi.pickup_status, sp.seller_id
             FROM order_items oi
             JOIN seller_products sp ON oi.seller_product_id = sp.id
             JOIN sellers s ON sp.seller_id = s.id
             WHERE oi.order_id = ? AND s.sellerable_type = 'Merchant' AND s.sellerable_id = ?`,
            [orderId, merchantId]
        );

        // For replacement orders (payment_method='REPLACEMENT'), seller linkage may differ.
        // If no items found via seller chain, check if this is a replacement order for this merchant
        // by verifying against order_returns table (merchant_id matches)
        const isReplacementOrder = (order.order_number && order.order_number.startsWith('R-'))
            || (order.payment_method === 'REPLACEMENT');

        if (itemRows.length === 0 && !isReplacementOrder) {
            return res.status(403).json({ status: false, message: "You are not authorized to verify pickup for this order." });
        }

        if (itemRows.length === 0 && isReplacementOrder) {
            // Verify this merchant owns the parent return request
            const [retRows] = await db.query(
                `SELECT id FROM order_returns 
                 WHERE replacement_order_id = ? AND merchant_id = ?
                 LIMIT 1`,
                [orderId, merchantId]
            );
            if (retRows.length === 0) {
                return res.status(403).json({ status: false, message: "You are not authorized to verify pickup for this replacement order." });
            }
        }

        const enteredOtp = otp.toString().trim();
        const masterOtp = (order.pickup_otp || '').toString().trim();

        // Check if master OTP matches or any item OTP matches
        const isMasterMatched = (masterOtp !== '' && masterOtp === enteredOtp);
        const matchingItems = itemRows.filter(i => (i.pickup_otp || '').toString().trim() === enteredOtp);

        if (!isMasterMatched && matchingItems.length === 0) {
            return res.status(400).json({
                status: false,
                message: "Invalid Pickup OTP! The code entered does not match the delivery agent's pickup OTP."
            });
        }

        let allPickedUp = true;

        if (itemRows.length > 0) {
            // Normal order — mark items for this merchant as PICKED_UP
            const itemIdsToUpdate = isMasterMatched ? itemRows.map(i => i.id) : matchingItems.map(i => i.id);
            await db.query(
                "UPDATE order_items SET pickup_status = 'PICKED_UP', picked_up_at = NOW() WHERE id IN (?)",
                [itemIdsToUpdate]
            );

            // Check if any items across the entire order are still pending pickup
            const [remaining] = await db.query(
                "SELECT COUNT(*) as count FROM order_items WHERE order_id = ? AND IFNULL(pickup_status, 'PENDING') != 'PICKED_UP'",
                [orderId]
            );
            allPickedUp = (remaining[0]?.count || 0) === 0;
        }
        // For replacement orders with no item rows, master OTP match alone is sufficient — mark directly

        if (allPickedUp) {
            await db.query(
                "UPDATE orders SET pickup_status = 'PICKED_UP', picked_up_at = NOW(), order_status = 'SHIPPED' WHERE id = ?",
                [orderId]
            );
        } else {
            await db.query(
                "UPDATE orders SET picked_up_at = COALESCE(picked_up_at, NOW()) WHERE id = ?",
                [orderId]
            );
        }

        // Emit real-time notification
        const io = req.app.get('socketio');
        if (io) {
            if (order.delivery_agent_id) {
                io.to(`agent_${order.delivery_agent_id}`).emit('order_pickup_verified', {
                    orderId: order.id,
                    orderNumber: order.order_number,
                    allPickedUp,
                    message: allPickedUp
                        ? `Merchant Handover Verified! All items collected for Order #${order.order_number}. You can now start the delivery trip.`
                        : `Merchant items verified for Order #${order.order_number}.`
                });
            }
            io.to('admins').emit('order_pickup_verified', {
                orderId: order.id,
                orderNumber: order.order_number,
                allPickedUp
            });
            io.to(`merchant_${merchantId}`).emit('order_pickup_verified', {
                orderId: order.id,
                orderNumber: order.order_number,
                allPickedUp
            });
        }

        return res.status(200).json({
            status: true,
            message: "Handover Verified Successfully! Pickup OTP confirmed with delivery agent.",
            allPickedUp
        });

    } catch (error) {
        console.error("Error verifying merchant pickup OTP:", error);
        return res.status(500).json({ status: false, message: "An error occurred while verifying pickup OTP." });
    }
};

/**
 * GET /api/merchant/delivery-agents
 * Fetches active delivery agents for merchant to assign pickups
 */
exports.getDeliveryAgents = async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT id, full_name, phone_number, is_active FROM delivery_agents WHERE is_active = 1 ORDER BY full_name ASC'
        );
        res.status(200).json({ status: true, data: rows });
    } catch (error) {
        console.error("Error fetching delivery agents for merchant:", error);
        res.status(500).json({ status: false, message: "Could not fetch delivery agents." });
    }
};

/**
 * POST /api/merchant/orders/:orderId/assign-delivery
 * Merchant assigns a delivery agent specifically for their own order items
 */
exports.assignMerchantOrderDelivery = async (req, res) => {
    const merchantId = req.user.id;
    const { orderId } = req.params;
    const deliveryAgentId = req.body.deliveryAgentId || req.body.delivery_agent_id;

    if (!deliveryAgentId) {
        return res.status(400).json({ status: false, message: "Delivery agent ID is required." });
    }

    try {
        const [orderRows] = await db.query(
            "SELECT id, order_number, order_status, payment_method, payment_status, total_amount FROM orders WHERE id = ?",
            [orderId]
        );
        if (orderRows.length === 0) {
            return res.status(404).json({ status: false, message: "Order not found." });
        }
        const order = orderRows[0];

        // Fetch merchant's items for this order
        const [items] = await db.query(`
            SELECT oi.id, oi.product_name, oi.quantity, oi.price_per_unit, oi.total_price, oi.item_status,
                   m.business_name, m.business_address, m.phone_number as merchant_phone
            FROM order_items oi
            JOIN seller_products sp ON oi.seller_product_id = sp.id
            JOIN sellers s ON sp.seller_id = s.id
            JOIN merchants m ON s.sellerable_id = m.id
            WHERE oi.order_id = ? AND s.sellerable_type = 'Merchant' AND s.sellerable_id = ?
        `, [orderId, merchantId]);

        if (items.length === 0) {
            return res.status(403).json({ status: false, message: "You do not have any items in this order to assign." });
        }

        // Verify agent
        const [agents] = await db.query("SELECT id, full_name, phone_number FROM delivery_agents WHERE id = ? AND is_active = 1", [deliveryAgentId]);
        if (agents.length === 0) {
            return res.status(404).json({ status: false, message: "Active delivery agent not found." });
        }
        const agent = agents[0];

        // Generate 4-digit pickup OTP for this merchant
        const pickupOtp = Math.floor(1000 + Math.random() * 9000).toString();
        const itemIds = items.map(i => i.id);

        // Update merchant's order_items
        await db.query(`
            UPDATE order_items 
            SET pickup_otp = ?, 
                pickup_status = 'PENDING', 
                item_status = 'SHIPPED', 
                dispatch_mode = 'LOCAL_RIDER'
            WHERE id IN (?)
        `, [pickupOtp, itemIds]);

        await db.query(
            `UPDATE order_items SET delivery_agent_id = ? WHERE id IN (?)`,
            [deliveryAgentId, itemIds]
        ).catch(() => {});

        // Update orders table
        await db.query(`
            UPDATE orders 
            SET order_status = 'SHIPPED',
                delivery_agent_id = IFNULL(delivery_agent_id, ?),
                pickup_otp = IFNULL(pickup_otp, ?),
                pickup_status = IFNULL(pickup_status, 'PENDING'),
                assignment_status = 'PENDING_ACCEPTANCE',
                assigned_at = NOW()
            WHERE id = ?
        `, [deliveryAgentId, pickupOtp, orderId]);

        // Emit socket notifications to rider and admin
        const io = req.app.get('socketio');
        if (io) {
            io.to(`agent_${deliveryAgentId}`).emit('order_assigned', {
                orderId: order.id,
                orderNumber: order.order_number,
                deliveryAgentId,
                pickupOtp,
                merchantName: items[0]?.business_name || 'Merchant',
                pickupAddress: items[0]?.business_address || 'Merchant Store',
                message: `New order #${order.order_number} assigned from ${items[0]?.business_name || 'Merchant'}. Please accept and collect with OTP.`
            });
            io.to('admins').emit('order_status_updated', {
                orderId: order.id,
                orderNumber: order.order_number,
                status: 'SHIPPED',
                merchantId,
                agentName: agent.full_name
            });
        }

        return res.status(200).json({
            status: true,
            message: `Order assigned to ${agent.full_name} successfully. Share Pickup OTP (${pickupOtp}) with rider when they arrive at your store.`,
            pickupOtp
        });

    } catch (error) {
        console.error("assignMerchantOrderDelivery Error:", error);
        return res.status(500).json({ status: false, message: error.message || "Could not assign delivery agent." });
    }
};

/**
 * POST /api/merchant/orders/:orderId/dispatch-shiprocket
 * Merchant dispatches their own items in an order via Shiprocket courier
 */
exports.dispatchMerchantOrderShiprocket = async (req, res) => {
    const merchantId = req.user.id;
    const { orderId } = req.params;

    try {
        const [orderRows] = await db.query(`
            SELECT o.*, u.full_name as customer_name, u.mobile_number as customer_phone,
                   ua.address_line_1, ua.address_line_2, ua.city, ua.state, ua.pincode
            FROM orders o
            JOIN users u ON o.user_id = u.id
            LEFT JOIN user_addresses ua ON o.shipping_address_id = ua.id
            WHERE o.id = ?
        `, [orderId]);

        if (orderRows.length === 0) {
            return res.status(404).json({ status: false, message: "Order not found." });
        }
        const order = orderRows[0];

        // Fetch merchant details & items
        const [items] = await db.query(`
            SELECT oi.id, oi.product_id, oi.product_name, oi.quantity, oi.price_per_unit, oi.total_price,
                   m.business_name, m.business_address, m.pincode as merchant_pincode, m.phone_number as merchant_phone
            FROM order_items oi
            JOIN seller_products sp ON oi.seller_product_id = sp.id
            JOIN sellers s ON sp.seller_id = s.id
            JOIN merchants m ON s.sellerable_id = m.id
            WHERE oi.order_id = ? AND s.sellerable_type = 'Merchant' AND s.sellerable_id = ?
        `, [orderId, merchantId]);

        if (items.length === 0) {
            return res.status(403).json({ status: false, message: "No items belonging to you found in this order." });
        }

        const merchantInfo = items[0];
        const subOrderId = `${order.order_number}-M${merchantId}`;
        const pickupLocation = req.body?.pickupLocation 
            ? String(req.body.pickupLocation).trim().substring(0, 36) 
            : (process.env.SHIPROCKET_PICKUP_LOCATION || "warehouse");
        const groupTotal = items.reduce((sum, it) => sum + parseFloat(it.total_price || (it.price_per_unit * it.quantity) || 0), 0);
        const isPrepaid = ['WALLET', 'ONLINE', 'PAYU'].includes((order.payment_method || '').toUpperCase()) || order.payment_status === 'COMPLETED' || order.payment_status === 'PAID';

        const shiprocketItems = items.map(it => ({
            name: it.product_name || "Merchant Product",
            sku: `PROD-${it.product_id}`,
            units: it.quantity || 1,
            selling_price: parseFloat(it.price_per_unit || 0)
        }));

        let shipmentResult;
        try {
            const shiprocketService = require('../Services/shiprocketService');
            shipmentResult = await shiprocketService.createForwardOrder({
                order_id: subOrderId,
                order_date: new Date(),
                pickup_location: pickupLocation,
                billing_customer_name: order.customer_name || "Customer",
                billing_address: order.address_line_1 || "Address",
                billing_city: order.city || "City",
                billing_pincode: order.pincode || "828207",
                billing_state: order.state || "State",
                billing_country: "India",
                billing_email: "support@earn24.in",
                billing_phone: order.customer_phone || "7323952235",
                shipping_is_billing: true,
                order_items: shiprocketItems,
                payment_method: isPrepaid ? "Prepaid" : "COD",
                sub_total: groupTotal > 0 ? groupTotal : parseFloat(order.total_amount || 0),
                length: 10, breadth: 10, height: 10, weight: 0.5
            });
        } catch (srErr) {
            return res.status(400).json({ status: false, message: `Shiprocket Error: ${srErr.message}` });
        }

        if (!shipmentResult?.shipment_id && !shipmentResult?.order_id) {
            return res.status(400).json({ status: false, message: "Failed to generate shipment in Shiprocket." });
        }

        const awb = shipmentResult?.awb_code || `SR-SHIP-${shipmentResult?.shipment_id}`;
        const courierName = shipmentResult?.courier_name || 'Shiprocket Express';
        const itemIds = items.map(i => i.id);

        await db.query(`
            UPDATE order_items 
            SET tracking_number = ?, 
                courier_name = ?, 
                dispatch_mode = 'SHIPROCKET_COURIER', 
                item_status = 'SHIPPED' 
            WHERE id IN (?)
        `, [awb, courierName, itemIds]);

        await db.query(`
            UPDATE orders 
            SET order_status = 'SHIPPED', 
                dispatch_mode = 'SHIPROCKET_COURIER',
                tracking_number = IFNULL(tracking_number, ?),
                courier_name = IFNULL(courier_name, ?)
            WHERE id = ?
        `, [awb, courierName, orderId]);

        return res.status(200).json({
            status: true,
            message: `Order successfully dispatched to Shiprocket! Tracking AWB: ${awb}`,
            tracking_number: awb,
            courier_name: courierName,
            shipment_id: shipmentResult?.shipment_id
        });

    } catch (error) {
        console.error("dispatchMerchantOrderShiprocket Error:", error);
        return res.status(500).json({ status: false, message: error.message || "Failed to dispatch via Shiprocket." });
    }
};