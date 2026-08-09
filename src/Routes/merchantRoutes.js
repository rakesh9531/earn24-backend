const express = require('express');
const router = express.Router();
const merchantController = require('../Controllers/merchantController');
const authMiddleware = require('../Middleware/authMiddleware');

// Public Merchant Routes
router.post('/register', merchantController.registerMerchant);
router.post('/login', merchantController.loginMerchant);

// Protected Merchant Routes (Requires Auth Token)
router.get('/profile', authMiddleware, merchantController.getMerchantProfile);
router.post('/products/add', authMiddleware, merchantController.addMerchantProduct);
router.get('/products', authMiddleware, merchantController.getMerchantProducts);
router.get('/orders', authMiddleware, merchantController.getMerchantOrders);

module.exports = router;