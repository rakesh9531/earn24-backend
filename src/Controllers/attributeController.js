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



// Get all attributes with values, now with search, pagination, and sorting
exports.getAllAttributesWithValues = async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const search = req.query.search || '';
        const offset = (page - 1) * limit;
        const searchPattern = `%${search}%`;

        // 1. Fetch paginated attributes
        const attrQuery = `
            SELECT * FROM attributes
            WHERE name LIKE ? OR admin_label LIKE ?
            ORDER BY name ASC
            LIMIT ? OFFSET ?;
        `;
        const [attrRows] = await db.query(attrQuery, [searchPattern, searchPattern, limit, offset]);

        if (attrRows.length === 0) {
            return res.status(200).json({
                status: true,
                data: [],
                pagination: {
                    currentPage: page,
                    totalPages: 0,
                    totalRecords: 0,
                    limit: limit
                }
            });
        }

        // 2. Fetch all values for these attributes in a single query
        const attributeIds = attrRows.map(a => a.id);
        const valuesQuery = `
            SELECT id, attribute_id, value 
            FROM attribute_values 
            WHERE attribute_id IN (?)
            ORDER BY value ASC;
        `;
        const [valueRows] = await db.query(valuesQuery, [attributeIds]);

        // 3. Map values back to their attributes
        const data = attrRows.map(row => {
            const values = valueRows
                .filter(v => v.attribute_id === row.id)
                .map(v => ({ id: v.id, value: v.value }));
            
            return new Attribute({
                ...row,
                values: values
            });
        });

        // 4. Get total count
        const countQuery = `
            SELECT COUNT(*) as total FROM attributes
            WHERE name LIKE ? OR admin_label LIKE ?;
        `;
        const [countRows] = await db.query(countQuery, [searchPattern, searchPattern]);
        const totalRecords = countRows[0].total;

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

// Update an existing attribute
exports.updateAttribute = async (req, res) => {
    try {
        const { attributeId } = req.params;
        const { name, admin_label } = req.body;
        
        if (!name || !admin_label) {
            return res.status(400).json({ status: false, message: "Name and Admin Label are required." });
        }
        
        const query = `UPDATE attributes SET name = ?, admin_label = ? WHERE id = ?`;
        const [result] = await db.query(query, [name, admin_label, attributeId]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: false, message: "Attribute not found." });
        }
        
        res.status(200).json({ status: true, message: "Attribute updated successfully." });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: false, message: "This attribute name already exists." });
        }
        console.error("Error updating attribute:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};

// Update an existing attribute value
exports.updateAttributeValue = async (req, res) => {
    try {
        const { valueId } = req.params;
        const { value } = req.body;
        
        if (!value) {
            return res.status(400).json({ status: false, message: "Value is required." });
        }
        
        const query = `UPDATE attribute_values SET value = ? WHERE id = ?`;
        const [result] = await db.query(query, [value, valueId]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: false, message: "Attribute value not found." });
        }
        
        res.status(200).json({ status: true, message: "Attribute value updated successfully." });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: false, message: "This value already exists for this attribute." });
        }
        console.error("Error updating attribute value:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};

// Delete an attribute
exports.deleteAttribute = async (req, res) => {
    try {
        const { attributeId } = req.params;
        const query = `DELETE FROM attributes WHERE id = ?`;
        const [result] = await db.query(query, [attributeId]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: false, message: "Attribute not found." });
        }
        
        res.status(200).json({ status: true, message: "Attribute deleted successfully." });

    } catch (error) {
        console.error("Error deleting attribute:", error);
        res.status(500).json({ status: false, message: "An error occurred. It may be in use." });
    }
};

// Delete an attribute value
exports.deleteAttributeValue = async (req, res) => {
    try {
        const { valueId } = req.params;
        const query = `DELETE FROM attribute_values WHERE id = ?`;
        const [result] = await db.query(query, [valueId]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: false, message: "Attribute value not found." });
        }
        
        res.status(200).json({ status: true, message: "Attribute value deleted successfully." });

    } catch (error) {
        console.error("Error deleting attribute value:", error);
        res.status(500).json({ status: false, message: "An error occurred. It may be in use." });
    }
};