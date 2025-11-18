// const express = require('express');
// const router = express.Router();
// const cartController = require('../controllers/cartController');
// // const authMiddleware = require('../middleware/authMiddleware'); // You MUST protect cart routes

// // All routes here will be prefixed with /api/cart
// // router.use(authMiddleware); // Apply middleware to all cart routes

// // GET /api/cart/
// // Get all items in the logged-in user's cart
// router.get('/', cartController.getCart);

// // POST /api/cart/add
// // Add an item (or update its quantity) in the cart
// router.post('/add', cartController.addItemToCart);

// // PUT /api/cart/update/:itemId
// // Update the quantity of a specific item in the cart
// router.put('/update/:itemId', cartController.updateCartItem);

// // DELETE /api/cart/remove/:itemId
// // Remove a specific item from the cart
// router.delete('/remove/:itemId', cartController.removeCartItem);

// // DELETE /api/cart/clear
// // Remove all items from the cart
// router.delete('/clear', cartController.clearCart);

// module.exports = router;








const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cartController');
const { auth } = require('../Middleware/auth');

// All cart routes must be for a logged-in user
router.use(auth);

router.get('/', cartController.getCart);
router.post('/add', cartController.addItemToCart);
router.put('/update/:itemId', cartController.updateCartItem);
router.delete('/remove/:itemId', cartController.removeCartItem);
router.delete('/clear', cartController.clearCart);

router.post('/validate-for-checkout', cartController.validateCartForCheckout);

module.exports = router;