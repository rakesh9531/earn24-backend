const express = require('express');
const router = express.Router();
const returnController = require('../Controllers/returnController');
const { auth } = require('../Middleware/auth');

// Customer submits a return/replacement request
router.post('/submit', auth, returnController.submitReturnRequest);

// Fetch return requests (Admin / Merchant)
router.get('/list', auth, returnController.getReturnRequests);

// Action (Approve / Reject) return request
router.post('/action/:returnId', auth, returnController.actionReturnRequest);

module.exports = router;
