// const express = require('express');
// const router = express.Router();
// const orderController = require('../Controllers/orderController');
// // const authMiddleware = require('../middleware/authMiddleware');

// // All order-related routes must be protected by authentication
// // router.use(authMiddleware);

// // POST /api/orders/create
// // The main endpoint to create a new order from the user's cart
// router.post('/create', orderController.createOrder);

// // GET /api/orders/
// // Fetches a list of the logged-in user's past orders
// router.get('/', orderController.getOrderHistory);

// // GET /api/orders/:orderId
// // Fetches the details of a single specific order
// router.get('/:orderId', orderController.getOrderDetails);



// module.exports = router;









const express = require('express');
const router = express.Router();
const orderController = require('../Controllers/orderController');
const { auth } = require('../Middleware/auth');

router.use(auth);

router.post('/create', orderController.createOrder);
router.get('/', orderController.getOrderHistory);
router.get('/:orderId', orderController.getOrderDetails);

module.exports = router;