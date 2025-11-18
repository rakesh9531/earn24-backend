// File: /Controllers/retailerController.js

const db = require('../../db');
const bcrypt = require('bcrypt');
const moment = require('moment-timezone');
// Optional: const { retailerRegistrationValidator } = require('../Validator/retailerValidator');

/**
 * Handles the registration of a new Retailer.
 * Creates a record in the `retailers` table and a corresponding profile in the `sellers` table.
 * The new account will be 'PENDING' approval by an admin.
 */
exports.registerRetailer = async (req, res) => {
    // Optional: Add Joi or other validation here
    // const { error } = retailerRegistrationValidator(req.body);
    // if (error) { ... }

    const {
        shop_name, owner_name, phone_number, email, password,
        shop_address, pincode
    } = req.body;

    // Basic Validation
    if (!shop_name || !owner_name || !phone_number || !email || !password || !shop_address || !pincode) {
        return res.status(400).json({ status: false, message: 'All required retailer fields must be provided.' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Check if a retailer with this email or phone already exists
        const [existing] = await connection.query(
            'SELECT id FROM retailers WHERE email = ? OR phone_number = ?',
            [email, phone_number]
        );
        if (existing.length > 0) {
            throw new Error('A retailer with this email or phone number already exists.');
        }

        // 2. Hash the password and get current time
        const hashedPassword = await bcrypt.hash(password, 10);
        const now = moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

        // 3. Insert into the `retailers` table
        // The `approval_status` column will default to 'PENDING' based on our schema change.
        const retailerSql = `
            INSERT INTO retailers 
            (shop_name, owner_name, phone_number, email, password, shop_address, pincode, created_at, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const [retailerResult] = await connection.query(retailerSql, [
            shop_name, owner_name, phone_number, email, hashedPassword,
            shop_address, pincode, now, now
        ]);
        const newRetailerId = retailerResult.insertId;

        // 4. Create the corresponding entry in the `sellers` table
        const sellerSql = `
            INSERT INTO sellers (sellerable_id, sellerable_type, display_name, created_at) 
            VALUES (?, ?, ?, ?)
        `;
        // We use 'Retailer' as the type to link back to the retailers table.
        await connection.query(sellerSql, [newRetailerId, 'Retailer', shop_name, now]);

        // 5. Commit the transaction
        await connection.commit();

        res.status(201).json({
            status: true,
            message: 'Retailer registration successful. Your account is pending admin approval.',
            retailerId: newRetailerId
        });

    } catch (error) {
        await connection.rollback();
        console.error("Error registering retailer:", error);
        // Use a 409 Conflict status for duplicate entries
        res.status(409).json({ status: false, message: error.message || 'An error occurred during registration.' });
    } finally {
        if (connection) connection.release();
    }
};

// You can add other retailer-specific controller functions here later, for example:
/*
exports.getRetailerProfile = async (req, res) => {
    // Logic to get the profile of the logged-in retailer
};
*/