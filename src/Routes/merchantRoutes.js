// File: /src/Routes/merchantRoutes.js

const express = require('express');
const router = express.Router();
const merchantController = require('../Controllers/merchantController'); // <-- Use the new dedicated controller

// This is the public registration endpoint for merchants
// POST /api/merchant/register
router.post('/register', merchantController.registerMerchant);

// Example of a future protected route for a logged-in merchant
/*
const { auth, authorize } = require('../../Middleware/auth');
router.get('/my-dashboard', auth, authorize(['Merchant']), merchantController.getDashboard);
*/

module.exports = router;