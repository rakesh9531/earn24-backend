const db = require('../../db');
const bcrypt = require('bcrypt');
const moment = require('moment-timezone');
const { createRetailerSchema, updateStatusSchema } = require('../Validator/retailerValidator');

const getISTTime = () => moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

exports.createRetailer = async (req, res) => {
    try {
        const { error, value } = createRetailerSchema.validate(req.body);
        if (error) return res.status(400).json({ status: false, message: error.details[0].message });

        // Destructure camelCase values
        const {
            shopName, ownerName, email, phoneNumber, 
            password, shopAddress, pincode, gstNumber, panNumber, status
        } = value;

        // Map Status
        let dbApproval = status === 'pending' ? 'PENDING' : 'APPROVED';
        let dbActive = status === 'suspended' || status === 'pending' ? 0 : 1;

        // Check Duplicates
        const [existing] = await db.query(
            'SELECT id FROM retailers WHERE (email = ? OR phone_number = ?) AND is_deleted = 0',
            [email, phoneNumber]
        );

        if (existing.length > 0) {
            return res.status(409).json({ status: false, message: 'Retailer with this Email or Phone already exists.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const now = getISTTime();

        // Insert using camelCase variables into snake_case DB columns
        const sql = `
            INSERT INTO retailers 
            (shop_name, owner_name, email, phone_number, password, 
             shop_address, pincode, gst_number, pan_number,
             admin_approval_status, is_active, is_deleted, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        `;

        const [result] = await db.query(sql, [
            shopName, ownerName, email, phoneNumber, hashedPassword,
            shopAddress, pincode, gstNumber, panNumber,
            dbApproval, dbActive, now, now
        ]);

        res.status(201).json({ status: true, message: 'Retailer created successfully.', retailerId: result.insertId });

    } catch (error) {
        console.error('createRetailer error:', error);
        res.status(500).json({ status: false, message: 'Internal server error' });
    }
};

exports.getAllRetailers = async (req, res) => {
    try {
        const { search = '' } = req.query;
        let sql = `SELECT * FROM retailers WHERE is_deleted = 0`;
        const values = [];

        if (search) {
            sql += ` AND (shop_name LIKE ? OR owner_name LIKE ? OR email LIKE ? OR phone_number LIKE ?)`;
            const term = `%${search}%`;
            values.push(term, term, term, term);
        }

        sql += ` ORDER BY created_at DESC`;

        const [rows] = await db.query(sql, values);

        // Map DB snake_case -> API camelCase
        const mappedData = rows.map(r => {
            let frontendStatus = 'pending';
            if (r.admin_approval_status === 'APPROVED' && r.is_active === 1) frontendStatus = 'active';
            else if (r.admin_approval_status === 'APPROVED' && r.is_active === 0) frontendStatus = 'suspended';
            else if (r.admin_approval_status === 'REJECTED') frontendStatus = 'rejected';

            return {
                _id: r.id,          // Mapped to _id for Angular consistency
                shopName: r.shop_name,
                fullName: r.owner_name,
                email: r.email,
                phoneNumber: r.phone_number,
                address: r.shop_address,
                pincode: r.pincode,
                gstNumber: r.gst_number || 'N/A',
                status: frontendStatus,
                createdAt: r.created_at
            };
        });

        res.status(200).json(mappedData);

    } catch (error) {
        console.error('getAllRetailers error:', error);
        res.status(500).json({ status: false, message: 'Internal server error' });
    }
};

// ... updateStatus and deleteRetailer remain the same as previous (they are simple) ...
// Included here for completion
exports.updateStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { error, value } = updateStatusSchema.validate(req.body);
        if (error) return res.status(400).json({ status: false, message: error.details[0].message });

        const { status } = value;
        let dbActive = status === 'active' ? 1 : 0;
        let dbApproval = status === 'pending' ? 'PENDING' : 'APPROVED';

        const now = getISTTime();
        await db.query(
            `UPDATE retailers SET is_active = ?, admin_approval_status = ?, updated_at = ? WHERE id = ? AND is_deleted = 0`,
            [dbActive, dbApproval, now, id]
        );
        res.status(200).json({ status: true, message: `Status updated to ${status}` });
    } catch (error) { res.status(500).json({ status: false, message: 'Error' }); }
};

exports.deleteRetailer = async (req, res) => {
    try {
        const { id } = req.params;
        const now = getISTTime();
        await db.query(`UPDATE retailers SET is_deleted = 1, updated_at = ? WHERE id = ?`, [now, id]);
        res.status(200).json({ status: true, message: 'Retailer deleted successfully.' });
    } catch (error) { res.status(500).json({ status: false, message: 'Error' }); }
};