// File: /src/Routes/retailerRoutes.js

const express = require('express');
const router = express.Router();
const retailerController = require('../Controllers/retailerController'); // <-- Use the new dedicated controller

// This is the public registration endpoint for retailers
// POST /api/retailer/register
router.post('/register', retailerController.registerRetailer);


// Example of a future protected route for a logged-in retailer
/*
const { auth, authorize } = require('../../Middleware/auth');
router.get('/my-profile', auth, authorize(['Retailer']), retailerController.getRetailerProfile);
*/

module.exports = router;