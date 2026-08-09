const express = require('express');
const router = express.Router();
const returnController = require('../Controllers/returnController');
const authMiddleware = require('../Middleware/authMiddleware');

// Customer submits a return/replacement request
router.post('/submit', authMiddleware, returnController.submitReturnRequest);

// Fetch return requests (Admin / Merchant)
router.get('/list', authMiddleware, returnController.getReturnRequests);

// Action (Approve / Reject) return request
router.post('/action/:returnId', authMiddleware, returnController.actionReturnRequest);

module.exports = router;
