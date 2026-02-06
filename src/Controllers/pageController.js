const db = require('../../db');

/**
 * PUBLIC API: Get page content
 * Used by Mobile App and Delivery Web
 */
exports.getPageContent = async (req, res) => {
    const { key } = req.query; // e.g., ?key=privacy_policy
    const { app } = req.query; // e.g., &app=USER_APP or AGENT_APP

    if (!key || !app) {
        return res.status(400).json({ status: false, message: "Page key and Target App are required." });
    }

    try {
        // We only return the page if the target_app matches the requesting app or is 'BOTH'
        const query = `
            SELECT title, content, updated_at 
            FROM app_pages 
            WHERE page_key = ? AND (target_app = ? OR target_app = 'BOTH')
        `;
        const [rows] = await db.query(query, [key, app]);

        if (rows.length === 0) {
            return res.status(404).json({ status: false, message: "Page not available for this application." });
        }

        res.status(200).json({ status: true, data: rows[0] });
    } catch (e) {
        res.status(500).json({ status: false, message: e.message });
    }
};

/**
 * ADMIN API: Get all pages for management
 */
exports.getAllPages = async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM app_pages ORDER BY title ASC");
        res.json({ status: true, data: rows });
    } catch (e) {
        res.status(500).json({ status: false, message: e.message });
    }
};

// /**
//  * ADMIN API: Update page content
//  */
// exports.updatePageContent = async (req, res) => {
//     const { key, title, content, target_app } = req.body;

//     if (!key || !title || !content || !target_app) {
//         return res.status(400).json({ status: false, message: "All fields are required." });
//     }

//     try {
//         const query = "UPDATE app_pages SET title = ?, content = ?, target_app = ? WHERE page_key = ?";
//         const [result] = await db.query(query, [title, content, target_app, key]);

//         if (result.affectedRows === 0) {
//             return res.status(404).json({ status: false, message: "Page not found." });
//         }

//         res.json({ status: true, message: "App page updated successfully!" });
//     } catch (e) {
//         res.status(500).json({ status: false, message: e.message });
//     }
// };






/**
 * ADMIN API: Dynamic Update Page Content
 * Allows updating one or more fields based on the provided keys in body.
 */
exports.updatePageContent = async (req, res) => {
    const { key, title, content, target_app } = req.body;

    // 1. Validation: The 'key' is mandatory to find the record
    if (!key) {
        return res.status(400).json({ status: false, message: "Page key is required for updating." });
    }

    // 2. Dynamic Query Building
    const fieldsToUpdate = [];
    const queryValues = [];

    if (title !== undefined) {
        fieldsToUpdate.push("title = ?");
        queryValues.push(title);
    }

    if (content !== undefined) {
        fieldsToUpdate.push("content = ?");
        queryValues.push(content);
    }

    if (target_app !== undefined) {
        fieldsToUpdate.push("target_app = ?");
        queryValues.push(target_app);
    }

    // 3. Safety Check: If no actual fields were sent to update
    if (fieldsToUpdate.length === 0) {
        return res.status(400).json({ status: false, message: "No fields provided to update." });
    }

    // 4. Finalize Query
    // We add the 'key' at the end of the values array for the WHERE clause
    queryValues.push(key);
    const sqlQuery = `UPDATE app_pages SET ${fieldsToUpdate.join(", ")} WHERE page_key = ?`;

    try {
        const [result] = await db.query(sqlQuery, queryValues);

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: false, message: "Document not found." });
        }

        res.status(200).json({ 
            status: true, 
            message: "App page updated successfully!" 
        });
    } catch (e) {
        console.error("Dynamic Update Error:", e);
        res.status(500).json({ status: false, message: "Internal server error." });
    }
};