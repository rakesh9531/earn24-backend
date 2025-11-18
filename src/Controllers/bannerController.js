// const db = require('../../db');
// const Banner = require('../Models/Banner'); // Assuming Banner model is in Models folder
// const { deleteFile, getRelativeUrl } = require('../utils/fileHelper'); // We'll create this helper

// // Get all banners for the admin panel (with pagination, etc.)
// exports.getAllBanners = async (req, res) => {
//     try {
//         const [rows] = await db.query("SELECT * FROM banners ORDER BY display_order ASC");
//         const banners = rows.map(b => new Banner(b));
//         res.status(200).json({ status: true, data: banners });
//     } catch (error) {
//         console.error("Error fetching banners:", error);
//         res.status(500).json({ status: false, message: "An error occurred." });
//     }
// };

// // Create a new banner
// exports.createBanner = async (req, res) => {
//     try {
//         const { title, link_to, display_order, is_active } = req.body;
//         if (!req.file) {
//             return res.status(400).json({ status: false, message: "Banner image is required." });
//         }
//         if (!title) {
//             deleteFile(req.file.path); // Clean up uploaded file
//             return res.status(400).json({ status: false, message: "Banner title is required." });
//         }

//         const imageUrl = getRelativeUrl(req.file);

//         const query = "INSERT INTO banners (title, image_url, link_to, display_order, is_active) VALUES (?, ?, ?, ?, ?)";
//         const [result] = await db.query(query, [title, imageUrl, link_to || null, display_order || 0, is_active === 'true']);

//         res.status(201).json({ status: true, message: "Banner created successfully.", bannerId: result.insertId });

//     } catch (error) {
//         if (req.file) deleteFile(req.file.path);
//         console.error("Error creating banner:", error);
//         res.status(500).json({ status: false, message: "An error occurred." });
//     }
// };

// // You would also add updateBanner and deleteBanner functions here for the admin panel









// src/Controllers/bannerController.js

const db = require('../../db');
const Banner = require('../Models/Banner'); 
const { deleteFile, getRelativeUrl } = require('../utils/fileHelper'); // Make sure this helper exists and works like your brand controller's version

// Get all banners for the admin panel
exports.getAllBanners = async (req, res) => {
    try {
        // 1. Get query parameters with default values
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const search = req.query.search || '';
        
        // 2. Calculate the offset for the database query
        const offset = (page - 1) * limit;
        const searchPattern = `%${search}%`;

        // 3. Create the query to get the paginated data
        const dataQuery = `
            SELECT * FROM banners 
            WHERE title LIKE ? 
            ORDER BY display_order ASC, created_at DESC 
            LIMIT ? OFFSET ?`;
        const [rows] = await db.query(dataQuery, [searchPattern, limit, offset]);
        const banners = rows.map(b => new Banner(b));

        // 4. Create the query to get the total count of matching records
        const countQuery = `SELECT COUNT(*) as totalRecords FROM banners WHERE title LIKE ?`;
        const [countRows] = await db.query(countQuery, [searchPattern]);
        const totalRecords = countRows[0].totalRecords;

        // 5. Send the response with data and pagination info
        res.status(200).json({
            status: true,
            data: banners,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(totalRecords / limit),
                totalRecords: totalRecords
            }
        });

    } catch (error) {
        console.error("Error fetching banners:", error);
        res.status(500).json({ status: false, message: "An error occurred while fetching banners." });
    }
};

// Create a new banner
exports.createBanner = async (req, res) => {
    try {
        const { title, link_to, display_order, is_active } = req.body;
        
        if (!req.file) {
            return res.status(400).json({ status: false, message: "Banner image is required." });
        }
        if (!title) {
            deleteFile(req.file.path); // Clean up uploaded file
            return res.status(400).json({ status: false, message: "Banner title is required." });
        }

        const imageUrl = getRelativeUrl(req.file);
        const isActive = is_active === 'true' ? 1 : 0;

        const query = "INSERT INTO banners (title, image_url, link_to, display_order, is_active) VALUES (?, ?, ?, ?, ?)";
        const [result] = await db.query(query, [title, imageUrl, link_to || null, display_order || 0, isActive]);
        
        const [rows] = await db.query('SELECT * FROM banners WHERE id = ?', [result.insertId]);
        res.status(201).json({ status: true, message: "Banner created successfully.", data: new Banner(rows[0]) });

    } catch (error) {
        if (req.file) deleteFile(req.file.path);
        console.error("Error creating banner:", error);
        res.status(500).json({ status: false, message: "An error occurred while creating the banner." });
    }
};

// --- NEW: Update a banner ---
exports.updateBanner = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, link_to, display_order, is_active } = req.body;

        const [existingBanner] = await db.query('SELECT image_url FROM banners WHERE id = ?', [id]);
        if (existingBanner.length === 0) {
            if (req.file) deleteFile(req.file.path);
            return res.status(404).json({ status: false, message: "Banner not found." });
        }
        
        let imageUrl;
        if (req.file) {
            imageUrl = getRelativeUrl(req.file);
            // Delete the old image file if it exists
            if (existingBanner[0].image_url) {
                deleteFile(existingBanner[0].image_url);
            }
        }
        
        const fields = [];
        const values = [];
        if (title !== undefined) { fields.push('title = ?'); values.push(title); }
        if (link_to !== undefined) { fields.push('link_to = ?'); values.push(link_to || null); }
        if (display_order !== undefined) { fields.push('display_order = ?'); values.push(display_order || 0); }
        if (imageUrl) { fields.push('image_url = ?'); values.push(imageUrl); }
        if (is_active !== undefined) { fields.push('is_active = ?'); values.push(is_active === 'true' ? 1 : 0); }

        if (fields.length === 0) {
            // If only a file was sent with no other data, it's a valid update
            if (!req.file) {
                 return res.status(400).json({ status: false, message: "No fields to update." });
            }
        }

        const query = `UPDATE banners SET ${fields.join(', ')} WHERE id = ?`;
        values.push(id);
        
        await db.query(query, values);
        
        const [rows] = await db.query('SELECT * FROM banners WHERE id = ?', [id]);
        res.status(200).json({ status: true, message: "Banner updated successfully.", data: new Banner(rows[0]) });

    } catch (error) {
        if (req.file) deleteFile(req.file.path); // Clean up new file on error
        console.error("Error updating banner:", error);
        res.status(500).json({ status: false, message: "An error occurred while updating the banner." });
    }
};

// --- NEW: Toggle banner active status ---
exports.toggleBannerStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { is_active } = req.body;

        if (typeof is_active !== 'boolean') {
            return res.status(400).json({ status: false, message: "is_active must be a boolean." });
        }
        
        const query = `UPDATE banners SET is_active = ? WHERE id = ?`;
        const [result] = await db.query(query, [is_active, id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: false, message: "Banner not found." });
        }

        res.status(200).json({ status: true, message: "Banner status updated successfully." });

    } catch (error) {
        console.error("Error updating banner status:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};


// --- NEW: Delete a banner ---
exports.deleteBanner = async (req, res) => {
    try {
        const { id } = req.params;

        // Get the image path before deleting the record
        const [existingBanner] = await db.query('SELECT image_url FROM banners WHERE id = ?', [id]);
        if (existingBanner.length === 0) {
            return res.status(404).json({ status: false, message: "Banner not found." });
        }

        const [result] = await db.query('DELETE FROM banners WHERE id = ?', [id]);

        if (result.affectedRows > 0) {
            // If delete was successful, remove the image file
            if (existingBanner[0].image_url) {
                deleteFile(existingBanner[0].image_url);
            }
            res.status(200).json({ status: true, message: "Banner deleted successfully." });
        } else {
            res.status(404).json({ status: false, message: "Banner not found or already deleted." });
        }

    } catch (error) {
        console.error("Error deleting banner:", error);
        res.status(500).json({ status: false, message: "An error occurred while deleting the banner." });
    }
};