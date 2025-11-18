// Controllers/hsnCodeController.js

const db = require('../../db'); // Adjust path to your db connection
const HsnCode = require('../Models/hsnCodeModel'); // <-- The corrected, necessary import

// Create a new HSN code
exports.createHsnCode = async (req, res) => {
    try {
        const { hsnCode, description, gstPercentage } = req.body;
        if (!hsnCode || gstPercentage === undefined) {
            return res.status(400).json({ status: false, message: "HSN code and GST percentage are required." });
        }

        const query = `INSERT INTO hsn_codes (hsn_code, description, gst_percentage) VALUES (?, ?, ?)`;
        const [result] = await db.query(query, [hsnCode, description, gstPercentage]);
        const newHsnId = result.insertId;

        // Fetch the newly created record to get all data, including timestamps
        const [rows] = await db.query('SELECT * FROM hsn_codes WHERE id = ?', [newHsnId]);

        // Use the HsnCode model to format the response
        res.status(201).json({ status: true, message: "HSN code created successfully.", data: new HsnCode(rows[0]) });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: false, message: `HSN code '${hsnCode}' already exists.` });
        }
        console.error("Error creating HSN code:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};

// NEW: Advanced function to get HSN codes with server-side controls
exports.getAllHsnCodes = async (req, res) => {
    try {
        // --- 1. Extract query parameters with defaults ---
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const search = req.query.search || '';
        const sortBy = req.query.sortBy || 'created_at'; // Default sort column
        const sortOrder = req.query.sortOrder || 'DESC'; // Default sort order

        console.log("search-->",search)

        const offset = (page - 1) * limit;
        const searchPattern = `%${search}%`;

        // --- 2. Build the query for fetching the data ---
        let dataQuery = `
            SELECT * FROM hsn_codes 
            WHERE hsn_code LIKE ? OR description LIKE ?
            ORDER BY ?? ${sortOrder === 'ASC' ? 'ASC' : 'DESC'}
            LIMIT ?
            OFFSET ?;
        `;
        // The `??` is for column names to prevent SQL injection
        const [rows] = await db.query(dataQuery, [searchPattern, searchPattern, sortBy, limit, offset]);
        const hsnCodes = rows.map(row => new HsnCode(row));

        // --- 3. Build the query for getting the total count of filtered records ---
        let countQuery = `
            SELECT COUNT(*) as total FROM hsn_codes 
            WHERE hsn_code LIKE ? OR description LIKE ?;
        `;
        const [countRows] = await db.query(countQuery, [searchPattern, searchPattern]);
        const totalRecords = countRows[0].total;

        // --- 4. Send the response with data and pagination info ---
        res.status(200).json({
            status: true,
            data: hsnCodes,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(totalRecords / limit),
                totalRecords: totalRecords,
                limit: limit
            }
        });

    } catch (error) {
        console.error("Error fetching HSN codes:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};

// Update an HSN code
exports.updateHsnCode = async (req, res) => {
    try {
        const { id } = req.params;
        // Corrected the parameter name from `isActive` to match the model and common practice
        const { description, gstPercentage, is_active } = req.body;

        const fields = [];
        const values = [];
        if (description !== undefined) { fields.push('description = ?'); values.push(description); }
        if (gstPercentage !== undefined) { fields.push('gst_percentage = ?'); values.push(gstPercentage); }
        if (is_active !== undefined) { fields.push('is_active = ?'); values.push(is_active); }

        if (fields.length === 0) {
            return res.status(400).json({ status: false, message: "No fields to update." });
        }

        const query = `UPDATE hsn_codes SET ${fields.join(', ')} WHERE id = ?`;
        values.push(id);

        await db.query(query, values);

        // Fetch the updated record to return the fresh data
        const [rows] = await db.query('SELECT * FROM hsn_codes WHERE id = ?', [id]);

        // Ensure to check if the row exists before creating a new HsnCode instance
        if (rows.length === 0) {
            return res.status(404).json({ status: false, message: "HSN code not found." });
        }

        res.status(200).json({ status: true, message: "HSN code updated successfully.", data: new HsnCode(rows[0]) });

    } catch (error) {
        console.error("Error updating HSN code:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};