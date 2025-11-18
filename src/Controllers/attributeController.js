// controllers/attributeController.js

const db = require('../../db');
const Attribute = require('../Models/AttributeModel');
const AttributeValue = require('../Models/AttributeValueModel');

// Create a new attribute type
exports.createAttribute = async (req, res) => {
    try {
        const { name, admin_label } = req.body;
        if (!name || !admin_label) {
            return res.status(400).json({ status: false, message: "Name and Admin Label are required." });
        }
        
        const query = `INSERT INTO attributes (name, admin_label) VALUES (?, ?)`;
        const [result] = await db.query(query, [name, admin_label]);
        const newAttributeId = result.insertId;
        const [rows] = await db.query('SELECT * FROM attributes WHERE id = ?', [newAttributeId]);
        
        res.status(201).json({ status: true, message: "Attribute created successfully.", data: new Attribute(rows[0]) });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: false, message: "This attribute name already exists." });
        }
        console.error("Error creating attribute:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};

// Add a value to an existing attribute
exports.addAttributeValue = async (req, res) => {
    try {
        const { attributeId } = req.params;
        const { value } = req.body;
        if (!value) { return res.status(400).json({ status: false, message: "Value is required." }); }

        const query = `INSERT INTO attribute_values (attribute_id, value) VALUES (?, ?)`;
        const [result] = await db.query(query, [attributeId, value]);
        const newValueId = result.insertId;
        const [rows] = await db.query('SELECT * FROM attribute_values WHERE id = ?', [newValueId]);

        res.status(201).json({ status: true, message: "Attribute value added successfully.", data: new AttributeValue(rows[0]) });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: false, message: "This value already exists for this attribute." });
        }
        console.error("Error adding attribute value:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};



// UPDATED: Get all attributes with values, now with search, pagination, and sorting
exports.getAllAttributesWithValues = async (req, res) => {
    try {
        // 1. Extract query parameters with defaults
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const search = req.query.search || '';
        const offset = (page - 1) * limit;
        const searchPattern = `%${search}%`;

        // --- Main Query using a Subquery for correct pagination ---
        // This is the standard way to paginate results before grouping
        const dataQuery = `
            SELECT
                t1.id,
                t1.name,
                t1.admin_label,
                CONCAT('[', 
                    GROUP_CONCAT(
                        IF(av.id IS NULL, 
                           NULL,
                           JSON_OBJECT('id', av.id, 'value', av.value)
                        )
                        ORDER BY av.value
                    ), 
                ']') as \`values\`
            FROM (
                -- This subquery gets the paginated list of parent attributes first
                SELECT * FROM attributes
                WHERE name LIKE ? OR admin_label LIKE ?
                ORDER BY name ASC
                LIMIT ?
                OFFSET ?
            ) AS t1
            LEFT JOIN attribute_values av ON t1.id = av.attribute_id
            GROUP BY t1.id, t1.name, t1.admin_label
            ORDER BY t1.name ASC;
        `;
        
        const [rows] = await db.query(dataQuery, [searchPattern, searchPattern, limit, offset]);

        // Parse the JSON string from GROUP_CONCAT
        const data = rows.map(row => {
            try {
                const parsedValues = JSON.parse(row.values);
                row.values = Array.isArray(parsedValues) && parsedValues[0] !== null ? parsedValues : [];
            } catch (e) {
                row.values = [];
            }
            return new Attribute(row); // Assuming an 'Attribute' model
        });

        // --- Get the total count of records for pagination ---
        const countQuery = `
            SELECT COUNT(*) as total FROM attributes
            WHERE name LIKE ? OR admin_label LIKE ?;
        `;
        const [countRows] = await db.query(countQuery, [searchPattern, searchPattern]);
        const totalRecords = countRows[0].total;

        // --- Send the complete response ---
        res.status(200).json({
            status: true,
            data: data,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(totalRecords / limit),
                totalRecords: totalRecords,
                limit: limit
            }
        });

    } catch (error) {
        console.error("Error fetching attributes with values:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};