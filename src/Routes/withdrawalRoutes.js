const express = require('express');
const router = express.Router();
const withdrawalController = require('../Controllers/withdrawalController');
const { auth, can } = require('../Middleware/auth');

// --- User-Facing Route ---
router.post('/request', auth, withdrawalController.requestWithdrawal);
router.get('/my-history', auth, withdrawalController.getUserWithdrawals);

// --- Admin-Only Routes ---
router.get('/admin/all', auth, can('settings:manage'), withdrawalController.adminGetWithdrawals);
router.post('/admin/process', auth, can('settings:manage'), withdrawalController.adminProcessWithdrawal);

module.exports = router;
