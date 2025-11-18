// src/Routes/paymentWebhookRoutes.js

const express = require('express');
const router = express.Router();
const webhookController = require('../Controllers/webhookController');

/**
 * @route   POST /api/webhooks/payment-success
 * @desc    Webhook endpoint for receiving successful payment notifications from a payment gateway (e.g., Razorpay, Stripe).
 * @access  Public (Security is handled by signature verification, not JWT)
 */
router.post('/payment-success', webhookController.handlePaymentSuccess);

// You can add other webhook routes here in the future if needed, for example:
// router.post('/payment-failed', webhookController.handlePaymentFailure);
// router.post('/refund-processed', webhookController.handleRefund);

module.exports = router;