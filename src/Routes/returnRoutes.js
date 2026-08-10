const express    = require('express');
const router     = express.Router();
const returnCtrl = require('../Controllers/returnController');
const { auth }   = require('../Middleware/auth');

// Customer Routes
router.post('/submit',       auth, returnCtrl.submitReturnRequest);
router.get('/my-requests',   auth, returnCtrl.getMyReturnRequests);

// Admin Routes
router.get('/admin/all',           auth, returnCtrl.adminGetAllReturnRequests);
router.patch('/admin/:id/resolve', auth, returnCtrl.adminResolveReturn);

module.exports = router;
