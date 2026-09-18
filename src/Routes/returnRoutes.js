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

// Admin Routes (Supports both /returns/admin/* and /admin/returns/*)
router.get('/admin/all',                       auth, returnCtrl.adminGetAllReturnRequests);
router.get('/all',                             auth, returnCtrl.adminGetAllReturnRequests);
router.patch('/admin/:id/resolve',             auth, returnCtrl.adminResolveReturn);
router.patch('/:id/resolve',                   auth, returnCtrl.adminResolveReturn);
router.patch('/admin/:id/assign-agent',        auth, returnCtrl.adminAssignPickup);
router.patch('/:id/assign-agent',              auth, returnCtrl.adminAssignPickup);
router.patch('/admin/:id/process-upi-refund',  auth, returnCtrl.adminProcessUpiRefund);
router.patch('/:id/process-upi-refund',        auth, returnCtrl.adminProcessUpiRefund);

module.exports = router;
