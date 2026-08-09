const db = require('../../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const moment = require('moment-timezone');

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
 * Merchant Add Product Listing (With 10% Admin Margin Auto Calculation)
 */
exports.addMerchantProduct = async (req, res) => {
    const merchantId = req.user.id;
    const {
        productId, sku, mrp, merchantPrice, adminMarginPercent = 10.0, quantity,
        pincodes, low_stock_threshold = 5, isUniversalPincode = 0
    } = req.body;

    if (!productId || !mrp || !merchantPrice || !quantity) {
        return res.status(400).json({ status: false, message: "Product ID, MRP, Merchant Price, and Quantity are required." });
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
            // Create seller profile if missing
            const [sRes] = await connection.query(
                'INSERT INTO sellers (sellerable_id, sellerable_type, display_name) VALUES (?, "Merchant", "Merchant")',
                [merchantId]
            );
            sellerId = sRes.insertId;
        } else {
            sellerId = sellerRows[0].id;
        }

        // 2. Calculate User Selling Price (Merchant Price + 10% Admin Margin)
        const parsedMerchantPrice = parseFloat(merchantPrice);
        const marginPct = parseFloat(adminMarginPercent);
        const sellingPrice = parsedMerchantPrice + (parsedMerchantPrice * (marginPct / 100));

        // 3. Update Master Product Universal Pincode Flag if specified
        if (isUniversalPincode) {
            await connection.query("UPDATE products SET is_universal_pincode = ? WHERE id = ?", [isUniversalPincode ? 1 : 0, productId]);
        }

        // 4. Insert into seller_products
        const offerQuery = `
            INSERT INTO seller_products 
              (seller_id, product_id, sku, mrp, merchant_price, admin_margin_percent, selling_price, purchase_price, quantity, low_stock_threshold) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const [result] = await connection.query(offerQuery, [
            sellerId, productId, sku || null, mrp, parsedMerchantPrice, marginPct, sellingPrice, parsedMerchantPrice, quantity, low_stock_threshold
        ]);
        const newOfferId = result.insertId;

        // 5. Save Pincodes
        if (Array.isArray(pincodes) && pincodes.length > 0) {
            const pincodeValues = pincodes.map(p => [newOfferId, p.trim()]);
            await connection.query('INSERT INTO seller_product_pincodes (seller_product_id, pincode) VALUES ?', [pincodeValues]);
        }

        await connection.commit();
        res.status(201).json({
            status: true,
            message: "Merchant product offer listed successfully.",
            offerId: newOfferId,
            merchantPrice: parsedMerchantPrice,
            userDisplayPrice: sellingPrice
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
            SELECT sp.*, p.name as product_name, p.main_image_url, p.is_universal_pincode
            FROM seller_products sp
            JOIN sellers s ON sp.seller_id = s.id
            JOIN products p ON sp.product_id = p.id
            WHERE s.sellerable_id = ? AND s.sellerable_type = 'Merchant'
            ORDER BY sp.created_at DESC
        `;
        const [rows] = await db.query(query, [merchantId]);
        res.status(200).json({ status: true, data: rows });
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
            SELECT DISTINCT o.id as order_id, o.order_number, o.order_status, o.total_amount, o.created_at,
                   oi.product_name, oi.quantity, oi.price_per_unit, u.full_name as customer_name, IFNULL(u.mobile_number, '') as customer_phone

            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            JOIN seller_products sp ON oi.seller_product_id = sp.id
            JOIN sellers s ON sp.seller_id = s.id
            JOIN users u ON o.user_id = u.id
            WHERE s.sellerable_id = ? AND s.sellerable_type = 'Merchant'
            ORDER BY o.created_at DESC
        `;
        const [rows] = await db.query(query, [merchantId]);
        res.status(200).json({ status: true, data: rows });
    } catch (error) {
        console.error("Error fetching merchant orders:", error);
        res.status(500).json({ status: false, message: 'An error occurred.' });
    }
};