const express    = require('express');
const router     = express.Router();
const returnCtrl = require('../Controllers/returnController');
const { auth }   = require('../Middleware/auth');

// Public Webhook (Shiprocket Return Tracking Updates)
router.post('/shiprocket-webhook', returnCtrl.handleShiprocketWebhook);

// Customer Routes
router.post('/submit',       auth, returnCtrl.submitReturnRequest);
router.get('/my-requests',   auth, returnCtrl.getMyReturnRequests);

// Merchant Routes
router.get('/merchant/all',           auth, returnCtrl.getMerchantReturnRequests);
router.patch('/merchant/:id/action',   auth, returnCtrl.merchantReturnAction);
router.post('/:id/dispatch-replacement', auth, returnCtrl.dispatchReplacementUnit);

// Admin Routes
router.get('/admin/all',           auth, returnCtrl.adminGetAllReturnRequests);
router.patch('/admin/:id/resolve', auth, returnCtrl.adminResolveReturn);

module.exports = router;
