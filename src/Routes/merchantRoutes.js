const express = require('express');
const router = express.Router();
const merchantController = require('../Controllers/merchantController');
const { auth } = require('../Middleware/auth');

// Public Merchant Routes
router.post('/register', merchantController.registerMerchant);
router.post('/login', merchantController.loginMerchant);

// Protected Merchant Routes (Requires Auth Token)
router.get('/profile', auth, merchantController.getMerchantProfile);
router.post('/products/add', auth, merchantController.addMerchantProduct);
router.get('/products', auth, merchantController.getMerchantProducts);
router.get('/orders', auth, merchantController.getMerchantOrders);

module.exports = router;