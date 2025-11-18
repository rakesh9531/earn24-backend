// const express = require('express');
// const router = express.Router();
// const ledgerController = require('../Controllers/ledgerController');
// // const authMiddleware = require('../middleware/auth.middleware'); // Uncomment for security

// // All ledger routes should be protected for admins
// // router.use(authMiddleware);

// // GET /api/ledger/profit
// // Fetches the profit distribution ledger with search and pagination
// router.get('/profit', ledgerController.getProfitLedger);

// // GET /api/ledger/bv
// // Fetches the Business Volume (BV) ledger with search and pagination
// router.get('/bv', ledgerController.getBvLedger);

// module.exports = router;




const express = require('express');
const router = express.Router();
const ledgerController = require('../Controllers/ledgerController');
const { auth, can } = require('../Middleware/auth');

router.use(auth, can('reports:read'));

router.get('/profit', ledgerController.getProfitLedger);
router.get('/bv', ledgerController.getBvLedger);

router.get('/commissions', ledgerController.getCommissionLedger);


module.exports = router;