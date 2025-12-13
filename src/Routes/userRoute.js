// const express = require('express');
// const router = express.Router();
// const userController = require('../Controllers/userController');
// const authentication = require('../Middleware/auth');


// router.post('/userLogin', userController.userLogin)

// router.get('/profile', userController.getUserProfile);


// // GET /api/me/summary
// // Fetches the user's wallet balance, total BV, and downline count
// router.get('/summary', userController.getDashboardSummary);

// // GET /api/me/profit-history
// // Fetches the user's personal profit ledger (cash transactions)
// router.get('/profit-history', userController.getProfitHistory);

// // GET /api/me/bv-history
// // Fetches the user's personal BV ledger (points transactions)
// router.get('/bv-history', userController.getBvHistory);

// // GET /api/me/downline
// // Fetches the user's direct referrals (Level 1)
// router.get('/downline', userController.getDownline);

// module.exports = router;







const express = require('express');
const router = express.Router();
const userController = require('../Controllers/userController');
const { auth } = require('../Middleware/auth'); // Only `auth` is needed here

// Public routes for registration and login are moved to authRoutes.js

// All routes below require the user to be logged in.
// router.use(auth);



// --- New REGISTRATION FLOW ---
// 1. User fills form -> Validates -> Saves to Temp DB -> Sends OTP
router.post('/register/initiate', userController.registerInitiate);

// 2. User enters OTP -> Moves data from Temp to Users Table -> Auto Logs in
router.post('/register/verify', userController.verifyRegistrationOtp);

// --- LOGIN FLOW (Standard) ---
router.post('/loginUser', userController.loginUser);

// --- FORGOT PASSWORD FLOW ---
router.post('/forgot-password/initiate', userController.forgotPasswordInitiate);
router.post('/forgot-password/verify', userController.resetPasswordVerify); // Resets password immediately

// --- SHARED ---
router.post('/resend-otp', userController.resendOtp);






// OLD REGISTARTION
// router.post('/registerUser', userController.registerUser)


router.get('/profile', auth, userController.getUserProfile);
router.get('/summary', auth, userController.getDashboardSummary);
router.get('/profit-history', auth, userController.getProfitHistory);
router.get('/bv-history', auth, userController.getBvHistory);
router.get('/downline', auth, userController.getDownline);

router.get('/mlm/my-network-tree', auth, userController.getMyInitialNetworkTree);
router.get('/mlm/tree-node/:userId', auth, userController.getMlmTreeNode);


module.exports = router;