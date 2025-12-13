// // Routes/productRoute.js
// const express = require('express');
// const router = express.Router();
// const productController = require('../Controllers/productController');
// const createUploader = require('../Middleware/uploaderFactory');

// // Create a specific uploader for product images
// const uploadProductImages = createUploader('product-images');

// // This middleware defines which file fields to expect on upload
// const productUploadMiddleware = uploadProductImages.fields([
//     { name: 'main_image', maxCount: 1 },
//     { name: 'gallery_images', maxCount: 5 } // Allow up to 5 gallery images
// ]);

// // --- Admin-Only Routes for Master Product Catalog ---
// // router.use(isAuthenticated, isAdmin); // Protect these routes later

// // POST /api/products/master/create
// router.post(
//     '/master/create',
//     // This middleware expects a field 'main_image' and an array 'gallery_images'
//     uploadProductImages.fields([
//         { name: 'main_image', maxCount: 1 },
//         { name: 'gallery_images', maxCount: 5 } // Allow up to 5 gallery images
//     ]),
//     productController.createMasterProduct
// );

// // GET /api/products/master/all
// router.get('/master/all', productController.getAllMasterProducts);


// // For update, also handle file upload for main_image or gallery_images
// // router.put(
// //   '/master/:id',
// //   uploadProductImages.fields([
// //     { name: 'main_image', maxCount: 1 },
// //     { name: 'gallery_images', maxCount: 5 }
// //   ]),
// //   productController.updateMasterProduct
// // );


// // PUT /api/products/master/update/:id   <-- NEW ROUTE
// router.put(
//   '/master/update/:id',
//   productUploadMiddleware,
//   productController.updateMasterProduct
// );


// // GET /api/products/master/details/:id  <-- NEW ROUTE
// router.get(
//     '/master/details/:id', 
//     productController.getMasterProductById
// );


// module.exports = router;




const express = require('express');
const router = express.Router();
const productController = require('../Controllers/productController');
const createUploader = require('../Middleware/uploaderFactory');
const { auth, can } = require('../Middleware/auth');

const uploadProductImages = createUploader('product-images');
const productUploadMiddleware = uploadProductImages.fields([
    { name: 'main_image', maxCount: 1 },
    { name: 'gallery_images', maxCount: 5 }
]);


router.get('/trending-searches', productController.getTrendingSearches);
router.get('/search', productController.searchProducts);
// --- NEW LIGHTWEIGHT ROUTE FOR SEARCH SUGGESTIONS ---
router.get('/suggestions', productController.getSearchSuggestions);
router.get('/:id', productController.getProductForUser);
router.get('/by-category/:categoryId', productController.getProductsByCategory);

// All master product routes require authentication and specific permissions
router.use(auth);

router.post('/master/create', can('products:create'), productUploadMiddleware, productController.createMasterProduct);
router.get('/master/all', can('products:read'), productController.getAllMasterProducts);
router.put('/master/update/:id', can('products:update'), productUploadMiddleware, productController.updateMasterProduct);
router.get('/master/details/:id', can('products:read'), productController.getMasterProductById);




module.exports = router;