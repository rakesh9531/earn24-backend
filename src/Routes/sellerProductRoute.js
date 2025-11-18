// // Routes/sellerProductRoute.js
// const express = require('express');
// const router = express.Router();
// const sellerProductController = require('../Controllers/sellerProductController');

// // --- Seller/Admin Routes ---
// // POST /api/inventory/add-offer
// router.post('/add-offer', sellerProductController.addSellerOffer);


// // --- Public Routes for Mobile App ---
// // GET /api/inventory/search?pincode=...&search=...
// router.get('/search', sellerProductController.findProductsByPincode);

// // Add this to sellerProductRoute.js
// router.get('/all', sellerProductController.getAllSellerOffers);

// // PUT /api/inventory/update-offer/:id
// router.put('/update-offer/:id', sellerProductController.updateSellerOffer);

// // --- NEW ROUTE FOR QUICK STATUS TOGGLE ---
// router.patch('/toggle-status/:id', sellerProductController.toggleOfferStatus);


// router.get('/data', sellerProductController.getHomeScreenData);

// router.get('/related-products/:productId', sellerProductController.getRelatedProducts);



// module.exports = router;









const express = require('express');
const router = express.Router();
const sellerProductController = require('../Controllers/sellerProductController');
const { auth, can } = require('../Middleware/auth');

// --- Seller/Admin/Manager Routes ---
router.post('/add-offer', auth, can('inventory:create'), sellerProductController.addSellerOffer);
router.put('/update-offer/:id', auth, can('inventory:update'), sellerProductController.updateSellerOffer);
router.get('/all', auth, can('inventory:read'), sellerProductController.getAllSellerOffers);
router.patch('/toggle-status/:id', auth, can('inventory:update'), sellerProductController.toggleOfferStatus);

// --- Public Routes for Mobile App (No auth needed) ---
router.get('/search', sellerProductController.findProductsByPincode);
router.get('/data', sellerProductController.getHomeScreenData);
router.get('/related-products/:productId', sellerProductController.getRelatedProducts);

module.exports = router;