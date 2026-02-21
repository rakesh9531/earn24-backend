const db = require('../../db');
const { getRelativeUrl, deleteFile } = require('../utils/fileHelper');

exports.getLandingPage = async (req, res) => {
    try {
        const [content] = await db.query('SELECT * FROM web_landing_content WHERE id = 1');
        const [gallery] = await db.query('SELECT id, image_url FROM web_landing_gallery ORDER BY id DESC');
        
        res.status(200).json({
            status: true,
            data: {
                details: content[0] || {},
                gallery: gallery || []
            }
        });
    } catch (error) {
        console.error("Get Landing Page Error:", error);
        res.status(500).json({ status: false, message: "Internal server error" });
    }
};

exports.updateLandingPage = async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const { app_name, page_title, page_description, download_link, delete_gallery_ids } = req.body;
        const files = req.files || {};

        // 1. Handle Main Image (Hero Banner)
        let mainImageUrl = null;
        if (files['main_image'] && files['main_image'][0]) {
            const [current] = await connection.query('SELECT main_image_url FROM web_landing_content WHERE id = 1');
            if (current[0] && current[0].main_image_url) {
                deleteFile(current[0].main_image_url);
            }
            mainImageUrl = getRelativeUrl(files['main_image'][0]);
        }

        // 2. Update Content Fields
        let updateFields = ["app_name = ?", "page_title = ?", "page_description = ?", "download_link = ?"];
        let queryParams = [app_name, page_title, page_description, download_link];

        if (mainImageUrl) {
            updateFields.push("main_image_url = ?");
            queryParams.push(mainImageUrl);
        }

        const updateQuery = `UPDATE web_landing_content SET ${updateFields.join(', ')} WHERE id = 1`;
        await connection.query(updateQuery, queryParams);

        // 3. Handle Gallery Deletions (Safe JSON parsing)
        if (delete_gallery_ids) {
            try {
                const ids = typeof delete_gallery_ids === 'string' ? JSON.parse(delete_gallery_ids) : delete_gallery_ids;
                if (Array.isArray(ids) && ids.length > 0) {
                    const [images] = await connection.query('SELECT image_url FROM web_landing_gallery WHERE id IN (?)', [ids]);
                    images.forEach(img => deleteFile(img.image_url));
                    await connection.query('DELETE FROM web_landing_gallery WHERE id IN (?)', [ids]);
                }
            } catch (e) {
                console.error("Gallery deletion parse error:", e);
                // Non-critical error, we continue with the rest of the update
            }
        }

        // 4. Handle New Gallery Uploads
        if (files['gallery_images'] && files['gallery_images'].length > 0) {
            const galleryRecords = files['gallery_images'].map(file => [getRelativeUrl(file)]);
            // Bulk insert for better performance
            await connection.query('INSERT INTO web_landing_gallery (image_url) VALUES ?', [galleryRecords]);
        }

        await connection.commit();
        res.status(200).json({ status: true, message: "Landing page updated successfully" });

    } catch (error) {
        await connection.rollback();
        console.error("Critical Update Error:", error);
        res.status(500).json({ status: false, message: "Server error", error: error.message });
    } finally {
        connection.release();
    }
};