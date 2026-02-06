// const express = require('express');
// const router = express.Router();
// const adminController = require('../Controllers/adminController')
// const authentication = require('../Middleware/auth');
// const upload = require('../Middleware/upload');
// // Example routes

// router.post('/createAdmin', adminController.createAdmin)

// // admin Login api
// router.post('/adminLogin', adminController.adminLogin)


// // Client management apis for admin panel 
// router.post("/getAllUserList", adminController.getAllUserList)


// // Category apis for admin panel
// router.post('/addCategory', upload.single('image'), adminController.addCategory);
// router.get('/getAllCategories', adminController.getAllCategories);
// router.get('/getCategory/:id', adminController.getCategoryById);
// router.patch('/updateCategory/:id', upload.single('image'), adminController.updateCategory);
// router.delete('/deleteCategory/:id', adminController.deleteCategory); // soft delete


// // SubCategory routes
// router.post('/addSubCategory', upload.single('image'), adminController.addSubCategory);
// router.get('/getAllSubCategories', adminController.getAllSubCategories);
// router.get('/getSubCategory/:id', adminController.getSubCategoryById);
// router.patch('/updateSubCategory/:id', upload.single('image'), adminController.updateSubCategory);
// router.delete('/deleteSubCategory/:id', adminController.deleteSubCategory); // soft delete


// module.exports = router;














const express = require('express');
const router = express.Router();
const adminController = require('../Controllers/adminController');
const { auth, can } = require('../Middleware/auth');
const upload = require('../Middleware/upload');
const pageController = require('../Controllers/pageController');

// Public route for login is moved to authRoutes.js
// Unprotected route to create the very first admin
router.post('/createAdmin', adminController.createAdmin);

// Protected routes below
router.post("/getAllUserList", auth, can('users:read'), adminController.getAllUserList);

// Category routes
router.post('/addCategory', auth, can('categories:create'), upload.single('image'), adminController.addCategory);
router.get('/getAllCategories', auth, can('categories:read'), adminController.getAllCategories);
router.get('/getCategory/:id', auth, can('categories:read'), adminController.getCategoryById);
router.patch('/updateCategory/:id', auth, can('categories:update'), upload.single('image'), adminController.updateCategory);
router.delete('/deleteCategory/:id', auth, can('categories:delete'), adminController.deleteCategory);

// SubCategory routes
router.post('/addSubCategory', auth, can('subcategories:create'), upload.single('image'), adminController.addSubCategory);
router.get('/getAllSubCategories', auth, can('subcategories:read'), adminController.getAllSubCategories);
router.get('/getSubCategory/:id', auth, can('subcategories:read'), adminController.getSubCategoryById);
router.patch('/updateSubCategory/:id', auth, can('subcategories:update'), upload.single('image'), adminController.updateSubCategory);
router.delete('/deleteSubCategory/:id', auth, can('subcategories:delete'), adminController.deleteSubCategory);


router.get("/merchants/all", auth, can('users:read'), adminController.getAllMerchants);
router.post("/merchants/create", auth, can('merchants:create'), adminController.createMerchantByAdmin);



router.get('/mlm/list-users', auth, adminController.getPaginatedUsers);
router.get('/mlm/search-users', auth, adminController.searchUsersForTree);
router.get('/mlm/tree-node/:userId', auth, adminController.getDownlineForTreeNode);



// --- App Pages Management (Admin Only) ---
router.get('/pages/all', auth, can('settings:read'), pageController.getAllPages);
router.post('/pages/update', auth, can('settings:manage'), pageController.updatePageContent);

// --- Public Access (No Auth needed for Mobile App to read Privacy Policy) ---
// Note: Register this in your top-level route.js if you want it strictly public
router.get('/public/page', pageController.getPageContent);


module.exports = router;