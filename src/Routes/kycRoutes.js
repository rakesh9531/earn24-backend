// const express = require('express');
// const router = express.Router();
// const kycController = require('../Controllers/kycController');
// // const authMiddleware = require('../middleware/authMiddleware'); 

// // --- User-Facing Route ---
// // A logged-in user can submit their KYC details and check their own status.
// router.post('/submit',  kycController.submitKyc);
// router.get('/my-status', kycController.getMyKycStatus);


// // --- Admin-Only Routes ---
// // You would add an `isAdmin` middleware here in a real app.
// // router.use(authMiddleware, isAdmin); 

// // Get a list of all KYC requests for the admin panel
// router.get('/all', kycController.getAllKycRequests);

// // Get details of a single KYC request for the admin to review
// router.get('/:kycId', kycController.getKycDetailsById);

// // Update the status of a KYC request (Approve/Reject)
// router.put('/update-status/:kycId', kycController.updateKycStatus);


// module.exports = router;







const express = require('express');
const router = express.Router();
const kycController = require('../Controllers/kycController');
const { auth, can } = require('../Middleware/auth');

// --- User-Facing Routes ---
router.post('/submit', auth, kycController.submitKyc);
router.get('/my-status', auth, kycController.getMyKycStatus);

// --- Admin-Only Routes ---
router.get('/all', auth, can('kyc:read'), kycController.getAllKycRequests);
router.get('/:kycId', auth, can('kyc:read'), kycController.getKycDetailsById);
router.put('/update-status/:kycId', auth, can('kyc:update'), kycController.updateKycStatus);

module.exports = router;