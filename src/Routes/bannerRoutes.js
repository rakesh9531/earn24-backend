// const express = require('express');
// const router = express.Router();
// const bannerController = require('../Controllers/bannerController');
// const createUploader = require('../Middleware/uploaderFactory');

// const uploadBannerImage = createUploader('banners');

// // GET /api/banners/all (for admin panel list)
// router.get('/all', bannerController.getAllBanners);

// // POST /api/banners/create (for admin panel add form)
// router.post('/create', uploadBannerImage.single('banner_image'), bannerController.createBanner);

// // You would add PUT and DELETE routes here later
// // router.put('/update/:id', ...);
// // router.delete('/delete/:id', ...);

// module.exports = router;








const express = require('express');
const router = express.Router();
const bannerController = require('../Controllers/bannerController');
const createUploader = require('../Middleware/uploaderFactory');
const { auth, can } = require('../Middleware/auth');

const uploadBannerImage = createUploader('banners');

router.get('/all', auth, can('banners:read'), bannerController.getAllBanners);
router.post('/create', auth, can('banners:create'), uploadBannerImage.single('banner_image'), bannerController.createBanner);

// --- NEW ROUTES ---
router.put('/update/:id', auth, can('banners:update'), uploadBannerImage.single('banner_image'), bannerController.updateBanner);
router.patch('/status/:id', auth, can('banners:update'), bannerController.toggleBannerStatus);
router.delete('/delete/:id', auth, can('banners:delete'), bannerController.deleteBanner);

module.exports = router;