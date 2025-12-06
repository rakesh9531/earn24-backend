// // Controllers/productController.js
// const db = require('../../db');
// const Product = require('../Models/productModel');
// const slugify = require('../utils/slugify');
// const path = require('path');

// // Helper to delete files safely
// const deleteFile = (filePath) => {
//     if (!filePath) return;
//     const fullPath = path.join(process.cwd(), filePath.startsWith('/') ? filePath.substring(1) : filePath);
//     if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
// };

// // Admin adds a new product type to the master catalog
// exports.createMasterProduct = async (req, res) => {
//     // This route should be protected for Admins only
//   try {
//     const {
//       name, categoryId, subcategoryId, brandId, hsnCodeId, description,
//     } = req.body;

//     const mainImage = req.files?.main_image?.[0];
//     const galleryImages = req.files?.gallery_images || [];

//     if (!name || !categoryId || !brandId || !hsnCodeId || !mainImage) {
//         // Clean up any uploaded files if validation fails
//         if(mainImage) deleteFile(mainImage.path);
//         galleryImages.forEach(file => deleteFile(file.path));
//         return res.status(400).json({ status: false, message: 'Name, Category, Brand, HSN, and a Main Image are required.' });
//     }

//     const slug = slugify(name, { lower: true, strict: true });

//     // Check if a product with the same slug already exists
//     const [existing] = await db.query('SELECT id FROM products WHERE slug = ? AND is_deleted = FALSE', [slug]);
//     if (existing.length > 0) {
//         if(mainImage) deleteFile(mainImage.path);
//         galleryImages.forEach(file => deleteFile(file.path));
//         return res.status(409).json({ status: false, message: 'A product with this name already exists.' });
//     }

//     const mainImageUrl = '/' + path.relative(process.cwd(), mainImage.path).replace(/\\/g, '/');
//     const galleryImageUrls = galleryImages.map(file => '/' + path.relative(process.cwd(), file.path).replace(/\\/g, '/'));

//     // Admin-added products are pre-approved and active
//     const query = `INSERT INTO products (name, slug, category_id, subcategory_id, brand_id, hsn_code_id, description, main_image_url, gallery_image_urls, is_approved, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
//     const [result] = await db.query(query, [name, slug, categoryId, subcategoryId, brandId, hsnCodeId, description, mainImageUrl, JSON.stringify(galleryImageUrls), true, true]);

//     res.status(201).json({ status: true, message: "Master product created successfully", productId: result.insertId });

//   } catch (error) {
//     console.error("Error creating master product:", error);
//     res.status(500).json({ status: false, message: "An error occurred." });
//   }
// };

// // // Admin gets a list of all master products (for linking to sellers)
// // exports.getAllMasterProducts = async (req, res) => {
// //   // We will add full pagination and search here
// //   try {
// //     const page = parseInt(req.query.page, 10) || 1;
// //     const limit = parseInt(req.query.limit, 10) || 10;
// //     const search = req.query.search || '';
// //     const offset = (page - 1) * limit;
// //     const searchPattern = `%${search}%`;

// //     const dataQuery = `
// //         SELECT p.id, p.name, b.name as brand_name, c.name as category_name, p.is_approved, p.is_active
// //         FROM products p
// //         LEFT JOIN brands b ON p.brand_id = b.id
// //         LEFT JOIN product_categories c ON p.category_id = c.id
// //         WHERE p.is_deleted = FALSE AND (p.name LIKE ? OR b.name LIKE ?)
// //         ORDER BY p.created_at DESC
// //         LIMIT ? OFFSET ?
// //     `;
// //     const [rows] = await db.query(dataQuery, [searchPattern, searchPattern, limit, offset]);

// //     const countQuery = `
// //         SELECT COUNT(*) as total FROM products p
// //         LEFT JOIN brands b ON p.brand_id = b.id
// //         WHERE p.is_deleted = FALSE AND (p.name LIKE ? OR b.name LIKE ?)
// //     `;
// //     const [countRows] = await db.query(countQuery, [searchPattern, searchPattern]);
// //     const totalRecords = countRows[0].total;

// //     res.status(200).json({ 
// //         status: true, 
// //         data: rows,
// //         pagination: {
// //             currentPage: page,
// //             totalPages: Math.ceil(totalRecords / limit),
// //             totalRecords
// //         }
// //     });
// //   } catch (error) {
// //     console.error("Error fetching master products:", error);
// //     res.status(500).json({ status: false, message: "An error occurred." });
// //   }
// // };


// // Get all master products with search, pagination, and GST percentage
// exports.getAllMasterProducts = async (req, res) => {
//   try {
//     const page = parseInt(req.query.page, 10) || 1;
//     const limit = parseInt(req.query.limit, 10) || 10;
//     const search = req.query.search || '';
//     const offset = (page - 1) * limit;
//     const searchPattern = `%${search}%`;

//     // The query now joins with hsn_codes to get the gst_percentage
//     const dataQuery = `
//         SELECT 
//             p.id, 
//             p.name, 
//             b.name as brand_name, 
//             c.name as category_name, 
//             p.is_approved, 
//             p.is_active,
//             h.gst_percentage
//         FROM products p
//         LEFT JOIN brands b ON p.brand_id = b.id
//         LEFT JOIN product_categories c ON p.category_id = c.id
//         LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
//         WHERE 
//             p.is_deleted = FALSE 
//             AND p.is_active = TRUE 
//             AND p.is_approved = TRUE
//             AND (p.name LIKE ? OR b.name LIKE ?)
//         ORDER BY p.created_at DESC
//         LIMIT ? OFFSET ?
//     `;
//     const [rows] = await db.query(dataQuery, [searchPattern, searchPattern, limit, offset]);

//     const countQuery = `
//         SELECT COUNT(*) as total 
//         FROM products p
//         LEFT JOIN brands b ON p.brand_id = b.id
//         WHERE 
//             p.is_deleted = FALSE 
//             AND p.is_active = TRUE 
//             AND p.is_approved = TRUE
//             AND (p.name LIKE ? OR b.name LIKE ?)
//     `;
//     const [countRows] = await db.query(countQuery, [searchPattern, searchPattern]);
//     const totalRecords = countRows[0].total;

//     res.status(200).json({ 
//         status: true, 
//         data: rows,
//         pagination: {
//             currentPage: page,
//             totalPages: Math.ceil(totalRecords / limit),
//             totalRecords: totalRecords,
//             limit: limit
//         }
//     });
//   } catch (error) {
//     console.error("Error fetching master products:", error);
//     res.status(500).json({ status: false, message: "An error occurred." });
//   }
// };








const db = require('../../db');
const Product = require('../Models/productModel');
const slugify = require('../utils/slugify');
const path = require('path');
const fs = require('fs');

// Helper function to safely delete files
const deleteFile = (filePath) => {
    if (!filePath) return;
    const fullPath = path.join(process.cwd(), filePath.startsWith('/') ? filePath.substring(1) : filePath);
    if (fs.existsSync(fullPath)) {
        fs.unlink(fullPath, (err) => {
            if (err) console.error("Error deleting file:", fullPath, err);
        });
    }
};

// Admin adds a new product type to the master catalog--- Old before server
// exports.createMasterProduct = async (req, res) => {
//     try {
//         const {
//             name, categoryId, subcategoryId, brandId, hsnCodeId, description, attributeValueIds
//         } = req.body;

//         const mainImage = req.files?.main_image?.[0];
//         const galleryImages = req.files?.gallery_images || [];

//         if (!name || !categoryId || !brandId || !hsnCodeId || !mainImage) {
//             if (mainImage) deleteFile(mainImage.path);
//             galleryImages.forEach(file => deleteFile(file.path));
//             return res.status(400).json({ status: false, message: 'Name, Category, Brand, HSN, and a Main Image are required.' });
//         }

//         const slug = slugify(name, { lower: true, strict: true });

//         const [existing] = await db.query('SELECT id FROM products WHERE slug = ? AND is_deleted = FALSE', [slug]);
//         if (existing.length > 0) {
//             if (mainImage) deleteFile(mainImage.path);
//             galleryImages.forEach(file => deleteFile(file.path));
//             return res.status(409).json({ status: false, message: 'A product with this name already exists.' });
//         }

//         // --- THIS IS YOUR CORRECTED URL LOGIC ---
//         const getRelativeUrl = (file) => {
//             const fullPath = file.path;
//             const uploadsIndex = fullPath.indexOf('uploads');
//             if (uploadsIndex === -1) return null; // Should not happen with correct setup
//             return '/' + fullPath.substring(uploadsIndex).replace(/\\/g, '/');
//         };

//         const mainImageUrl = getRelativeUrl(mainImage);
//         const galleryImageUrls = galleryImages.map(file => getRelativeUrl(file));
//         // --- END OF CORRECTION ---

//         const connection = await db.getConnection();
//         try {
//             await connection.beginTransaction();

//             const productQuery = `INSERT INTO products (name, slug, category_id, subcategory_id, brand_id, hsn_code_id, description, main_image_url, gallery_image_urls, is_approved, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
//             const [result] = await connection.query(productQuery, [name, slug, categoryId, subcategoryId, brandId, hsnCodeId, description, mainImageUrl, JSON.stringify(galleryImageUrls), true, true]);
//             const newProductId = result.insertId;

//             // If attributeValueIds are provided, link them to the new product
//             if (attributeValueIds && attributeValueIds.length > 0) {
//                 // Ensure it's an array, as FormData can send a single value as a string
//                 const ids = Array.isArray(attributeValueIds) ? attributeValueIds : [attributeValueIds];

//                 const productAttributeQuery = `INSERT INTO product_attributes (product_id, attribute_value_id) VALUES ?`;
//                 const productAttributeValues = ids.map(valueId => [newProductId, valueId]);
//                 await connection.query(productAttributeQuery, [productAttributeValues]);
//             }

//             await connection.commit();
//             res.status(201).json({ status: true, message: "Master product created successfully", productId: newProductId });

//         } catch (error) {
//             await connection.rollback();
//             // Rethrow the error to be caught by the outer catch block
//             throw error;
//         } finally {
//             if (connection) connection.release();
//         }

//     } catch (error) {
//         // This outer catch will now handle errors from the transaction block as well
//         // and clean up any uploaded files.
//         if (req.files?.main_image?.[0]) deleteFile(req.files.main_image[0].path);
//         (req.files?.gallery_images || []).forEach(file => deleteFile(file.path));

//         console.error("Error creating master product:", error);
//         res.status(500).json({ status: false, message: "An error occurred during product creation." });
//     }
// };




// Admin adds a new product type to the master catalog
exports.createMasterProduct = async (req, res) => {
    try {
        const {
            name, categoryId, subcategoryId, brandId, hsnCodeId, description, attributeValueIds
        } = req.body;

        const mainImage = req.files?.main_image?.[0];
        const galleryImages = req.files?.gallery_images || [];

        // 1. Basic Validation
        if (!name || !categoryId || !brandId || !hsnCodeId || !mainImage) {
            if (mainImage) deleteFile(mainImage.path);
            galleryImages.forEach(file => deleteFile(file.path));
            return res.status(400).json({ status: false, message: 'Name, Category, Brand, HSN, and a Main Image are required.' });
        }

        const slug = slugify(name, { lower: true, strict: true });

        // 2. Check for Duplicates
        const [existing] = await db.query('SELECT id FROM products WHERE slug = ? AND is_deleted = FALSE', [slug]);
        if (existing.length > 0) {
            if (mainImage) deleteFile(mainImage.path);
            galleryImages.forEach(file => deleteFile(file.path));
            return res.status(409).json({ status: false, message: 'A product with this name already exists.' });
        }

        // 3. Helper to format Image URLs
        const getRelativeUrl = (file) => {
            const fullPath = file.path;
            const uploadsIndex = fullPath.indexOf('uploads');
            if (uploadsIndex === -1) return null;
            return '/' + fullPath.substring(uploadsIndex).replace(/\\/g, '/');
        };

        const mainImageUrl = getRelativeUrl(mainImage);
        const galleryImageUrls = galleryImages.map(file => getRelativeUrl(file));

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            // 4. Insert Product
            const productQuery = `INSERT INTO products (name, slug, category_id, subcategory_id, brand_id, hsn_code_id, description, main_image_url, gallery_image_urls, is_approved, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            const [result] = await connection.query(productQuery, [name, slug, categoryId, subcategoryId, brandId, hsnCodeId, description, mainImageUrl, JSON.stringify(galleryImageUrls), true, true]);
            const newProductId = result.insertId;

            // 5. Handle Attributes (CORRECTED LOGIC)
            if (attributeValueIds) {
                let ids = attributeValueIds;

                // FIX: FormData often sends arrays as JSON strings (e.g., '["6"]') or single strings (e.g., "6")
                if (typeof ids === 'string') {
                    try {
                        // Check if it looks like a JSON array
                        if (ids.trim().startsWith('[')) {
                            ids = JSON.parse(ids);
                        } else {
                            // It's a single value string
                            ids = [ids];
                        }
                    } catch (e) {
                        // Fallback: If parse fails, treat as single value
                        ids = [ids];
                    }
                } else if (!Array.isArray(ids)) {
                    // It's a single number/value, wrap in array
                    ids = [ids];
                }

                // Sanitize: Filter out empty values
                ids = ids.filter(val => val !== null && val !== '' && val !== undefined);

                if (ids.length > 0) {
                    const productAttributeQuery = `INSERT INTO product_attributes (product_id, attribute_value_id) VALUES ?`;
                    
                    // Map to [[productId, valueId], [productId, valueId]]
                    const productAttributeValues = ids.map(valueId => {
                        // Extra safety: If valueId is still an array (e.g. [[6]]), grab the first element
                        const finalId = Array.isArray(valueId) ? valueId[0] : valueId;
                        return [newProductId, finalId];
                    });

                    await connection.query(productAttributeQuery, [productAttributeValues]);
                }
            }

            await connection.commit();
            res.status(201).json({ status: true, message: "Master product created successfully", productId: newProductId });

        } catch (error) {
            await connection.rollback();
            throw error; // Re-throw to be caught by outer catch
        } finally {
            if (connection) connection.release();
        }

    } catch (error) {
        // Cleanup files on error
        if (req.files?.main_image?.[0]) deleteFile(req.files.main_image[0].path);
        (req.files?.gallery_images || []).forEach(file => deleteFile(file.path));

        console.error("Error creating master product:", error);
        res.status(500).json({ status: false, message: "An error occurred during product creation.", error: error.message });
    }
};




// === THIS IS THE FINAL, COMPLETE, AND CORRECT VERSION OF THIS FUNCTION === local code perfect working 
// exports.getAllMasterProducts = async (req, res) => {
//   try {
//     const page = parseInt(req.query.page, 10) || 1;
//     const limit = parseInt(req.query.limit, 10) || 10;
//     const search = req.query.search || '';
//     const offset = (page - 1) * limit;
//     const searchPattern = `%${search}%`;

//     // --- THIS IS THE CORRECTED DATA QUERY ---
//     // It now correctly selects ALL required fields: main_image_url, description, and the aggregated attributes.
//     const dataQuery = `
//       SELECT 
//           p.id, 
//           p.name, 
//           p.description,
//           p.main_image_url,
//           b.name as brand_name, 
//           h.gst_percentage,
//           c.name as category_name,
//           sc.name as subcategory_name,
//           p.is_active,
//           -- This aggregates all attributes for the product into a single JSON array string
//           (
//             SELECT CONCAT('[', GROUP_CONCAT(
//               JSON_OBJECT(
//                 'attribute_name', attr.name, 
//                 'value', av.value
//               )
//             ), ']') 
//             FROM product_attributes pa
//             JOIN attribute_values av ON pa.attribute_value_id = av.id
//             JOIN attributes attr ON av.attribute_id = a.id
//             WHERE pa.product_id = p.id
//           ) as attributes,
//           -- This creates the user-friendly display name for dropdowns
//           CONCAT(
//               p.name,
//               ' (Brand: ', b.name, ')',
//               IFNULL(
//                   (SELECT CONCAT(' (', GROUP_CONCAT(av.value SEPARATOR ', '), ')')
//                    FROM product_attributes pa
//                    JOIN attribute_values av ON pa.attribute_value_id = av.id
//                    WHERE pa.product_id = p.id
//                   ),
//                   ''
//               )
//           ) as display_name
//       FROM products p
//       LEFT JOIN brands b ON p.brand_id = b.id
//       LEFT JOIN product_categories c ON p.category_id = c.id
//       LEFT JOIN product_subcategories sc ON p.subcategory_id = sc.id
//       LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
//       LEFT JOIN attributes a ON TRUE -- This is a trick to make the alias 'a' available in the subquery
//       WHERE 
//           p.is_deleted = FALSE 
//           AND p.is_approved = TRUE
//           AND (p.name LIKE ? OR b.name LIKE ?)
//       GROUP BY p.id -- Grouping is essential for the GROUP_CONCAT to work correctly
//       ORDER BY p.created_at DESC
//       LIMIT ? OFFSET ?
//     `;
//     const [rows] = await db.query(dataQuery, [searchPattern, searchPattern, limit, offset]);
    
//     // Parse the attributes string back into a JSON object for each product
//     const dataWithParsedAttributes = rows.map(product => ({
//         ...product,
//         // The attributes field is a string from the DB, so we parse it.
//         // If it's null or invalid JSON, default to an empty array.
//         attributes: product.attributes ? JSON.parse(product.attributes) : []
//     }));

//     const countQuery = `
//         SELECT COUNT(*) as total 
//         FROM products p
//         LEFT JOIN brands b ON p.brand_id = b.id
//         WHERE 
//             p.is_deleted = FALSE 
//             AND p.is_approved = TRUE
//             AND (p.name LIKE ? OR b.name LIKE ?)
//     `;
//     const [countRows] = await db.query(countQuery, [searchPattern, searchPattern]);
//     const totalRecords = countRows[0].total;

//     res.status(200).json({ 
//         status: true, 
//         data: dataWithParsedAttributes, // Send the parsed data
//         pagination: {
//             currentPage: page,
//             totalPages: Math.ceil(totalRecords / limit),
//             totalRecords: totalRecords,
//             limit: limit
//         }
//     });
//   } catch (error) {
//     console.error("Error fetching master products:", error);
//     res.status(500).json({ status: false, message: "An error occurred." });
//   }
// };


// === THIS IS THE FIXED, PRODUCTION-READY VERSION ===
exports.getAllMasterProducts = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const search = req.query.search || '';
    const offset = (page - 1) * limit;
    const searchPattern = `%${search}%`;

    // --- FIX: REMOVED THE INVALID 'LEFT JOIN attributes a' ---
    // --- FIX: UPDATED THE SUBQUERY TO JOIN ATTRIBUTES INTERNALLY ---
    const dataQuery = `
      SELECT 
          p.id, 
          p.name, 
          p.description,
          p.main_image_url,
          b.name as brand_name, 
          h.gst_percentage,
          c.name as category_name,
          sc.name as subcategory_name,
          p.is_active,
          
          -- Subquery for JSON Attributes
          (
            SELECT CONCAT('[', GROUP_CONCAT(
              JSON_OBJECT(
                'attribute_name', attr.name, 
                'value', av.value
              )
            ), ']') 
            FROM product_attributes pa
            JOIN attribute_values av ON pa.attribute_value_id = av.id
            JOIN attributes attr ON av.attribute_id = attr.id -- ✅ Fixed: Join directly to attr.id, not a.id
            WHERE pa.product_id = p.id
          ) as attributes,

          -- Subquery for Display Name
          CONCAT(
              p.name,
              ' (Brand: ', b.name, ')',
              IFNULL(
                  (SELECT CONCAT(' (', GROUP_CONCAT(av.value SEPARATOR ', '), ')')
                   FROM product_attributes pa
                   JOIN attribute_values av ON pa.attribute_value_id = av.id
                   WHERE pa.product_id = p.id
                  ),
                  ''
              )
          ) as display_name

      FROM products p
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN product_categories c ON p.category_id = c.id
      LEFT JOIN product_subcategories sc ON p.subcategory_id = sc.id
      LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
      
      -- ❌ REMOVED: LEFT JOIN attributes a ON TRUE (This caused the error)

      WHERE 
          p.is_deleted = FALSE 
          AND p.is_approved = TRUE
          AND (p.name LIKE ? OR b.name LIKE ?)
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const [rows] = await db.query(dataQuery, [searchPattern, searchPattern, limit, offset]);
    
    const dataWithParsedAttributes = rows.map(product => ({
        ...product,
        attributes: product.attributes ? JSON.parse(product.attributes) : []
    }));

    const countQuery = `
        SELECT COUNT(*) as total 
        FROM products p
        LEFT JOIN brands b ON p.brand_id = b.id
        WHERE 
            p.is_deleted = FALSE 
            AND p.is_approved = TRUE
            AND (p.name LIKE ? OR b.name LIKE ?)
    `;
    const [countRows] = await db.query(countQuery, [searchPattern, searchPattern]);
    const totalRecords = countRows[0].total;

    res.status(200).json({ 
        status: true, 
        data: dataWithParsedAttributes,
        pagination: {
            currentPage: page,
            totalPages: Math.ceil(totalRecords / limit),
            totalRecords: totalRecords,
            limit: limit
        }
    });
  } catch (error) {
    console.error("Error fetching master products:", error);
    res.status(500).json({ status: false, message: "An error occurred." });
  }
};


// Helper to get a web-accessible relative URL from multer's absolute path
const getRelativeUrl = (file) => {
    if (!file) return null;
    const fullPath = file.path;
    const uploadsIndex = fullPath.indexOf('uploads');
    if (uploadsIndex === -1) return null;
    return '/' + fullPath.substring(uploadsIndex).replace(/\\/g, '/');
};


/**
 * Updates an existing master product, including its main image and gallery images.
 * New gallery images are APPENDED to the existing gallery.
 */
// exports.updateMasterProduct = async (req, res) => {
//     // Access both main and gallery images from req.files
//     const newMainImage = req.files?.main_image?.[0];
//     const newGalleryImages = req.files?.gallery_images || [];

//     try {
//         const { id } = req.params;
//         const { name, description, brand_id, category_id, hsn_code_id, is_active } = req.body;

//         // Step 1: Fetch the existing product to get old image URLs for deletion/appending.
//         // --- CRUCIAL: Fetch gallery_image_urls as well ---
//         const [existingRows] = await db.query('SELECT id, main_image_url, gallery_image_urls FROM products WHERE id = ?', [id]);
//         if (existingRows.length === 0) {
//             // If product not found, delete any uploaded files
//             if (newMainImage) deleteFile(newMainImage.path);
//             newGalleryImages.forEach(file => deleteFile(file.path));
//             return res.status(404).json({ status: false, message: "Product not found." });
//         }
//         const existingProduct = existingRows[0];

//         const fields = [];
//         const values = [];

//         // Step 2: Handle main image update (same as before)
//         if (newMainImage) {
//             const newImageUrl = getRelativeUrl(newMainImage);
//             fields.push('main_image_url = ?');
//             values.push(newImageUrl);
//             if (existingProduct.main_image_url) {
//                 deleteFile(existingProduct.main_image_url);
//             }
//         }

//         // --- Step 2.5: Handle Gallery Image Update ---
//         if (newGalleryImages.length > 0) {
//             // a) Get the URLs of the newly uploaded gallery images
//             const newGalleryUrls = newGalleryImages.map(getRelativeUrl);

//             // b) Get the existing gallery URLs, parsing the JSON string from the DB
//             let existingGalleryUrls = [];
//             if (existingProduct.gallery_image_urls) {
//                 try {
//                     // It's stored as a JSON string, so we must parse it
//                     existingGalleryUrls = JSON.parse(existingProduct.gallery_image_urls);
//                 } catch (e) {
//                     console.error("Could not parse existing gallery URLs, starting fresh.", e);
//                     existingGalleryUrls = [];
//                 }
//             }

//             // c) Combine old and new URLs
//             const combinedGalleryUrls = [...existingGalleryUrls, ...newGalleryUrls];

//             // d) Add the stringified array to the fields to be updated
//             fields.push('gallery_image_urls = ?');
//             values.push(JSON.stringify(combinedGalleryUrls));
//         }


//         // Step 3: Handle text field updates (same as before)
//         if (name !== undefined) {
//             fields.push('name = ?');
//             values.push(name);
//             const slug = slugify(name, { lower: true, strict: true });
//             fields.push('slug = ?');
//             values.push(slug);
//         }
//         if (description !== undefined) { fields.push('description = ?'); values.push(description); }
//         if (brand_id !== undefined) { fields.push('brand_id = ?'); values.push(brand_id); }
//         if (category_id !== undefined) { fields.push('category_id = ?'); values.push(category_id); }
//         if (hsn_code_id !== undefined) { fields.push('hsn_code_id = ?'); values.push(hsn_code_id); }
//         if (is_active !== undefined) { fields.push('is_active = ?'); values.push(is_active === true || is_active === 'true' ? 1 : 0); }

//         // Step 4: Check if there's anything to update.
//         if (fields.length === 0) {
//             return res.status(400).json({ status: false, message: "No fields provided to update." });
//         }

//         // Step 5: Construct and execute the final UPDATE query.
//         const query = `UPDATE products SET ${fields.join(', ')} WHERE id = ?`;
//         values.push(id);

//         await db.query(query, values);

//         res.status(200).json({ status: true, message: "Product updated successfully." });

//     } catch (error) {
//         // --- Step 6: Extended Error Cleanup ---
//         // If any error occurs, delete ALL newly uploaded files to prevent orphans.
//         if (newMainImage) {
//             deleteFile(newMainImage.path);
//         }
//         if (newGalleryImages.length > 0) {
//             newGalleryImages.forEach(file => deleteFile(file.path));
//         }

//         if (error.code === 'ER_DUP_ENTRY') {
//             return res.status(409).json({ status: false, message: "A product with this name or slug already exists." });
//         }
//         console.error("Error updating master product:", error);
//         res.status(500).json({ status: false, message: "An error occurred." });
//     }
// };






// --- NEW: `updateMasterProduct` function ---
exports.updateMasterProduct = async (req, res) => {
    const { id } = req.params;
    const { name, description, categoryId, subcategoryId, brandId, hsnCodeId, attributeValueIds } = req.body;
    const newMainImage = req.files?.main_image?.[0];
    const newGalleryImages = req.files?.gallery_images || [];

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [existingRows] = await db.query('SELECT main_image_url, gallery_image_urls FROM products WHERE id = ?', [id]);
        if (existingRows.length === 0) {
            await connection.rollback();
            if (newMainImage) deleteFile(newMainImage.path);
            newGalleryImages.forEach(file => deleteFile(file.path));
            return res.status(404).json({ status: false, message: "Product not found." });
        }
        const existingProduct = existingRows[0];

        // --- Update Logic ---
        const fields = [];
        const values = [];

        // Handle text fields and slug
        if (name) {
            fields.push('name = ?', 'slug = ?');
            values.push(name, slugify(name, { lower: true, strict: true }));
        }
        if (description !== undefined) { fields.push('description = ?'); values.push(description); }
        if (categoryId) { fields.push('category_id = ?'); values.push(categoryId); }
        if (subcategoryId !== undefined) { fields.push('subcategory_id = ?'); values.push(subcategoryId || null); }
        if (brandId) { fields.push('brand_id = ?'); values.push(brandId); }
        if (hsnCodeId) { fields.push('hsn_code_id = ?'); values.push(hsnCodeId); }

        // Handle main image update
        if (newMainImage) {
            fields.push('main_image_url = ?');
            values.push(getRelativeUrl(newMainImage));
            deleteFile(existingProduct.main_image_url);
        }

        // Handle gallery update (replace entire gallery)
        if (newGalleryImages.length > 0) {
            const existingGalleryUrls = JSON.parse(existingProduct.gallery_image_urls || '[]');
            existingGalleryUrls.forEach(deleteFile);
            const newGalleryUrls = newGalleryImages.map(getRelativeUrl);
            fields.push('gallery_image_urls = ?');
            values.push(JSON.stringify(newGalleryUrls));
        }

        // --- Attribute Update (Delete and Re-insert) ---
        await connection.query('DELETE FROM product_attributes WHERE product_id = ?', [id]);
        const parsedAttributeIds = attributeValueIds ? JSON.parse(attributeValueIds) : [];
        if (parsedAttributeIds.length > 0) {
            const productAttributeQuery = `INSERT INTO product_attributes (product_id, attribute_value_id) VALUES ?`;
            const productAttributeValues = parsedAttributeIds.map(valueId => [id, valueId]);
            await connection.query(productAttributeQuery, [productAttributeValues]);
        }

        // --- Finalize Update Query ---
        if (fields.length > 0) {
            const query = `UPDATE products SET ${fields.join(', ')} WHERE id = ?`;
            values.push(id);
            await connection.query(query, values);
        }

        await connection.commit();
        res.status(200).json({ status: true, message: "Product updated successfully." });

    } catch (error) {
        await connection.rollback();
        // Clean up any newly uploaded files if the transaction fails
        if (newMainImage) deleteFile(newMainImage.path);
        newGalleryImages.forEach(file => deleteFile(file.path));

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: false, message: "A product with this name already exists." });
        }
        console.error("Error updating master product:", error);
        res.status(500).json({ status: false, message: "An error occurred during product update." });
    } finally {
        if (connection) connection.release();
    }
};





// --- Your existing `getAllMasterProducts` function ---
// exports.getAllMasterProducts = async (req, res) => {
//     try {
//         const page = parseInt(req.query.page, 10) || 1;
//         const limit = parseInt(req.query.limit, 10) || 10;
//         const search = req.query.search || '';
//         const offset = (page - 1) * limit;
//         const searchPattern = `%${search}%`;

//         const dataQuery = `
//             SELECT p.id, p.name, p.main_image_url, p.is_active, b.name as brand_name, c.name as category_name, sc.name as subcategory_name
//             FROM products p
//             LEFT JOIN brands b ON p.brand_id = b.id
//             LEFT JOIN product_categories c ON p.category_id = c.id
//             LEFT JOIN product_subcategories sc ON p.subcategory_id = sc.id
//             WHERE p.is_deleted = FALSE AND (p.name LIKE ? OR b.name LIKE ?)
//             ORDER BY p.created_at DESC
//             LIMIT ? OFFSET ?
//         `;
//         const [rows] = await db.query(dataQuery, [searchPattern, searchPattern, limit, offset]);

//         const countQuery = `SELECT COUNT(*) as total FROM products p LEFT JOIN brands b ON p.brand_id = b.id WHERE p.is_deleted = FALSE AND (p.name LIKE ? OR b.name LIKE ?)`;
//         const [countRows] = await db.query(countQuery, [searchPattern, searchPattern]);
//         const totalRecords = countRows[0].total;

//         res.status(200).json({
//             status: true,
//             data: rows,
//             pagination: {
//                 currentPage: page, totalPages: Math.ceil(totalRecords / limit), totalRecords: totalRecords, limit: limit
//             }
//         });
//     } catch (error) {
//         console.error("Error fetching master products:", error);
//         res.status(500).json({ status: false, message: "An error occurred." });
//     }
// };

// --- NEW: `getMasterProductById` function ---
exports.getMasterProductById = async (req, res) => {
    const { id } = req.params;
    try {
        // Fetch main product details
        const productSql = `
            SELECT p.*, b.name as brand_name, c.name as category_name, sc.name as subcategory_name
            FROM products p
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN product_categories c ON p.category_id = c.id
            LEFT JOIN product_subcategories sc ON p.subcategory_id = sc.id
            WHERE p.id = ? AND p.is_deleted = FALSE
        `;
        const [productRows] = await db.query(productSql, [id]);

        if (productRows.length === 0) {
            return res.status(404).json({ status: false, message: "Product not found." });
        }
        const product = productRows[0];

        // Parse gallery URLs string into a proper array
        product.gallery_image_urls = JSON.parse(product.gallery_image_urls || '[]');

        // Fetch associated attributes for the product
        const attributesSql = `
            SELECT pa.attribute_value_id, a.name as attribute_name
            FROM product_attributes pa
            JOIN attribute_values av ON pa.attribute_value_id = av.id
            JOIN attributes a ON av.attribute_id = a.id
            WHERE pa.product_id = ?
        `;
        const [attributes] = await db.query(attributesSql, [id]);
        product.attributes = attributes;

        res.status(200).json({ status: true, data: product });
    } catch (error) {
        console.error("Error fetching product details:", error);
        res.status(500).json({ status: false, message: "Failed to fetch product details." });
    }
};




exports.getTrendingSearches = async (req, res) => {
    try {
        // --- THIS IS THE FIX ---
        // We are now ordering by the category's ID in descending order, which is a
        // good way to show the newest categories as "trending".
        // If you have a 'display_order' column, that would be even better to use.
        const [trending] = await db.query(
            `SELECT name FROM product_categories WHERE is_active = TRUE AND is_deleted = FALSE ORDER BY id DESC LIMIT 8`
        );
        
        // This part remains the same
        const trendingTerms = trending.map(t => t.name);

        res.status(200).json({ status: true, data: trendingTerms });
    } catch (error) {
        console.error("Error fetching trending searches:", error);
        res.status(500).json({ status: false, message: "Could not fetch trending searches." });
    }
};





// ==========================================================
// === THE NEW, PRODUCTION-READY SEARCH FUNCTION          ===
// ==========================================================
exports.searchProducts = async (req, res) => {
    try {

        console.log("call hua ree search")

        // --- 1. Get all possible parameters from the frontend ---
        const { query, categoryId, brandId, sortBy, page = 1, limit = 20 } = req.query;
        const pincode = req.query.pincode; // Assume pincode might also be a filter

        if (!query && !categoryId && !brandId) {
            return res.status(400).json({ status: false, message: "A search query or filter is required." });
        }

        // --- 2. Dynamically build the SQL query ---
        let whereClauses = ['sp.is_active = TRUE'];
        let queryParams = [];

        // Handle the text search query
        if (query) {
            const searchTerms = query.split(' ').filter(term => term); // Split by space and remove empty strings
            const searchConditions = searchTerms.map(term => {
                queryParams.push(`%${term}%`, `%${term}%`, `%${term}%`);
                return "(p.name LIKE ? OR p.description LIKE ? OR b.name LIKE ?)";
            }).join(' AND ');
            whereClauses.push(`(${searchConditions})`);
        }

        // Handle filters
        if (categoryId) {
            whereClauses.push('p.category_id = ?');
            queryParams.push(categoryId);
        }
        if (brandId) {
            whereClauses.push('p.brand_id = ?');
            queryParams.push(brandId);
        }
        if (pincode) {
            // Ensure we only show products available in the user's pincode
            whereClauses.push('spp.id IS NOT NULL');
        }
        
        const whereString = `WHERE ${whereClauses.join(' AND ')}`;

        // --- 3. Handle Sorting ---
        let orderByClause = 'ORDER BY p.popularity DESC'; // Default sort
        switch (sortBy) {
            case 'price_asc':
                orderByClause = 'ORDER BY sp.selling_price ASC';
                break;
            case 'price_desc':
                orderByClause = 'ORDER BY sp.selling_price DESC';
                break;
            // Add more cases for 'rating', 'discount', etc. if needed
        }

        // --- 4. Handle Pagination ---
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const offset = (pageNum - 1) * limitNum;

        // --- 5. Create the FINAL queries ---
        const baseSelectAndJoins = `
            FROM seller_products sp
            JOIN products p ON sp.product_id = p.id
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
            ${pincode ? `JOIN seller_product_pincodes spp ON sp.id = spp.seller_product_id AND spp.pincode = ?` : ''}
        `;
        // Add pincode to params if it exists
        if (pincode) queryParams.unshift(pincode);

        // Query to get the total count for pagination
        const countQuery = `SELECT COUNT(DISTINCT p.id) as total ${baseSelectAndJoins} ${whereString}`;
        const [countRows] = await db.query(countQuery, queryParams);
        const totalProducts = countRows[0].total;

        // Query to get the actual product data
        const dataQuery = `
            SELECT DISTINCT
                p.id as product_id, p.name, p.main_image_url, p.description, p.gallery_image_urls,
                b.name as brand_name, 
                sp.id as offer_id, sp.selling_price, sp.mrp, sp.minimum_order_quantity
            ${baseSelectAndJoins} ${whereString} ${orderByClause} LIMIT ? OFFSET ?
        `;
        const [products] = await db.query(dataQuery, [...queryParams, limitNum, offset]);

        console.log("[products]-->",[products])

        // --- 6. Send the structured response ---
        res.status(200).json({
            status: true,
            data: {
                products,
                pagination: {
                    total: totalProducts,
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(totalProducts / limitNum)
                }
            }
        });

    } catch (error) {
        console.error("Error in searchProducts:", error);
        res.status(500).json({ status: false, message: "An internal server error occurred during search." });
    }
};



exports.getSearchSuggestions = async (req, res) => {
    const { query } = req.query;

    if (!query || query.trim().length < 2) {
        return res.status(200).json({ status: true, data: [] });
    }

    try {
        const searchTerm = query.trim();
        
        // --- THIS IS THE FIX ---
        // We use the LOWER() function on both the column and the search term
        // to ensure the search is always case-insensitive.
        const [suggestions] = await db.query(
            `SELECT DISTINCT name FROM products WHERE LOWER(name) LIKE ? AND is_active = TRUE LIMIT 5`,
            [`%${searchTerm.toLowerCase()}%`] // We also convert the search term to lowercase here
        );
        
        res.status(200).json({ status: true, data: suggestions });
    } catch (error) {
        console.error("Error fetching search suggestions:", error);
        res.status(500).json({ status: false, message: "Could not fetch suggestions." });
    }
};


// --- NEW PUBLIC CONTROLLER FUNCTION for Product Details ---
exports.getProductForUser = async (req, res) => {
    const { id } = req.params;
    const { pincode } = req.query; // Pincode is optional here

    try {
        const query = `
            SELECT 
                p.id as product_id, p.name, p.description, p.main_image_url, p.gallery_image_urls,
                b.name as brand_name,
                sp.id as offer_id, sp.selling_price, sp.mrp, sp.minimum_order_quantity,
                ((sp.selling_price / (1 + (h.gst_percentage / 100))) - sp.purchase_price) * 80 / 100 as bv_earned,
                (
                    SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT('attribute_name', attr.name, 'value', av.value)), ']') 
                    FROM product_attributes pa
                    JOIN attribute_values av ON pa.attribute_value_id = av.id
                    JOIN attributes attr ON av.attribute_id = attr.id
                    WHERE pa.product_id = p.id
                ) as attributes
            FROM products p
            JOIN seller_products sp ON p.id = sp.product_id
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
            WHERE p.id = ? AND sp.is_active = TRUE
            -- We get the best offer (e.g., lowest price) available for this product
            ORDER BY sp.selling_price ASC
            LIMIT 1;
        `;
        
        const [productRows] = await db.query(query, [id]);

        if (productRows.length === 0) {
            return res.status(404).json({ status: false, message: "Product not found or is currently unavailable." });
        }

        const product = productRows[0];
        // Parse JSON string fields into arrays for the frontend
        product.gallery_image_urls = product.gallery_image_urls ? JSON.parse(product.gallery_image_urls) : [];
        product.attributes = product.attributes ? JSON.parse(product.attributes) : [];

        res.status(200).json({ status: true, data: product });

    } catch (error) {
        console.error("Error fetching product for user:", error);
        res.status(500).json({ status: false, message: "An internal server error occurred." });
    }
};



/**
 * @desc   Fetch products by sub-category ID, available at a specific pincode.
 * @route  GET /api/products/by-category/:categoryId
 * @access Public
 */
exports.getProductsByCategory = async (req, res) => {
    try {
        const { categoryId } = req.params;
        const { pincode, page = 1 } = req.query;
        const limit = 20;
        const offset = (page - 1) * limit;

        if (!categoryId || !pincode) {
            return res.status(400).json({ status: false, message: 'Category ID and Pincode are required.' });
        }

        const [settingsRows] = await db.query("SELECT setting_value FROM app_settings WHERE setting_key = 'bv_generation_pct_of_profit'");
        const bvSetting = settingsRows[0];
        const bvGenerationPct = bvSetting ? parseFloat(bvSetting.setting_value) : 80.0;

        const query = `
            SELECT 
                p.id, 
                p.name, 
                p.slug, 
                p.description,
                p.main_image_url,
                sp.selling_price, 
                sp.mrp, 
                sp.minimum_order_quantity,
                ((sp.selling_price / (1 + (h.gst_percentage / 100))) - sp.purchase_price) * (? / 100) as bv_value
            FROM 
                products AS p
            JOIN 
                seller_products AS sp ON p.id = sp.product_id
            JOIN 
                seller_product_pincodes AS spp ON sp.id = spp.seller_product_id
            LEFT JOIN 
                hsn_codes AS h ON p.hsn_code_id = h.id
            WHERE 
                p.subcategory_id = ? 
                AND spp.pincode = ?
                AND p.is_active = 1
                AND p.is_deleted = 0
                AND sp.is_active = 1
                AND sp.selling_price > 0 -- This line is crucial to hide bad data
            LIMIT ?
            OFFSET ?;
        `;

        const [products] = await db.query(query, [bvGenerationPct, categoryId, pincode, limit, offset]);

        res.status(200).json({
            status: true,
            data: products,
        });

    } catch (error) {
        console.error("Error in getProductsByCategory:", error);
        res.status(500).json({ status: false, message: 'Internal server error.' });
    }
};