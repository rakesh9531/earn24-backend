const db = require('../../db');
const Brand = require('../Models/brandModel');
const slugify = require('../utils/slugify');
const fs = require('fs');
const path = require('path');

// --- IMPROVED HELPER FUNCTION ---
const deleteFile = (filePath) => {
    if (!filePath) return;
    // Build the absolute path from the project's root directory for reliability
    // It removes the leading '/' from the database path to ensure path.join works correctly
    const fullPath = path.join(process.cwd(), filePath.startsWith('/') ? filePath.substring(1) : filePath);

    if (fs.existsSync(fullPath)) {
        fs.unlink(fullPath, (err) => {
            if (err) {
                console.error("Error deleting file:", fullPath, err);
            }
        });
    } else {
        console.warn("File to delete not found at path:", fullPath);
    }
};

// Create a new brand with logo upload
exports.createBrand = async (req, res) => {
    try {
        const { name, description, is_active } = req.body;
        if (!name) {
            if (req.file) deleteFile(req.file.path);
            return res.status(400).json({ status: false, message: "Brand name is required." });
        }

        let logoUrl = null;
        if (req.file) {
            // --- THIS IS THE NEW, RELIABLE FIX ---
            // 1. Get the full absolute path of the uploaded file.
            const fullPath = req.file.path;
            // 2. Find the 'uploads' part of the path string.
            const uploadsIndex = fullPath.indexOf('uploads');
            // 3. Slice the string from 'uploads' onwards and format it as a URL.
            logoUrl = '/' + fullPath.substring(uploadsIndex).replace(/\\/g, '/');
            // This reliably creates a URL like: /uploads/brand-logos/logo-123.jpg
            // --- END OF FIX ---
        } else {
            return res.status(400).json({ status: false, message: "Brand logo is required." });
        }

        const slug = slugify(name, { lower: true, strict: true });
        const query = `INSERT INTO brands (name, slug, description, logo_url, is_active) VALUES (?, ?, ?, ?, ?)`;
        const isActive = is_active === 'true' ? 1 : 0;
        
        const [result] = await db.query(query, [name, slug, description, logoUrl, isActive]);
        const newBrandId = result.insertId;

        const [rows] = await db.query('SELECT * FROM brands WHERE id = ?', [newBrandId]);
        res.status(201).json({ status: true, message: "Brand created successfully", data: new Brand(rows[0]) });

    } catch (error) {
        if (req.file) deleteFile(req.file.path);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: false, message: "A brand with this name already exists." });
        }
        console.error("Error creating brand:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};



// Get all brands with server-side controls
exports.getAllBrands = async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const search = req.query.search || '';
        const offset = (page - 1) * limit;
        const searchPattern = `%${search}%`;

        const dataQuery = `SELECT * FROM brands WHERE name LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        const [rows] = await db.query(dataQuery, [searchPattern, limit, offset]);
        const brands = rows.map(row => new Brand(row));

        const countQuery = `SELECT COUNT(*) as total FROM brands WHERE name LIKE ?`;
        const [countRows] = await db.query(countQuery, [searchPattern]);
        const totalRecords = countRows[0].total;

        res.status(200).json({
            status: true,
            data: brands,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(totalRecords / limit),
                totalRecords: totalRecords
            }
        });
    } catch (error) {
        console.error("Error fetching brands:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};

// Update a brand, with optional new logo upload
exports.updateBrand = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, is_active } = req.body;

        const [existingBrand] = await db.query('SELECT logo_url FROM brands WHERE id = ?', [id]);
        if (existingBrand.length === 0) {
            if (req.file) deleteFile(req.file.path);
            return res.status(404).json({ status: false, message: "Brand not found." });
        }
        
        let logoUrl;
        if (req.file) {
            // --- APPLYING THE SAME FIX HERE ---
            const fullPath = req.file.path;
            const uploadsIndex = fullPath.indexOf('uploads');
            logoUrl = '/' + fullPath.substring(uploadsIndex).replace(/\\/g, '/');
            // --- END OF FIX ---
            
            if (existingBrand[0].logo_url) {
                deleteFile(existingBrand[0].logo_url);
            }
        }
        
        let slug;
        if (name) {
            slug = slugify(name, { lower: true, strict: true });
        }

        const fields = [];
        const values = [];
        if (name) { fields.push('name = ?'); values.push(name); }
        if (slug) { fields.push('slug = ?'); values.push(slug); }
        if (description !== undefined) { fields.push('description = ?'); values.push(description); }
        if (logoUrl) { fields.push('logo_url = ?'); values.push(logoUrl); }
        if (is_active !== undefined) { fields.push('is_active = ?'); values.push(is_active === 'true' ? 1 : 0); }

        if (fields.length === 0) {
            return res.status(400).json({ status: false, message: "No fields to update." });
        }

        const query = `UPDATE brands SET ${fields.join(', ')} WHERE id = ?`;
        values.push(id);
        
        await db.query(query, values);
        
        const [rows] = await db.query('SELECT * FROM brands WHERE id = ?', [id]);
        res.status(200).json({ status: true, message: "Brand updated successfully.", data: new Brand(rows[0]) });

    } catch (error) {
        if (req.file) deleteFile(req.file.path);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: false, message: "A brand with this name already exists." });
        }
        console.error("Error updating brand:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};

// Delete a brand
exports.deleteBrand = async (req, res) => {
    try {
        const { id } = req.params;

        // Get the logo path before deleting the record
        const [existingBrand] = await db.query('SELECT logo_url FROM brands WHERE id = ?', [id]);
        if (existingBrand.length === 0) {
            return res.status(404).json({ status: false, message: "Brand not found." });
        }

        const result = await db.query('DELETE FROM brands WHERE id = ?', [id]);

        if (result[0].affectedRows > 0) {
            // If delete was successful, remove the logo file from storage
            if (existingBrand[0].logo_url) {
                deleteFile(existingBrand[0].logo_url);
            }
            res.status(200).json({ status: true, message: "Brand deleted successfully." });
        } else {
            res.status(404).json({ status: false, message: "Brand not found or already deleted." });
        }

    } catch (error) {
        console.error("Error deleting brand:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};