const express = require('express');
const router = express.Router();
const deliveryAppController = require('../Controllers/deliveryAppController');
const { auth } = require('../Middleware/auth'); // Your existing JWT auth middleware

// 1. Authentication for Agent
router.post('/login', deliveryAppController.login);

// 2. Fetch Assigned Orders
router.get('/my-orders', auth, deliveryAppController.getMyOrders);

// 3. Start Delivery (Generates OTP)
router.post('/start-delivery', auth, deliveryAppController.startDelivery);

// 4. Verify OTP & Complete (Handles Cash/Online Payment)
router.post('/complete-delivery', auth, deliveryAppController.completeDelivery);

module.exports = router;