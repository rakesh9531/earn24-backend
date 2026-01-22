const express = require('express');
const router = express.Router();
const controller = require('../Controllers/retailerAuthController');

router.post('/login', controller.login);
// router.post('/register', controller.selfRegister); // Implement later for self-registration

module.exports = router;