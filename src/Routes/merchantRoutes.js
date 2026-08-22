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

// ══ Protected — Merchant Profile & Products ══
router.get('/profile',         auth, merchant.getMerchantProfile);
router.post('/products',       auth, productUploadMiddleware, merchant.addMerchantProduct);
router.post('/products/add',   auth, productUploadMiddleware, merchant.addMerchantProduct);
router.get('/products',        auth, merchant.getMerchantProducts);
router.get('/orders',          auth, merchant.getMerchantOrders);

// ══ Wallet & Earnings ══
router.get('/wallet/summary',       auth, wallet.getWalletSummary);
router.get('/wallet/transactions',  auth, wallet.getTransactions);
router.post('/settlement/request',  auth, wallet.requestSettlement);
router.get('/settlements',          auth, wallet.getSettlements);

// ══ Bank Details ══
router.post('/bank-details',  auth, wallet.saveBankDetails);
router.get('/bank-details',   auth, wallet.getBankDetails);

// ══ Return & Replacement (Merchant view) ══
router.get('/returns',            auth, returnCtrl.getMerchantReturnRequests);
router.patch('/returns/:id/action', auth, returnCtrl.merchantReturnAction);

module.exports = router;