// src/Routes/rewardRoutes.js
const express = require('express');
const router = express.Router();
const rewardController = require('../Controllers/rewardController');
const { auth, can } = require('../Middleware/auth');
const rewardUpload = require('../Middleware/rewardUpload');

// --- USER REWARDS ROUTES ---
router.get('/eligible', auth, rewardController.getUserRewardsDashboard);
router.post('/claim', auth, rewardController.submitClaim);
router.get('/history', auth, rewardController.getClaimHistory);

// --- ADMIN REWARDS ROUTES ---
router.get('/admin/claims', auth, can('users:read'), rewardController.adminGetClaims);
router.post('/admin/respond', auth, can('settings:manage'), rewardUpload.single('attachment'), rewardController.adminRespondToClaim);
router.post('/admin/manual-override', auth, can('settings:manage'), rewardController.adminManualOverride);

module.exports = router;
