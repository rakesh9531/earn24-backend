// // Routes/brandRoute.js

// const express = require('express');
// const router = express.Router();
// const brandController = require('../Controllers/brandController'); // We will create this
// const createUploader = require('../Middleware/uploaderFactory'); // Import our new factory

// // Create a specific uploader instance for brand logos
// const uploadLogo = createUploader('brand-logos');

// // Use the uploader as middleware for create and update routes
// router.post('/create', uploadLogo.single('logo'), brandController.createBrand);
// router.get('/all', brandController.getAllBrands);
// router.put('/update/:id', uploadLogo.single('logo'), brandController.updateBrand);
// router.delete('/delete/:id', brandController.deleteBrand);

// module.exports = router;



const express = require('express');
const router = express.Router();
const brandController = require('../Controllers/brandController');
const createUploader = require('../Middleware/uploaderFactory');
const { auth, can } = require('../Middleware/auth');

const uploadLogo = createUploader('brand-logos');

router.post('/create', auth, can('brands:create'), uploadLogo.single('logo'), brandController.createBrand);
router.get('/all', auth, can('brands:read'), brandController.getAllBrands);
router.put('/update/:id', auth, can('brands:update'), uploadLogo.single('logo'), brandController.updateBrand);
router.delete('/delete/:id', auth, can('brands:delete'), brandController.deleteBrand);

module.exports = router;