// const express = require('express');
// const router = express.Router();
// const addressController = require('../controllers/addressController');
// // const authMiddleware = require('../middleware/authMiddleware'); 

// // Apply the authentication middleware to all routes in this file
// // router.use(authMiddleware);

// // GET /api/addresses/
// // Fetches all addresses for the logged-in user
// router.get('/', addressController.getUserAddresses);

// // POST /api/addresses/add
// // Adds a new address for the logged-in user
// router.post('/add', addressController.addAddress);

// // PUT /api/addresses/update/:addressId
// // Updates a specific address belonging to the user
// router.put('/update/:addressId', addressController.updateAddress);

// // DELETE /api/addresses/delete/:addressId
// // Deletes a specific address belonging to the user
// router.delete('/delete/:addressId', addressController.deleteAddress);

// // PATCH /api/addresses/set-default/:addressId
// // Sets a specific address as the default for the user
// router.patch('/set-default/:addressId', addressController.setDefaultAddress);

// module.exports = router;







const express = require('express');
const router = express.Router();
const addressController = require('../Controllers/addressController');
const { auth } = require('../Middleware/auth'); 

router.use(auth);

router.get('/', addressController.getUserAddresses);
router.post('/add', addressController.addAddress);
router.put('/update/:addressId', addressController.updateAddress);
router.delete('/delete/:addressId', addressController.deleteAddress);
router.patch('/set-default/:addressId', addressController.setDefaultAddress);

module.exports = router;