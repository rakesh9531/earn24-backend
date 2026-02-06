// const express = require('express');
// const router = express.Router();
// const adminOrderController = require('../Controllers/adminOrderController');
// // const { authMiddleware, isAdmin } = require('../middleware/authMiddleware');

// // All routes in this file are for admins only
// // router.use(authMiddleware, isAdmin);

// // GET /api/admin/orders?status=CONFIRMED
// // Get a list of orders based on their status
// router.get('/', adminOrderController.getOrdersByStatus);

// // PUT /api/admin/orders/:orderId/assign-delivery
// // Assign an order to a delivery agent and change its status to 'SHIPPED'
// router.put('/:orderId/assign-delivery', adminOrderController.assignOrderForDelivery);

// // Note: You would also add routes here for admins to cancel orders, etc.

// router.get('/:orderId', adminOrderController.getAdminOrderDetails);

// module.exports = router;









// const express = require('express');
// const router = express.Router();
// const adminOrderController = require('../Controllers/adminOrderController');
// const { auth, can } = require('../Middleware/auth');

// router.use(auth);

// router.get('/', can('orders:read'), adminOrderController.getOrdersByStatus);
// router.put('/:orderId/assign-delivery', can('orders:updateStatus'), adminOrderController.assignOrderForDelivery);
// router.get('/:orderId', can('orders:read'), adminOrderController.getAdminOrderDetails);


// //-----------------------------------------------------------------------------


// router.get('/pending-settlements', auth, adminOrderController.getPendingSettlements);
// router.post('/verify-settlement', auth, adminOrderController.verifySettlement);
// router.post('/settle-cash', auth, can('orders:manage'), adminOrderController.settleAgentCash);

// module.exports = router;








const express = require('express');
const router = express.Router();
const adminOrderController = require('../Controllers/adminOrderController');
const { auth, can } = require('../Middleware/auth');

router.use(auth);

// --- 1. SPECIFIC STATIC ROUTES (Must be first) ---
// This fixes the 404 "Order not found" error
router.get('/pending-settlements', can('orders:read'), adminOrderController.getPendingSettlements);
router.get('/all-history', can('orders:read'), adminOrderController.getAllOrdersHistory);
router.get('/', can('orders:read'), adminOrderController.getOrdersByStatus);

// --- 2. ACTION ROUTES ---
router.post('/verify-settlement', can('orders:manage'), adminOrderController.verifySettlement);
router.post('/settle-cash', can('orders:manage'), adminOrderController.settleAgentCash);

// --- 3. PARAMETERIZED ROUTES (Must be last) ---
router.put('/:orderId/assign-delivery', can('orders:updateStatus'), adminOrderController.assignOrderForDelivery);
router.get('/:orderId', can('orders:read'), adminOrderController.getAdminOrderDetails);

module.exports = router;