// File: /src/Routes/retailerRoutes.js

const express = require('express');
const router = express.Router();
const retailerController = require('../Controllers/retailerController'); // <-- Use the new dedicated controller
const { auth, can } = require('../Middleware/auth');

// 1. Get All Retailers (Search & Pagination)
// URL: GET /api/retailer/get-all?search=abc
router.get('/get-all', auth, can('users:read'), retailerController.getAllRetailers);

// 2. Create New Retailer (Manually by Admin)
// URL: POST /api/retailer/create
router.post('/create', auth, can('users:create'), retailerController.createRetailer);

// 3. Update Retailer Status (Approve / Block / Unblock)
// URL: PATCH /api/retailer/update-status/5
router.patch('/update-status/:id', auth, can('users:update'), retailerController.updateStatus);

// 4. Delete Retailer (Soft Delete)
// URL: DELETE /api/retailer/delete/5
router.delete('/delete/:id', auth, can('users:delete'), retailerController.deleteRetailer);


module.exports = router;