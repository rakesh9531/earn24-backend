// File: /src/Routes/authRoutes.js

const express = require('express');
const router = express.Router();
const authController = require('../Controllers/authController');

// All login requests are handled here.
router.post('/admin/login', authController.adminLogin);
router.post('/user/login', authController.userLogin);
router.post('/merchant/login', authController.merchantLogin);

router.post('/retailer/login', authController.retailerLogin);

module.exports = router;