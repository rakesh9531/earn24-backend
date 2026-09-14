const db = require('../../db');

// Helper to recalculate average rating and total reviews for a product & seller_product
async function recalculateProductRating(productId, sellerProductId = null) {
  try {
    // 1. Calculate overall stats for products
    const [stats] = await db.query(`
      SELECT 
        COUNT(*) as total_count,
        IFNULL(AVG(rating), 0) as average_rating
      FROM product_reviews 
      WHERE product_id = ? AND status = 'APPROVED'
    `, [productId]);

    const totalReviews = stats[0] ? parseInt(stats[0].total_count || 0) : 0;
    const avgRating = stats[0] ? parseFloat(stats[0].average_rating || 0).toFixed(2) : 0.00;

    await db.query(`
      UPDATE products 
      SET avg_rating = ?, total_reviews = ? 
      WHERE id = ?
    `, [avgRating, totalReviews, productId]).catch(() => {});

    // 2. Calculate stats for seller_products if sellerProductId provided or linked
    if (sellerProductId) {
      const [spStats] = await db.query(`
        SELECT 
          COUNT(*) as total_count,
          IFNULL(AVG(rating), 0) as average_rating
        FROM product_reviews 
        WHERE seller_product_id = ? AND status = 'APPROVED'
      `, [sellerProductId]);

      const spTotal = spStats[0] ? parseInt(spStats[0].total_count || 0) : 0;
      const spAvg = spStats[0] ? parseFloat(spStats[0].average_rating || 0).toFixed(2) : 0.00;

      await db.query(`
        UPDATE seller_products 
        SET avg_rating = ?, total_reviews = ? 
        WHERE id = ?
      `, [spAvg, spTotal, sellerProductId]).catch(() => {});
    }
  } catch (err) {
    console.error('[RECALCULATE RATING ERROR]', err);
  }
}

// -----------------------------------------------------------
// 1. POST /api/reviews/add - Customer submits a new review
// -----------------------------------------------------------
exports.postReview = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    if (!userId) {
      return res.status(401).json({ status: false, message: 'Authentication required.' });
    }

    const {
      product_id,
      order_id,
      order_item_id,
      seller_product_id,
      rating,
      review_title,
      review_text
    } = req.body;

    if (!product_id || !rating) {
      return res.status(400).json({ status: false, message: 'Product ID and Rating (1-5 stars) are required.' });
    }

    const numericRating = Math.min(5, Math.max(1, parseFloat(rating) || 5.0));

    // Handle File Uploads (Images & Videos)
    let mediaUrls = [];
    if (req.files && req.files.length > 0) {
      mediaUrls = req.files.map(file => {
        const isVideo = file.mimetype.startsWith('video/');
        const url = `/uploads/reviews/${file.filename}`;
        return { type: isVideo ? 'video' : 'image', url };
      });
    }

    // Check Auto-Publish Setting
    const [[settingRow]] = await db.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'review_auto_approve'`).catch(() => [[null]]);
    const isAutoApprove = !settingRow || settingRow.setting_value === '1';
    const reviewStatus = isAutoApprove ? 'APPROVED' : 'PENDING';

    // Verify if order is delivered (for Verified Purchase badge)
    let isVerifiedPurchase = 0;
    if (order_id) {
      const [[orderRow]] = await db.query(`SELECT status FROM orders WHERE id = ? AND user_id = ?`, [order_id, userId]).catch(() => [[null]]);
      if (orderRow && (orderRow.status === 'DELIVERED' || orderRow.status === 'COMPLETED')) {
        isVerifiedPurchase = 1;
      }
    } else {
      // Check if user bought this product previously
      const [[userOrderRow]] = await db.query(`
        SELECT o.id 
        FROM orders o 
        JOIN order_items oi ON o.id = oi.order_id 
        WHERE o.user_id = ? AND oi.product_id = ? AND o.status IN ('DELIVERED', 'COMPLETED') 
        LIMIT 1
      `, [userId, product_id]).catch(() => [[null]]);
      if (userOrderRow) isVerifiedPurchase = 1;
    }

    // Check if review already exists for this order item or product by user
    let existingReview = null;
    if (order_item_id) {
      [[existingReview]] = await db.query(`SELECT id FROM product_reviews WHERE user_id = ? AND order_item_id = ?`, [userId, order_item_id]).catch(() => [[null]]);
    } else {
      [[existingReview]] = await db.query(`SELECT id FROM product_reviews WHERE user_id = ? AND product_id = ?`, [userId, product_id]).catch(() => [[null]]);
    }

    if (existingReview) {
      // Update existing review
      await db.query(`
        UPDATE product_reviews 
        SET rating = ?, review_title = ?, review_text = ?, media_urls = ?, status = ?, is_verified_purchase = ?, updated_at = NOW()
        WHERE id = ?
      `, [
        numericRating,
        review_title || '',
        review_text || '',
        JSON.stringify(mediaUrls),
        reviewStatus,
        isVerifiedPurchase,
        existingReview.id
      ]);

      await recalculateProductRating(product_id, seller_product_id);

      return res.status(200).json({
        status: true,
        message: isAutoApprove 
          ? 'Review updated & published successfully!' 
          : 'Review updated successfully and submitted for Admin approval.',
        review_id: existingReview.id,
        auto_approved: isAutoApprove
      });
    }

    // Create New Review
    const [result] = await db.query(`
      INSERT INTO product_reviews (
        user_id, product_id, order_id, order_item_id, seller_product_id,
        rating, review_title, review_text, media_urls, status, is_verified_purchase, created_by_admin
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `, [
      userId,
      product_id,
      order_id || null,
      order_item_id || null,
      seller_product_id || null,
      numericRating,
      review_title || '',
      review_text || '',
      JSON.stringify(mediaUrls),
      reviewStatus,
      isVerifiedPurchase
    ]);

    await recalculateProductRating(product_id, seller_product_id);

    res.status(201).json({
      status: true,
      message: isAutoApprove 
        ? 'Review submitted & published successfully!' 
        : 'Review submitted successfully! It will be published after Admin approval.',
      review_id: result.insertId,
      auto_approved: isAutoApprove
    });
  } catch (error) {
    console.error('[POST REVIEW ERROR]', error);
    res.status(500).json({ status: false, message: 'Failed to submit review.', error: error.message });
  }
};

// -----------------------------------------------------------
// 2. PUT /api/reviews/update/:id - Update existing review
// -----------------------------------------------------------
exports.updateReview = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user ? req.user.id : null;
    const { rating, review_title, review_text, existing_media_urls } = req.body;

    const [[review]] = await db.query(`SELECT * FROM product_reviews WHERE id = ?`, [id]);
    if (!review) {
      return res.status(404).json({ status: false, message: 'Review not found.' });
    }

    if (userId && review.user_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ status: false, message: 'Unauthorized to edit this review.' });
    }

    const numericRating = Math.min(5, Math.max(1, parseFloat(rating) || review.rating));

    // Handle existing media URLs plus new file uploads
    let mediaUrls = [];
    if (existing_media_urls) {
      try {
        mediaUrls = typeof existing_media_urls === 'string' ? JSON.parse(existing_media_urls) : existing_media_urls;
      } catch (e) {
        mediaUrls = [];
      }
    } else if (review.media_urls) {
      try {
        mediaUrls = typeof review.media_urls === 'string' ? JSON.parse(review.media_urls) : review.media_urls;
      } catch (e) { mediaUrls = []; }
    }

    if (req.files && req.files.length > 0) {
      const newMedia = req.files.map(file => {
        const isVideo = file.mimetype.startsWith('video/');
        return { type: isVideo ? 'video' : 'image', url: `/uploads/reviews/${file.filename}` };
      });
      mediaUrls = [...mediaUrls, ...newMedia];
    }

    // Check Auto-Approve setting
    const [[settingRow]] = await db.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'review_auto_approve'`).catch(() => [[null]]);
    const isAutoApprove = !settingRow || settingRow.setting_value === '1';
    
    // If admin is editing, keep APPROVED. If user, apply setting.
    const reviewStatus = (req.user && req.user.role === 'admin') ? 'APPROVED' : (isAutoApprove ? 'APPROVED' : 'PENDING');

    await db.query(`
      UPDATE product_reviews 
      SET rating = ?, review_title = ?, review_text = ?, media_urls = ?, status = ?, updated_at = NOW()
      WHERE id = ?
    `, [
      numericRating,
      review_title !== undefined ? review_title : review.review_title,
      review_text !== undefined ? review_text : review.review_text,
      JSON.stringify(mediaUrls),
      reviewStatus,
      id
    ]);

    await recalculateProductRating(review.product_id, review.seller_product_id);

    res.status(200).json({
      status: true,
      message: isAutoApprove || (req.user && req.user.role === 'admin') 
        ? 'Review updated successfully!' 
        : 'Review updated and submitted for Admin re-approval.',
      auto_approved: isAutoApprove
    });
  } catch (error) {
    console.error('[UPDATE REVIEW ERROR]', error);
    res.status(500).json({ status: false, message: 'Failed to update review.', error: error.message });
  }
};

// -----------------------------------------------------------
// 3. DELETE /api/reviews/delete/:id - Delete review
// -----------------------------------------------------------
exports.deleteReview = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user ? req.user.id : null;

    const [[review]] = await db.query(`SELECT * FROM product_reviews WHERE id = ?`, [id]);
    if (!review) {
      return res.status(404).json({ status: false, message: 'Review not found.' });
    }

    if (userId && review.user_id !== userId && (!req.user || req.user.role !== 'admin')) {
      return res.status(403).json({ status: false, message: 'Unauthorized to delete this review.' });
    }

    await db.query(`DELETE FROM product_reviews WHERE id = ?`, [id]);
    await recalculateProductRating(review.product_id, review.seller_product_id);

    res.status(200).json({ status: true, message: 'Review deleted successfully.' });
  } catch (error) {
    console.error('[DELETE REVIEW ERROR]', error);
    res.status(500).json({ status: false, message: 'Failed to delete review.' });
  }
};

// -----------------------------------------------------------
// 4. GET /api/reviews/product/:productId - Public Product Reviews & Ratings
// -----------------------------------------------------------
exports.getProductReviews = async (req, res) => {
  try {
    const { productId } = req.params;
    const currentUserId = req.user ? req.user.id : null;

    // 1. Fetch Summary Stats & Distribution
    const [distRows] = await db.query(`
      SELECT 
        COUNT(*) as total_reviews,
        IFNULL(AVG(rating), 0) as avg_rating,
        SUM(CASE WHEN rating >= 4.5 THEN 1 ELSE 0 END) as star_5,
        SUM(CASE WHEN rating >= 3.5 AND rating < 4.5 THEN 1 ELSE 0 END) as star_4,
        SUM(CASE WHEN rating >= 2.5 AND rating < 3.5 THEN 1 ELSE 0 END) as star_3,
        SUM(CASE WHEN rating >= 1.5 AND rating < 2.5 THEN 1 ELSE 0 END) as star_2,
        SUM(CASE WHEN rating < 1.5 THEN 1 ELSE 0 END) as star_1
      FROM product_reviews 
      WHERE product_id = ? AND status = 'APPROVED'
    `, [productId]);

    const stats = distRows[0] || {};
    const totalReviews = parseInt(stats.total_reviews || 0);
    const avgRating = parseFloat(stats.avg_rating || 0).toFixed(1);

    const breakdown = {
      5: parseInt(stats.star_5 || 0),
      4: parseInt(stats.star_4 || 0),
      3: parseInt(stats.star_3 || 0),
      2: parseInt(stats.star_2 || 0),
      1: parseInt(stats.star_1 || 0)
    };

    const percentages = {
      5: totalReviews > 0 ? Math.round((breakdown[5] / totalReviews) * 100) : 0,
      4: totalReviews > 0 ? Math.round((breakdown[4] / totalReviews) * 100) : 0,
      3: totalReviews > 0 ? Math.round((breakdown[3] / totalReviews) * 100) : 0,
      2: totalReviews > 0 ? Math.round((breakdown[2] / totalReviews) * 100) : 0,
      1: totalReviews > 0 ? Math.round((breakdown[1] / totalReviews) * 100) : 0
    };

    // 2. Fetch Customer Media Gallery (all images & videos uploaded for this product)
    const [mediaRows] = await db.query(`
      SELECT media_urls 
      FROM product_reviews 
      WHERE product_id = ? AND status = 'APPROVED' AND media_urls IS NOT NULL AND JSON_LENGTH(media_urls) > 0
    `, [productId]);

    let customerMedia = [];
    mediaRows.forEach(row => {
      try {
        const list = typeof row.media_urls === 'string' ? JSON.parse(row.media_urls) : row.media_urls;
        if (Array.isArray(list)) {
          customerMedia = customerMedia.concat(list);
        }
      } catch (e) {}
    });

    // 3. Fetch Approved Reviews List with User Details
    const [reviews] = await db.query(`
      SELECT 
        pr.*,
        IF(pr.created_by_admin = 1, IFNULL(pr.admin_user_name, 'Verified Customer'), IFNULL(u.full_name, 'Earn24 Customer')) as user_name,
        IFNULL(u.user_pic, '') as user_avatar
      FROM product_reviews pr
      LEFT JOIN users u ON pr.user_id = u.id
      WHERE pr.product_id = ? AND pr.status = 'APPROVED'
      ORDER BY pr.created_at DESC
    `, [productId]);

    const formattedReviews = reviews.map(r => {
      let parsedMedia = [];
      try {
        parsedMedia = typeof r.media_urls === 'string' ? JSON.parse(r.media_urls) : (r.media_urls || []);
      } catch (e) {}

      return {
        id: r.id,
        user_id: r.user_id,
        user_name: r.user_name,
        user_avatar: r.user_avatar,
        rating: parseFloat(r.rating),
        review_title: r.review_title || '',
        review_text: r.review_text || '',
        media_urls: parsedMedia,
        is_verified_purchase: r.is_verified_purchase === 1,
        created_at: r.created_at,
        is_my_review: currentUserId && r.user_id === currentUserId
      };
    });

    // Check if logged in user has a review for this product (even if PENDING)
    let userReview = null;
    if (currentUserId) {
      const [[myRev]] = await db.query(`SELECT * FROM product_reviews WHERE product_id = ? AND user_id = ? LIMIT 1`, [productId, currentUserId]).catch(() => [[null]]);
      if (myRev) {
        let myMedia = [];
        try { myMedia = typeof myRev.media_urls === 'string' ? JSON.parse(myRev.media_urls) : (myRev.media_urls || []); } catch(e){}
        userReview = {
          ...myRev,
          rating: parseFloat(myRev.rating),
          media_urls: myMedia
        };
      }
    }

    res.status(200).json({
      status: true,
      data: {
        avg_rating: parseFloat(avgRating),
        total_reviews: totalReviews,
        breakdown,
        percentages,
        customer_media: customerMedia,
        user_review: userReview,
        reviews: formattedReviews
      }
    });
  } catch (error) {
    console.error('[GET PRODUCT REVIEWS ERROR]', error);
    res.status(500).json({ status: false, message: 'Failed to fetch reviews.' });
  }
};

// -----------------------------------------------------------
// 5. GET /api/reviews/admin/all - Admin Reviews Table (Filter by status)
// -----------------------------------------------------------
exports.getAdminReviews = async (req, res) => {
  try {
    const { status = 'ALL', search = '' } = req.query;

    let whereClauses = [];
    let queryParams = [];

    if (status && status !== 'ALL') {
      whereClauses.push('pr.status = ?');
      queryParams.push(status);
    }

    if (search && search.trim().length > 0) {
      whereClauses.push('(p.name LIKE ? OR u.full_name LIKE ? OR pr.review_text LIKE ? OR pr.admin_user_name LIKE ?)');
      const pat = `%${search.trim()}%`;
      queryParams.push(pat, pat, pat, pat);
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [rows] = await db.query(`
      SELECT 
        pr.*,
        p.name as product_name, p.main_image_url as product_image,
        sp.selling_price,
        IF(pr.created_by_admin = 1, IFNULL(pr.admin_user_name, 'Admin Generated'), IFNULL(u.full_name, 'Earn24 Customer')) as user_name,
        u.email as user_email, u.mobile_number as user_mobile
      FROM product_reviews pr
      JOIN products p ON pr.product_id = p.id
      LEFT JOIN seller_products sp ON pr.seller_product_id = sp.id
      LEFT JOIN users u ON pr.user_id = u.id
      ${whereStr}
      ORDER BY pr.created_at DESC
    `, queryParams);

    const formattedRows = rows.map(r => {
      let parsedMedia = [];
      try { parsedMedia = typeof r.media_urls === 'string' ? JSON.parse(r.media_urls) : (r.media_urls || []); } catch(e){}
      return {
        ...r,
        title: r.review_title || '',
        comment: r.review_text || '',
        rating: parseFloat(r.rating),
        media: parsedMedia,
        media_urls: parsedMedia
      };
    });

    // Fetch counts for tabs
    const [counts] = await db.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) as approved_count,
        SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) as rejected_count
      FROM product_reviews
    `);

    res.status(200).json({
      status: true,
      counts: counts[0] || { total: 0, pending_count: 0, approved_count: 0, rejected_count: 0 },
      data: formattedRows
    });
  } catch (error) {
    console.error('[GET ADMIN REVIEWS ERROR]', error);
    res.status(500).json({ status: false, message: 'Failed to fetch admin reviews.' });
  }
};

// -----------------------------------------------------------
// 6. PATCH /api/reviews/admin/status/:id - Admin Approve / Reject
// -----------------------------------------------------------
exports.updateReviewStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'APPROVED' or 'REJECTED'

    if (!['APPROVED', 'REJECTED', 'PENDING'].includes(status)) {
      return res.status(400).json({ status: false, message: 'Invalid status value.' });
    }

    const [[review]] = await db.query(`SELECT * FROM product_reviews WHERE id = ?`, [id]);
    if (!review) {
      return res.status(404).json({ status: false, message: 'Review not found.' });
    }

    await db.query(`UPDATE product_reviews SET status = ?, updated_at = NOW() WHERE id = ?`, [status, id]);
    await recalculateProductRating(review.product_id, review.seller_product_id);

    res.status(200).json({ status: true, message: `Review status updated to ${status}.` });
  } catch (error) {
    console.error('[UPDATE REVIEW STATUS ERROR]', error);
    res.status(500).json({ status: false, message: 'Failed to update status.' });
  }
};

// -----------------------------------------------------------
// 7. POST /api/reviews/admin/seed - Admin Direct Custom Review Creator
// -----------------------------------------------------------
exports.addAdminSeedReview = async (req, res) => {
  try {
    const {
      product_id,
      seller_product_id,
      admin_user_name,
      rating,
      review_title,
      review_text
    } = req.body;

    if (!product_id || !rating) {
      return res.status(400).json({ status: false, message: 'Product ID and Rating are required.' });
    }

    const numericRating = Math.min(5, Math.max(1, parseFloat(rating) || 5.0));

    let mediaUrls = [];
    if (req.files && req.files.length > 0) {
      mediaUrls = req.files.map(file => {
        const isVideo = file.mimetype.startsWith('video/');
        return { type: isVideo ? 'video' : 'image', url: `/uploads/reviews/${file.filename}` };
      });
    }

    const [result] = await db.query(`
      INSERT INTO product_reviews (
        user_id, product_id, seller_product_id, rating, review_title, review_text,
        media_urls, status, is_verified_purchase, created_by_admin, admin_user_name
      ) VALUES (NULL, ?, ?, ?, ?, ?, ?, 'APPROVED', 1, 1, ?)
    `, [
      product_id,
      seller_product_id || null,
      numericRating,
      review_title || '',
      review_text || '',
      JSON.stringify(mediaUrls),
      admin_user_name || 'Verified Buyer'
    ]);

    await recalculateProductRating(product_id, seller_product_id);

    res.status(201).json({
      status: true,
      message: 'Admin Seed Review added & published successfully!',
      review_id: result.insertId
    });
  } catch (error) {
    console.error('[ADD ADMIN SEED REVIEW ERROR]', error);
    res.status(500).json({ status: false, message: 'Failed to create seed review.', error: error.message });
  }
};

// -----------------------------------------------------------
// 8. GET & POST /api/reviews/admin/settings - Auto-Publish Settings Toggle
// -----------------------------------------------------------
exports.getReviewSettings = async (req, res) => {
  try {
    const [[setting]] = await db.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'review_auto_approve'`).catch(() => [[null]]);
    const isAutoApprove = !setting || setting.setting_value === '1';
    res.status(200).json({ status: true, auto_approve: isAutoApprove });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to fetch settings.' });
  }
};

exports.updateReviewSettings = async (req, res) => {
  try {
    const { auto_approve } = req.body;
    const valueStr = (auto_approve === true || auto_approve === 1 || auto_approve === '1') ? '1' : '0';

    await db.query(`
      INSERT INTO system_settings (setting_key, setting_value) 
      VALUES ('review_auto_approve', ?)
      ON DUPLICATE KEY UPDATE setting_value = ?
    `, [valueStr, valueStr]);

    res.status(200).json({
      status: true,
      auto_approve: valueStr === '1',
      message: valueStr === '1' 
        ? 'Auto-Publish Mode Activated (Reviews publish instantly).' 
        : 'Strict Approval Mode Activated (Reviews require Admin approval).'
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to update settings.' });
  }
};

// -----------------------------------------------------------
// 9. GET /api/reviews/merchant/my-reviews - Merchant Product Reviews
// -----------------------------------------------------------
exports.getMerchantReviews = async (req, res) => {
  try {
    const merchantId = req.user ? req.user.id : null;
    if (!merchantId) {
      return res.status(401).json({ status: false, message: 'Authentication required.' });
    }

    const [rows] = await db.query(`
      SELECT 
        pr.*,
        p.name as product_name, p.main_image_url as product_image,
        IF(pr.created_by_admin = 1, IFNULL(pr.admin_user_name, 'Verified Customer'), IFNULL(u.full_name, 'Earn24 Customer')) as user_name
      FROM product_reviews pr
      JOIN seller_products sp ON pr.seller_product_id = sp.id
      JOIN sellers s ON sp.seller_id = s.id
      JOIN products p ON pr.product_id = p.id
      LEFT JOIN users u ON pr.user_id = u.id
      WHERE s.sellerable_id = ? AND pr.status = 'APPROVED'
      ORDER BY pr.created_at DESC
    `, [merchantId]);

    const formattedRows = rows.map(r => {
      let parsedMedia = [];
      try { parsedMedia = typeof r.media_urls === 'string' ? JSON.parse(r.media_urls) : (r.media_urls || []); } catch(e){}
      return {
        ...r,
        rating: parseFloat(r.rating),
        media_urls: parsedMedia
      };
    });

    res.status(200).json({ status: true, data: formattedRows });
  } catch (error) {
    console.error('[GET MERCHANT REVIEWS ERROR]', error);
    res.status(500).json({ status: false, message: 'Failed to fetch merchant reviews.' });
  }
};
