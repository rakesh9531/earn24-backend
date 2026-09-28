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

/**
 * @route   POST/ALL /api/webhooks/shiprocket
 * @desc    Shiprocket tracking webhook for courier milestones (In Transit, Out for Delivery, Delivered)
 * @access  Public
 */
router.all('/courier-tracking', webhookController.handleShiprocketWebhook);
router.all('/delivery-update', webhookController.handleShiprocketWebhook);
router.all('/shiprocket', webhookController.handleShiprocketWebhook);
router.all('/shiprocket/webhook', webhookController.handleShiprocketWebhook);

module.exports = router;