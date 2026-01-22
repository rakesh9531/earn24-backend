const express = require("express");
const router = express.Router();

const { auth } = require("../Middleware/auth"); // ✅ destructuring
const paymentController = require("../Controllers/paymentController");

// --- ADMIN ROUTES (Protected) ---
router.post('/save-gateway', auth, paymentController.savePaymentGateway);
router.get('/all-gateways', auth, paymentController.getAllGateways);
router.post('/activate-gateway/:id', auth, paymentController.activateGateway);

// ✅ ADD THESE TWO NEW ROUTES TO FIX THE ERROR
router.get('/gateway/:id/config', auth, paymentController.getGatewayConfig);
router.patch('/updateGateways/:id', auth, paymentController.updateGateway);


// --- PUBLIC/USER ROUTES ---
router.post("/create-order", paymentController.createOrder);
router.post("/verify-payment", paymentController.verifyPayment);
router.get('/status/:transactionId', paymentController.checkPhonePeStatus);


// Add this route
router.post("/payu-webhook", paymentController.payuWebhook);

module.exports = router;
