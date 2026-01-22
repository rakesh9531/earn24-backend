const express = require('express');
const router = express.Router();
const controller = require('../Controllers/retailerInventoryController');
const { retailerAuth } = require('../Middleware/retailerAuth');
const posController = require('../Controllers/retailerPosController');
// Protected Routes (Require Token)
router.get('/master-search', retailerAuth, controller.searchMasterProducts); // Search global DB
router.post('/add', retailerAuth, controller.addToInventory);               // Add to My Shop
router.get('/my-inventory', retailerAuth, controller.getMyInventory);       // View My Shop
router.patch('/update/:inventory_id', retailerAuth, controller.updateInventoryItem); // Edit Stock/Price

router.get('/customer/search', retailerAuth, posController.searchCustomer);
router.post('/pos/order', retailerAuth, posController.createOrder);
router.get('/pos/invoice/:order_id', retailerAuth, posController.getInvoiceDetails);
// SALES HISTORY
router.get('/pos/history', retailerAuth, posController.getSalesHistory); // <--- ADD THIS
// DASHBOARD STATS
router.get('/dashboard/stats', retailerAuth, posController.getDashboardStats); // <--- ADD THIS
router.get('/pos/history/stats', retailerAuth, posController.getSalesStats);
router.post('/pos/return', retailerAuth, posController.processReturn);


module.exports = router;