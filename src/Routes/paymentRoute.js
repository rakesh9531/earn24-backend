const express = require("express");
const router = express.Router();

const { auth } = require("../Middleware/auth"); // ✅ destructuring
const paymentController = require("../Controllers/paymentController");

// --- ADMIN ROUTES (Protected) ---
router.post('/admin/save-gateway', auth, paymentController.savePaymentGateway);
router.get('/admin/all-gateways', auth, paymentController.getAllGateways);
router.post('/admin/activate-gateway/:id', auth, paymentController.activateGateway);


// --- PUBLIC/USER ROUTES ---
router.post("/create-order", paymentController.createOrder);
router.post("/verify-payment", paymentController.verifyPayment);
router.get('/status/:transactionId', paymentController.checkPhonePeStatus);

module.exports = router;
