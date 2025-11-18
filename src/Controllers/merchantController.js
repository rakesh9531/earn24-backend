// File: /Controllers/merchantController.js

const db = require('../../db');
const bcrypt = require('bcrypt');
const moment = require('moment-timezone');
// Optional: const { merchantRegistrationValidator } = require('../Validator/merchantValidator');

/**
 * Handles the registration of a new Merchant.
 * Creates a record in the `merchants` table and a corresponding profile in the `sellers` table.
 * The new account will be 'PENDING' approval by an admin.
 */
exports.registerMerchant = async (req, res) => {
    // --- THE FIX: Destructure pincode from the request body ---
    const {
        business_name, owner_name, phone_number, email, password,
        gst_number, pan_number, business_address, pincode
    } = req.body;

    // --- THE FIX: Add pincode to the validation ---
    if (!business_name || !owner_name || !phone_number || !email || !password || !gst_number || !business_address || !pincode) {
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

        // --- THE FIX: Add `pincode` to the INSERT query and values array ---
        const merchantSql = `
            INSERT INTO merchants 
            (business_name, owner_name, phone_number, email, password, gst_number, pan_number, business_address, pincode, created_at, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const [merchantResult] = await connection.query(merchantSql, [
            business_name, owner_name, phone_number, email, hashedPassword,
            gst_number, pan_number || null, business_address, pincode, now, now
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

// You can add other merchant-specific controller functions here later.
/*
exports.getMerchantProfile = async (req, res) => {
    // Logic to get the profile of the logged-in merchant
};
*/