
const db = require('../../db'); // Assuming you have a database connection module
const Admin = require('../Models/adminModel'); // Import the Admin model
const bcrypt = require('bcrypt'); // For hashing passwords
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { createAdminSchema } = require('../Validator/adminValidation');
const Category = require('../Models/categoryModel');
const { createCategorySchema } = require('../Validator/categoryValidator');
const moment = require('moment-timezone');
const slugify = require('../utils/slugify')
const fs = require('fs');
const path = require('path');


exports.createAdmin = async (req, res) => {
    try {
        // 1. Joi Validation
        const { error, value } = createAdminSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                status: false,
                message: error.details[0].message
            });
        }

        const {
            full_name,
            username,
            email,
            phone_number,
            password,
            role,
            status = 'active',
            admin_pic = null
        } = value;

        // 2. Check if email or username already exists
        const [existing] = await db.query(
            'SELECT * FROM admins WHERE email = ? OR username = ?',
            [email, username]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                status: false,
                message: "Admin with this email or username already exists."
            });
        }

        // 3. Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // 4. Get IST datetime
        const now = moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

        // 5. Insert into database
        const [result] = await db.query(
            `INSERT INTO admins 
      (full_name, username, email, phone_number, password, role, status, admin_pic, is_online, is_deleted, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
            [full_name, username, email, phone_number, hashedPassword, role, status, admin_pic, now, now]
        );

        // 6. Build response using Admin class
        const newAdmin = new Admin({
            id: result.insertId,
            full_name,
            username,
            password: hashedPassword,
            email,
            phone_number,
            role,
            status,
            admin_pic,
            is_online: 0,
            is_deleted: 0,
            created_at: now,
            updated_at: now
        });

        // 7. Send response
        return res.status(201).json({
            status: true,
            message: 'Admin created successfully',
            admin: newAdmin
        });

    } catch (err) {
        console.error('Error in createAdmin:', err);
        return res.status(500).json({
            status: false,
            message: 'Internal Server Error',
            error: err.message
        });
    }
};



exports.adminLogin = async (req, res) => {
    try {

        const { emailOrPhone, password } = req.body;

        console.log("req.body-->", req.body)

        // Validate request body
        if (!emailOrPhone || !password) {
            return res.status(400).json({
                status: false,
                message: "Email/Phone and password are required."
            });
        }

        // Check if admin exists in the database
        const [admin] = await db.query(
            'SELECT * FROM admins WHERE (email = ? OR phone_number = ?) AND is_deleted = false',
            [emailOrPhone, emailOrPhone]
        );

        if (admin.length === 0) {
            return res.status(404).json({
                status: false,
                message: "Admin not found."
            });
        }

        const adminData = admin[0];

        // Check if the password matches
        const isPasswordValid = await bcrypt.compare(password, adminData.password);
        if (!isPasswordValid) {
            return res.status(401).json({
                status: false,
                message: "Invalid credentials."
            });
        }

        const token = jwt.sign(
            { id: adminData.id, role: adminData.role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
        );


        res.status(200).json({
            status: true,
            message: "Login successful.",
            token,
            data: {
                id: adminData.id,
                firstName: adminData.firstName,
                lastName: adminData.lastName,
                email: adminData.email,
                phoneNumber: adminData.phoneNumber,
                role: adminData.role,
                admin_pic: adminData.admin_pic,
            }
        });
    } catch (error) {
        console.error('Error in adminLogin:', error);
        res.status(500).json({
            status: false,
            error: error.message,
            message: "Internal server error"
        });
    }
};



// This is working code before mlm 

// exports.getAllUserList = async (req, res) => {
//     try {
//         let { page = 1, limit = 10, search = '' } = req.body;
//         page = parseInt(page);
//         limit = parseInt(limit);
//         const offset = (page - 1) * limit;
//         const searchTerm = `%${search}%`;

//         const [countRows] = await db.query(
//             `SELECT COUNT(*) AS total FROM users 
//        WHERE is_deleted = 0 AND (
//          full_name LIKE ? OR 
//          username LIKE ? OR 
//          email LIKE ? OR 
//          mobile_number LIKE ?
//        )`,
//             [searchTerm, searchTerm, searchTerm, searchTerm]
//         );

//         const total = countRows[0].total;

//         const [userRows] = await db.query(
//             `SELECT * FROM users 
//        WHERE is_deleted = 0 AND (
//          full_name LIKE ? OR 
//          username LIKE ? OR 
//          email LIKE ? OR 
//          mobile_number LIKE ?
//        ) 
//        ORDER BY created_at DESC
//        LIMIT ? OFFSET ?`,
//             [searchTerm, searchTerm, searchTerm, searchTerm, limit, offset]
//         );

//         res.status(200).json({
//             status: true,
//             message: "User list fetched successfully",
//             data: userRows, // return raw MySQL rows
//             pagination: {
//                 total,
//                 page,
//                 limit,
//                 totalPages: Math.ceil(total / limit),
//             },
//         });
//     } catch (error) {
//         console.error('Error in getAllUserList:', error);
//         res.status(500).json({
//             status: false,
//             error: error.message,
//             message: "Internal server error"
//         });
//     }
// };


// exports.getAllUserList = async (req, res) => {
//     try {
//         let { page = 1, limit = 10, search = '' } = req.body;
//         page = parseInt(page);
//         limit = parseInt(limit);
//         const offset = (page - 1) * limit;
//         const searchTerm = `%${search}%`;

//         const countQuery = `SELECT COUNT(*) AS total FROM users WHERE is_deleted = 0 AND (full_name LIKE ? OR username LIKE ? OR email LIKE ? OR mobile_number LIKE ?)`;
//         const [countRows] = await db.query(countQuery, [searchTerm, searchTerm, searchTerm, searchTerm]);
//         const total = countRows[0].total;

//         // --- THIS IS THE MODIFIED QUERY ---
//         // We are now selecting the new rank and BV columns
//         const dataQuery = `
//             SELECT 
//                 id, full_name, username, email, mobile_number, is_active, is_blocked, created_at,
//                 sponsor_id,
//                 rank, 
//                 current_monthly_qualified_rank,
//                 aggregate_personal_bv,
//                 last_12_months_repurchase_bv
//             FROM users 
//             WHERE is_deleted = 0 AND (
//                 full_name LIKE ? OR 
//                 username LIKE ? OR 
//                 email LIKE ? OR 
//                 mobile_number LIKE ?
//             ) 
//             ORDER BY created_at DESC
//             LIMIT ? OFFSET ?`;
//         const [userRows] = await db.query(dataQuery, [searchTerm, searchTerm, searchTerm, searchTerm, limit, offset]);

//         res.status(200).json({
//             status: true,
//             message: "User list fetched successfully",
//             data: userRows,
//             pagination: {
//                 total, page, limit,
//                 totalPages: Math.ceil(total / limit),
//             },
//         });
//     } catch (error) {
//         console.error('Error in getAllUserList:', error);
//         res.status(500).json({ status: false, error: error.message, message: "Internal server error" });
//     }
// };


// exports.getAllUserList = async (req, res) => {
//     try {
//         // --- STEP 1: Get all new filter and sort parameters from the request body ---
//         let {
//             page = 1,
//             limit = 10,
//             search = '',
//             sortBy = 'created_at', // Default sort
//             sortOrder = 'desc',   // Default order
//             filterByRank = null,  // New: e.g., 'DIAMOND'
//             minAggregateBV = null // New: e.g., 8000 (to find users close to a target)
//         } = req.body;

//         page = parseInt(page);
//         limit = parseInt(limit);
//         const offset = (page - 1) * limit;
//         const searchTerm = `%${search}%`;

//         // --- STEP 2: Dynamically build the WHERE clause ---
//         let whereConditions = ['is_deleted = 0'];
//         let queryParams = [];

//         // Basic search condition
//         if (search) {
//             whereConditions.push('(full_name LIKE ? OR username LIKE ? OR email LIKE ? OR mobile_number LIKE ?)');
//             queryParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
//         }

//         // New Filter: By Rank
//         if (filterByRank && filterByRank !== 'ALL') {
//             whereConditions.push('rank = ?');
//             queryParams.push(filterByRank);
//         }

//         // New Filter: Minimum Total Personal BV
//         if (minAggregateBV && !isNaN(parseFloat(minAggregateBV))) {
//             whereConditions.push('aggregate_personal_bv >= ?');
//             queryParams.push(parseFloat(minAggregateBV));
//         }

//         const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

//         // --- STEP 3: Build the ORDER BY clause with validation ---
//         // Whitelist allowed columns to prevent SQL injection
//         const allowedSortColumns = ['created_at', 'full_name', 'rank', 'aggregate_personal_bv', 'last_12_months_repurchase_bv'];
//         const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'created_at';
//         const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
//         const orderByClause = `ORDER BY ${safeSortBy} ${safeSortOrder}`;

//         // --- STEP 4: Execute the queries with the new dynamic clauses ---
//         const countQuery = `SELECT COUNT(*) AS total FROM users ${whereClause}`;
//         const [countRows] = await db.query(countQuery, queryParams);
//         const total = countRows[0].total;

//         const dataQuery = `
//             SELECT 
//                 id, full_name, username, email, mobile_number, is_active, is_blocked, created_at,
//                 sponsor_id, rank, current_monthly_qualified_rank,
//                 aggregate_personal_bv, last_12_months_repurchase_bv
//             FROM users 
//             ${whereClause}
//             ${orderByClause}
//             LIMIT ? OFFSET ?`;
//         const [userRows] = await db.query(dataQuery, [...queryParams, limit, offset]);

//         res.status(200).json({
//             status: true,
//             message: "User list fetched successfully",
//             data: userRows,
//             pagination: {
//                 total, page, limit,
//                 totalPages: Math.ceil(total / limit),
//             },
//         });
//     } catch (error) {
//         console.error('Error in getAllUserList:', error);
//         res.status(500).json({ status: false, error: error.message, message: "Internal server error" });
//     }
// };





exports.getAllUserList = async (req, res) => {
    try {
        // --- STEP 1: Get all new filter and sort parameters from the request body ---
        let {
            page = 1,
            limit = 10,
            search = '',
            sortBy = 'created_at',
            sortOrder = 'desc',
            filterByRank = null,
            minAggregateBV = null
        } = req.body;

        page = parseInt(page);
        limit = parseInt(limit);
        const offset = (page - 1) * limit;
        const searchTerm = `%${search}%`;

        // --- STEP 2: Dynamically build the WHERE clause ---
        let whereConditions = ['is_deleted = 0'];
        let queryParams = [];

        if (search) {
            whereConditions.push('(full_name LIKE ? OR username LIKE ? OR email LIKE ? OR mobile_number LIKE ?)');
            queryParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }

        // Fix: Wrap rank in backticks here too just in case
        if (filterByRank && filterByRank !== 'ALL') {
            whereConditions.push('`rank` = ?'); 
            queryParams.push(filterByRank);
        }

        if (minAggregateBV && !isNaN(parseFloat(minAggregateBV))) {
            whereConditions.push('aggregate_personal_bv >= ?');
            queryParams.push(parseFloat(minAggregateBV));
        }

        const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

        // --- STEP 3: Build the ORDER BY clause ---
        const allowedSortColumns = ['created_at', 'full_name', 'rank', 'aggregate_personal_bv', 'last_12_months_repurchase_bv'];
        let safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'created_at';
        
        // Fix: If sorting by rank, wrap it in backticks
        if (safeSortBy === 'rank') {
            safeSortBy = '`rank`';
        }

        const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        const orderByClause = `ORDER BY ${safeSortBy} ${safeSortOrder}`;

        // --- STEP 4: Execute the queries ---
        const countQuery = `SELECT COUNT(*) AS total FROM users ${whereClause}`;
        const [countRows] = await db.query(countQuery, queryParams);
        const total = countRows[0].total;

        // --- THE FIX IS HERE: Added backticks around `rank` ---
        const dataQuery = `
            SELECT 
                id, full_name, username, email, mobile_number, is_active, is_blocked, created_at,
                sponsor_id, \`rank\`, current_monthly_qualified_rank,
                aggregate_personal_bv, last_12_months_repurchase_bv
            FROM users 
            ${whereClause}
            ${orderByClause}
            LIMIT ? OFFSET ?`;
            
        const [userRows] = await db.query(dataQuery, [...queryParams, limit, offset]);

        res.status(200).json({
            status: true,
            message: "User list fetched successfully",
            data: userRows,
            pagination: {
                total, page, limit,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error('Error in getAllUserList:', error);
        res.status(500).json({ status: false, error: error.message, message: "Internal server error" });
    }
};



exports.addCategory = async (req, res) => {
    try {
        const { error, value } = createCategorySchema.validate(req.body);
        if (error) {
            return res.status(400).json({ status: false, message: error.details[0].message });
        }

        const { name, description, is_active = 1 } = value;
        const slug = slugify(name);
        const now = moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

        const imagePath = req.file ? `/uploads/category/${req.file.filename}` : null;

        // Check for existing category
        const [existing] = await db.query(
            'SELECT * FROM product_categories WHERE slug = ? AND is_deleted = 0',
            [slug]
        );

        if (existing.length > 0) {
            return res.status(409).json({ status: false, message: 'Category already exists.' });
        }

        const [result] = await db.query(
            `INSERT INTO product_categories 
        (name, slug, description, image_url, is_active, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, slug, description, imagePath, is_active, 0, now, now]
        );

        const newCategory = new Category({
            id: result.insertId,
            name,
            slug,
            description,
            image_url: imagePath,
            is_active,
            is_deleted: 0,
            created_at: now,
            updated_at: now
        });

        res.status(201).json({
            status: true,
            message: 'Category created successfully.',
            data: newCategory
        });

    } catch (err) {
        console.error('Error in addCategory:', err);
        res.status(500).json({ status: false, message: 'Internal server error', error: err.message });
    }
};

exports.getAllCategories = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            sortBy = 'created_at',
            sortOrder = 'desc',
            is_active,
        } = req.query;

        const offset = (page - 1) * limit;
        const filters = ['is_deleted = 0'];
        const values = [];

        // Add search condition
        if (search) {
            filters.push('(name LIKE ? OR slug LIKE ?)');
            values.push(`%${search}%`, `%${search}%`);
        }

        // Add is_active filter
        if (is_active === '1' || is_active === '0') {
            filters.push('is_active = ?');
            values.push(is_active);
        }

        const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

        // Get total count
        const [countRows] = await db.query(
            `SELECT COUNT(*) as total FROM product_categories ${whereClause}`,
            values
        );
        const total = countRows[0].total;
        const totalPages = Math.ceil(total / limit);

        // Get paginated results
        const [rows] = await db.query(
            `SELECT * FROM product_categories 
       ${whereClause} 
       ORDER BY ${db.escapeId(sortBy)} ${sortOrder.toUpperCase()} 
       LIMIT ? OFFSET ?`,
            [...values, parseInt(limit), parseInt(offset)]
        );

        res.status(200).json({
            status: true,
            message: 'Categories fetched successfully.',
            currentPage: parseInt(page),
            totalPages,
            totalItems: total,
            limit: parseInt(limit),
            data: rows,
        });

    } catch (error) {
        console.error('Error in getAllCategories:', error);
        res.status(500).json({
            status: false,
            message: 'Server error',
            error: error.message,
        });
    }
};


exports.getCategoryById = async (req, res) => {
    try {
        const categoryId = req.params.id;

        // Validate ID
        if (!categoryId || isNaN(categoryId)) {
            return res.status(400).json({
                status: false,
                message: "Invalid category ID"
            });
        }

        // Query database
        const [rows] = await db.query(
            `SELECT id, name, slug, image_url, is_active, created_at, updated_at
       FROM product_categories
       WHERE id = ? AND is_deleted = 0`,
            [categoryId]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                status: false,
                message: "Category not found"
            });
        }

        res.status(200).json({
            status: true,
            message: "Category fetched successfully",
            data: rows[0]
        });

    } catch (error) {
        console.error("getCategoryById error:", error.message);
        res.status(500).json({
            status: false,
            message: "Something went wrong",
            error: error.message
        });
    }
};


exports.updateCategory = async (req, res) => {
    try {
        const categoryId = req.params.id;
        if (!categoryId || isNaN(categoryId)) {
            return res.status(400).json({ status: false, message: 'Invalid category ID' });
        }

        // Use Joi for validation, but make all fields optional for an update
        const { error, value } = createCategorySchema.validate(req.body, { abortEarly: false });
        if (error) {
            // We can ignore 'is required' errors for an update, but not other errors
            const requiredErrors = error.details.filter(d => d.type.includes('required'));
            if (requiredErrors.length !== error.details.length) {
                const otherErrors = error.details.filter(d => !d.type.includes('required'));
                if (otherErrors.length > 0) {
                    return res.status(400).json({ status: false, message: otherErrors[0].message });
                }
            }
        }

        // Check if the category exists
        const [existing] = await db.query('SELECT * FROM product_categories WHERE id = ? AND is_deleted = 0', [categoryId]);
        if (existing.length === 0) {
            return res.status(404).json({ status: false, message: 'Category not found' });
        }

        const { name, description, is_active } = value;
        const fields = [];
        const values = [];

        // If the name is being updated, also update the slug automatically
        if (name) {
            fields.push('name = ?', 'slug = ?');
            values.push(name, slugify(name, { lower: true }));
        }

        // Handle other fields
        if (description !== undefined) {
            fields.push('description = ?');
            values.push(description);
        }

        if (is_active !== undefined) {
            fields.push('is_active = ?');
            values.push(is_active);
        }

        if (req.file) {
            const oldImage = existing[0].image_url;
            if (oldImage) {
                const oldImagePath = path.resolve(__dirname, '../uploads' + oldImage.replace('/uploads', ''));
                fs.access(oldImagePath, fs.constants.F_OK, (err) => {
                    if (!err) {
                        fs.unlink(oldImagePath, (unlinkErr) => {
                            if (unlinkErr) console.error('Failed to delete old image:', unlinkErr.message);
                        });
                    }
                });
            }

            // Add new image
            const newImagePath = `/uploads/category/${req.file.filename}`;
            fields.push('image_url = ?');
            values.push(newImagePath);
        }


        // Ensure there's something to update
        if (fields.length === 0) {
            return res.status(400).json({ status: false, message: 'No fields to update' });
        }

        // Add Asia/Kolkata timezone update timestamp
        const updatedAt = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
        fields.push('updated_at = ?');
        values.push(updatedAt);

        // Construct and execute the final SQL query
        const sql = `UPDATE product_categories SET ${fields.join(', ')} WHERE id = ?`;
        values.push(categoryId);
        await db.query(sql, values);

        res.status(200).json({ status: true, message: 'Category updated successfully' });
    } catch (error) {
        console.error('updateCategory error:', error.message);
        res.status(500).json({ status: false, message: 'Internal server error', error: error.message });
    }
};

exports.deleteCategory = async (req, res) => {
    try {
        const categoryId = req.params.id;

        if (!categoryId || isNaN(categoryId)) {
            return res.status(400).json({
                status: false,
                message: 'Invalid category ID'
            });
        }

        const [existing] = await db.query(
            'SELECT * FROM product_categories WHERE id = ? AND is_deleted = 0',
            [categoryId]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                status: false,
                message: 'Category not found or already deleted'
            });
        }

        const imagePath = existing[0].image_url;

        //  Correct path
        if (imagePath) {
            const fullPath = path.resolve(__dirname, '../uploads' + imagePath.replace('/uploads', ''));
            fs.access(fullPath, fs.constants.F_OK, (err) => {
                if (!err) {
                    fs.unlink(fullPath, (unlinkErr) => {
                        if (unlinkErr) {
                            console.error('Failed to delete image:', unlinkErr.message);
                        }
                    });
                } else {
                    console.warn('Image not found on disk:', fullPath);
                }
            });
        }

        const updatedAt = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

        await db.query(
            'UPDATE product_categories SET is_deleted = 1, updated_at = ? WHERE id = ?',
            [updatedAt, categoryId]
        );

        res.status(200).json({
            status: true,
            message: 'Category deleted successfully (soft delete + image removed)'
        });

    } catch (error) {
        console.error('deleteCategory error:', error.message);
        res.status(500).json({
            status: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};




// in adminController.js

exports.addSubCategory = async (req, res) => {
  try {
    const { category_id, name, description } = req.body;
    let { is_active } = req.body; // Use 'let' so we can modify it

    // --- THIS IS THE FIX ---
    // Standardize the 'is_active' value.
    // It handles "true", "false", 1, 0, '1', '0' and defaults to 1 (active) if undefined.
    if (is_active === 'true' || is_active === '1' || is_active === 1 || is_active === true) {
      is_active = 1;
    } else if (is_active === 'false' || is_active === '0' || is_active === 0 || is_active === false) {
      is_active = 0;
    } else {
      is_active = 1; // Default to active if the value is missing or invalid
    }
    // --- END OF FIX ---

    // Validation
    if (!category_id || !name) {
      return res.status(400).json({ status: false, message: 'category_id and name are required' });
    }

    // Check if parent category exists and not deleted
    const [categoryExists] = await db.query(
      'SELECT * FROM product_categories WHERE id = ? AND is_deleted = 0',
      [category_id]
    );
    if (categoryExists.length === 0) {
      return res.status(404).json({ status: false, message: 'Parent category not found' });
    }

    const slug = slugify(name, { lower: true });
    // IMPORTANT: Make sure you're saving to the correct 'subcategory' folder
    const image_url = req.file ? `/uploads/category/${req.file.filename}` : null;
    const createdAt = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

    // The 'is_deleted' column should be in your table schema, but we ensure it's set here
    const [result] = await db.query(
      `INSERT INTO product_subcategories 
       (category_id, name, slug, description, image_url, is_active, is_deleted, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        category_id,
        name,
        slug,
        description || null,
        image_url,
        is_active, // Use the standardized value
        createdAt,
        createdAt
      ]
    );

    res.status(201).json({
      status: true,
      message: 'Subcategory added successfully',
      subcategoryId: result.insertId
    });
  } catch (error) {
    console.error('addSubCategory error:', error.message);
    res.status(500).json({ status: false, message: 'Internal server error', error: error.message });
  }
};


// GET ALL SubCategories
exports.getAllSubCategories = async (req, res) => {
  try {
    // Standard pagination and search
    let { page = 1, limit = 10, search = '' } = req.query;
    // NEW: Get the categoryId from the query string
    const { categoryId } = req.query;

    page = parseInt(page);
    limit = parseInt(limit);
    const offset = (page - 1) * limit;
    const searchTerm = `%${search}%`;

    // --- Build the WHERE clause dynamically ---
    const whereConditions = ['is_deleted = 0', 'name LIKE ?'];
    const queryParams = [searchTerm];

    if (categoryId) {
      whereConditions.push('category_id = ?');
      queryParams.push(categoryId);
    }
    // --- End of dynamic clause ---

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    const [totalRows] = await db.query(
      `SELECT COUNT(*) as count FROM product_subcategories ${whereClause}`,
      queryParams
    );
    const totalItems = totalRows[0].count;

    // Add pagination params to the end of the array for the final query
    queryParams.push(limit, offset);

    const [rows] = await db.query(
      `SELECT * FROM product_subcategories ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      queryParams
    );

    res.status(200).json({
      status: true,
      message: 'Subcategories fetched successfully',
      data: rows,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalItems / limit),
        totalItems,
        limit
      }
    });
  } catch (error) {
    console.error('getAllSubCategories error:', error.message);
    res.status(500).json({ status: false, message: 'Internal server error', error: error.message });
  }
};

// GET SubCategory by ID
exports.getSubCategoryById = async (req, res) => {
  try {
    const id = req.params.id;

    const [rows] = await db.query(
      'SELECT * FROM product_subcategories WHERE id = ? AND is_deleted = 0',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ status: false, message: 'Subcategory not found' });
    }

    res.status(200).json({ status: true, message: 'Subcategory found', data: rows[0] });
  } catch (error) {
    console.error('getSubCategoryById error:', error.message);
    res.status(500).json({ status: false, message: 'Internal server error', error: error.message });
  }
};

// UPDATE SubCategory
exports.updateSubCategory = async (req, res) => {
  try {
    const id = req.params.id;
    const { name, description, is_active, category_id } = req.body;

    console.log("is_active-->", is_active)

    const [existing] = await db.query(
      'SELECT * FROM product_subcategories WHERE id = ? AND is_deleted = 0',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ status: false, message: 'Subcategory not found' });
    }

    const fields = [];
    const values = [];

    if (name) {
      fields.push('name = ?', 'slug = ?');
      values.push(name, slugify(name, { lower: true }));
    }
    if (description !== undefined) {
      fields.push('description = ?');
      values.push(description);
    }
    if (is_active !== undefined) {
      fields.push('is_active = ?');
      values.push(is_active);
    }
    if (category_id !== undefined) {
      fields.push('category_id = ?');
      values.push(category_id);
    }

    if (req.file) {
      const oldPath = path.join(__dirname, '../../', existing[0].image_url || '');
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);

      const image_url = `/uploads/category/${req.file.filename}`;
      fields.push('image_url = ?');
      values.push(image_url);
    }

    if (fields.length === 0) {
      return res.status(400).json({ status: false, message: 'No fields to update' });
    }

    const updatedAt = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
    fields.push('updated_at = ?');
    values.push(updatedAt);

    values.push(id);
    const sql = `UPDATE product_subcategories SET ${fields.join(', ')} WHERE id = ?`;
    await db.query(sql, values);

    res.status(200).json({ status: true, message: 'Subcategory updated successfully' });
  } catch (error) {
    console.error('updateSubCategory error:', error.message);
    res.status(500).json({ status: false, message: 'Internal server error', error: error.message });
  }
};

// DELETE SubCategory (Soft Delete)
exports.deleteSubCategory = async (req, res) => {
  try {
    const id = req.params.id;

    const [existing] = await db.query(
      'SELECT * FROM product_subcategories WHERE id = ? AND is_deleted = 0',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ status: false, message: 'Subcategory not found' });
    }

    if (existing[0].image_url) {
      const imagePath = path.join(__dirname, '../../', existing[0].image_url);
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    }

    const updatedAt = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
    await db.query(
      'UPDATE product_subcategories SET is_deleted = 1, updated_at = ? WHERE id = ?',
      [updatedAt, id]
    );

    res.status(200).json({ status: true, message: 'Subcategory deleted successfully' });
  } catch (error) {
    console.error('deleteSubCategory error:', error.message);
    res.status(500).json({ status: false, message: 'Internal server error', error: error.message });
  }
};




exports.getAllMerchants = async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const search = req.query.search || '';
        const offset = (page - 1) * limit;
        const searchPattern = `%${search}%`;

        const countQuery = `
            SELECT COUNT(*) as total 
            FROM merchants 
            WHERE business_name LIKE ? OR owner_name LIKE ? OR email LIKE ? OR phone_number LIKE ?
        `;
        const [countRows] = await db.query(countQuery, [searchPattern, searchPattern, searchPattern, searchPattern]);
        const totalRecords = countRows[0].total;

        const dataQuery = `
            SELECT id, business_name, owner_name, email, phone_number, gst_number, approval_status, is_active, created_at 
            FROM merchants 
            WHERE business_name LIKE ? OR owner_name LIKE ? OR email LIKE ? OR phone_number LIKE ?
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `;
        const [merchantRows] = await db.query(dataQuery, [searchPattern, searchPattern, searchPattern, searchPattern, limit, offset]);

        res.status(200).json({
            status: true,
            data: merchantRows,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(totalRecords / limit),
                totalRecords: totalRecords
            }
        });
    } catch (error) {
        console.error("Error fetching merchants:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};


exports.createMerchantByAdmin = async (req, res) => {
    // --- THE FIX: Destructure pincode from the request body ---
    const {
        business_name, owner_name, phone_number, email, password,
        gst_number, pan_number, business_address, pincode
    } = req.body;

    // --- THE FIX: Add pincode to the validation ---
    if (!business_name || !owner_name || !phone_number || !email || !password || !business_address || !pincode) {
        return res.status(400).json({ status: false, message: 'All required fields, including pincode, must be provided.' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [existing] = await connection.query('SELECT id FROM merchants WHERE email = ? OR phone_number = ?', [email, phone_number]);
        if (existing.length > 0) {
            throw new Error('A merchant with this email or phone number already exists.');
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const now = moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

        // --- THE FIX: Add `pincode` to the INSERT query ---
        const merchantSql = `
            INSERT INTO merchants 
            (business_name, owner_name, phone_number, email, password, gst_number, pan_number, business_address, pincode, approval_status, is_active, created_at, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', 1, ?, ?)
        `;
        
        // --- THE FIX: Add `pincode` to the values array in the correct order ---
        const [merchantResult] = await connection.query(merchantSql, [
            business_name, owner_name, phone_number, email, hashedPassword,
            gst_number, pan_number, business_address, pincode, now, now
        ]);
        const newMerchantId = merchantResult.insertId;

        // This part remains correct
        const sellerSql = `INSERT INTO sellers (sellerable_id, sellerable_type, display_name, created_at) VALUES (?, ?, ?, ?)`;
        await connection.query(sellerSql, [newMerchantId, 'Merchant', business_name, now]);

        await connection.commit();
        res.status(201).json({ status: true, message: 'Merchant created and approved successfully.', merchantId: newMerchantId });

    } catch (error) {
        await connection.rollback();
        console.error("Error creating merchant by admin:", error);
        res.status(409).json({ status: false, message: error.message || 'An error occurred.' });
    } finally {
        if (connection) connection.release();
    }
};







/**
 * @desc   Fetch the direct downline (Level 1) for a specific user.
 *         Also checks if each downline member has their own children.
 * @route  GET /api/admin/mlm/tree-node/:userId
 * @access Private/Admin
 */
exports.getDownlineForTreeNode = async (req, res) => {
    try {
        const parentId = req.params.userId;

        // This powerful query does two things in one go:
        // 1. It gets all direct children of the parentId.
        // 2. For each child, it does a subquery to check if THAT child has any children.
        //    This tells the frontend whether to render an "expand" icon.
        const query = `
            SELECT 
                u.id, 
                u.full_name, 
                u.username,
                u.rank,
                u.aggregate_personal_bv,
                u.created_at AS join_date,
                (SELECT COUNT(*) FROM users WHERE sponsor_id = u.id) AS children_count
            FROM 
                users u
            WHERE 
                u.sponsor_id = ?
            ORDER BY 
                u.full_name;
        `;

        const [downline] = await db.query(query, [parentId]);

        res.status(200).json({
            status: true,
            data: downline
        });

    } catch (error) {
        console.error("Error fetching downline tree node:", error);
        res.status(500).json({ status: false, message: "Server error while fetching downline." });
    }
};

/**
 * @desc   Search for users to start a tree view from.
 * @route  GET /api/admin/mlm/search-users?term=...
 * @access Private/Admin
 */
exports.searchUsersForTree = async (req, res) => {
    try {
        const searchTerm = req.query.term;

        if (!searchTerm || searchTerm.length < 2) {
            return res.status(400).json({ status: false, message: "Search term must be at least 2 characters." });
        }

        const query = `
            SELECT 
                id, full_name, username, email, rank 
            FROM users 
            WHERE full_name LIKE ? OR username LIKE ? OR email LIKE ?
            LIMIT 10
        `;
        const searchPattern = `%${searchTerm}%`;

        const [users] = await db.query(query, [searchPattern, searchPattern, searchPattern]);

        res.status(200).json({ status: true, data: users });

    } catch (error) {
        console.error("Error searching users:", error);
        res.status(500).json({ status: false, message: "Server error during user search." });
    }
};


/**
 * @desc   Get a paginated list of all users for the tree view's starting point.
 * @route  GET /api/admin/mlm/list-users?page=1&limit=20&term=...
 * @access Private/Admin
 */
exports.getPaginatedUsers = async (req, res) => {
    try {
        // --- Pagination ---
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 20;
        const offset = (page - 1) * limit;

        // --- Filters & Sorting ---
        const { term, startDate, endDate, sortByReferrals } = req.query;
        
        let whereClauses = [];
        const params = [];

        // 1. Search Term Filter (now includes mobile_number)
        if (term) {
            whereClauses.push('(u.full_name LIKE ? OR u.username LIKE ? OR u.email LIKE ? OR u.mobile_number LIKE ?)');
            const searchPattern = `%${term}%`;
            params.push(searchPattern, searchPattern, searchPattern, searchPattern);
        }

        // 2. Date Range Filter
        if (startDate && endDate) {
            whereClauses.push('DATE(u.created_at) BETWEEN ? AND ?');
            params.push(startDate, endDate);
        }

        // 3. Construct the final WHERE clause
        const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // 4. Sorting Logic
        let orderByClause = 'ORDER BY u.id DESC'; // Default sort
        if (sortByReferrals === 'desc') {
            orderByClause = 'ORDER BY referral_count DESC, u.id DESC';
        } else if (sortByReferrals === 'asc') {
            orderByClause = 'ORDER BY referral_count ASC, u.id DESC';
        }
        
        // --- Main Data Query ---
        // We use a LEFT JOIN with a subquery to count direct referrals efficiently.
        const dataQuery = `
            SELECT 
                u.id, u.full_name, u.username, u.email, u.rank, u.aggregate_personal_bv, u.created_at as join_date,
                COUNT(r.id) as referral_count
            FROM 
                users u
            LEFT JOIN 
                users r ON u.id = r.sponsor_id
            ${whereClause}
            GROUP BY
                u.id
            ${orderByClause}
            LIMIT ? OFFSET ?
        `;

        // --- Total Count Query (for pagination) ---
        // This needs to match the filtering logic of the main query.
        const countQuery = `SELECT COUNT(*) as total FROM users u ${whereClause}`;

        // Execute queries
        const [users] = await db.query(dataQuery, [...params, limit, offset]);
        const [countRows] = await db.query(countQuery, params.slice(0, whereClauses.length * (term ? 4 : 1) + (startDate ? 2 : 0))); // Adjust param count for count query

        res.status(200).json({
            status: true,
            data: users,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(countRows[0].total / limit),
                totalRecords: countRows[0].total,
                limit: limit
            }
        });

    } catch (error) {
        console.error("Error fetching paginated users:", error);
        res.status(500).json({ status: false, message: "Server error." });
    }
};