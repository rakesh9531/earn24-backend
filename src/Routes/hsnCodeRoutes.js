// // routes/hsnCodeRoutes.js
// const express = require('express');
// const router = express.Router();
// const hsnCodeController = require('../Controllers/hsnCodeController');
// // const { isAuthenticated, isAdmin } = require('../Middleware/auth'); // Uncomment when ready

// // All HSN code routes should be protected for admins
// // router.use(isAuthenticated, isAdmin);


// router.post('/create', hsnCodeController.createHsnCode);


// router.get('/all', hsnCodeController.getAllHsnCodes);

// router.put('/update/:id', hsnCodeController.updateHsnCode);

// module.exports = router;


const express = require('express');
const router = express.Router();
const hsnCodeController = require('../Controllers/hsnCodeController');
const { auth, can } = require('../Middleware/auth');

// All HSN code routes are for high-level admins
router.use(auth, can('hsn:manage'));

router.post('/create', hsnCodeController.createHsnCode);
router.get('/all', hsnCodeController.getAllHsnCodes);
router.put('/update/:id', hsnCodeController.updateHsnCode);

module.exports = router;