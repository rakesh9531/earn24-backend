const express    = require('express');
const router     = express.Router();
const merchant   = require('../Controllers/merchantController');
const wallet     = require('../Controllers/merchantWalletController');
const returnCtrl = require('../Controllers/returnController');
const { auth }   = require('../Middleware/auth');
const createUploader = require('../Middleware/uploaderFactory');

const uploadProductImages = createUploader('product-images');
const productUploadMiddleware = uploadProductImages.any();

// ══ Public Routes ══
router.post('/register', merchant.registerMerchant);
router.post('/login',    merchant.loginMerchant);
router.post('/forgot-password/request-otp', merchant.requestMerchantPasswordOtp);
router.post('/forgot-password/reset-password', merchant.verifyMerchantOtpAndResetPassword);

// ══ Merchant Password & Settings ══
router.post('/change-password', auth, merchant.changeMerchantPassword);

// ══ Protected — Merchant Profile & Products ══
router.get('/profile',         auth, merchant.getMerchantProfile);
router.put('/profile',         auth, merchant.updateMerchantProfile);
router.post('/products',       auth, productUploadMiddleware, merchant.addMerchantProduct);
router.post('/products/add',   auth, productUploadMiddleware, merchant.addMerchantProduct);
router.put('/products/:id',    auth, productUploadMiddleware, merchant.updateMerchantProduct);
router.get('/products',        auth, merchant.getMerchantProducts);
router.get('/orders',          auth, merchant.getMerchantOrders);
router.post('/orders/:orderId/verify-pickup', auth, merchant.verifyMerchantPickupOtp);
router.post('/orders/:orderId/assign-delivery', auth, merchant.assignMerchantOrderDelivery);
router.post('/orders/:orderId/dispatch-shiprocket', auth, merchant.dispatchMerchantOrderShiprocket);

// ══ Wallet & Earnings ══
router.get('/wallet/summary',       auth, wallet.getWalletSummary);
router.get('/wallet/transactions',  auth, wallet.getTransactions);
router.post('/settlement/request',  auth, wallet.requestSettlement);
router.get('/settlements',          auth, wallet.getSettlements);

// ══ Bank Details ══
router.post('/bank-details',  auth, wallet.saveBankDetails);
router.get('/bank-details',   auth, wallet.getBankDetails);

// ══ Delivery Agents & Reverse Logistics ══
router.get('/delivery-agents',                  auth, merchant.getDeliveryAgents);

// ══ Return & Replacement (Merchant view & Actions) ══
router.get('/returns',                          auth, returnCtrl.getMerchantReturnRequests);
router.patch('/returns/:id/action',             auth, returnCtrl.merchantReturnAction);
router.post('/returns/:id/assign-agent',        auth, returnCtrl.merchantAssignPickup);
router.patch('/returns/:id/assign-agent',       auth, returnCtrl.merchantAssignPickup);
router.post('/returns/:id/receive-at-hub',      auth, returnCtrl.receiveItemAtHub);
router.post('/returns/:id/dispatch-replacement', auth, returnCtrl.dispatchReplacementUnit);

module.exports = router;