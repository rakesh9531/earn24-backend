const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const reviewController = require('../Controllers/reviewController');
const auth = require('../Middleware/auth');

// Setup Multer Storage for Review Images & Videos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(process.cwd(), 'src/uploads/reviews'));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'review-' + uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image and video files are allowed!'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max per video/photo
});

// ---------------------------------------------------
// Customer Endpoints
// ---------------------------------------------------
router.post('/add', auth, upload.array('media', 5), reviewController.postReview);
router.put('/update/:id', auth, upload.array('media', 5), reviewController.updateReview);
router.delete('/delete/:id', auth, reviewController.deleteReview);
router.get('/product/:productId', reviewController.getProductReviews);

// ---------------------------------------------------
// Admin Endpoints
// ---------------------------------------------------
router.get('/admin/all', auth, reviewController.getAdminReviews);
router.patch('/admin/status/:id', auth, reviewController.updateReviewStatus);
router.post('/admin/seed', auth, upload.array('media', 5), reviewController.addAdminSeedReview);
router.get('/admin/settings', auth, reviewController.getReviewSettings);
router.post('/admin/settings', auth, reviewController.updateReviewSettings);

// ---------------------------------------------------
// Merchant Endpoints
// ---------------------------------------------------
router.get('/merchant/my-reviews', auth, reviewController.getMerchantReviews);

module.exports = router;
