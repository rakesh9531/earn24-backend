// const express = require('express');
// const router = express.Router();
// const settingsController = require('../Controllers/settingsController');
// // const authMiddleware = require('../middleware/auth.middleware'); // Uncomment when you have auth setup

// // All settings routes should be protected for admins
// // router.use(authMiddleware);

// // GET /api/settings/all
// // Fetches all application settings
// router.get('/all', settingsController.getAllSettings);

// // PUT /api/settings/update
// // Updates multiple settings at once
// router.put('/update', settingsController.updateSettings);

// module.exports = router;






const express = require('express');
const router = express.Router();
const settingsController = require('../Controllers/settingsController');
const { auth, can } = require('../Middleware/auth');

// router.use(auth, can('settings:manage'));

// router.get('/all', settingsController.getAllSettings);
// router.put('/update', settingsController.updateSettings);


router.get(
    '/all', 
    auth, // Requires a valid token, but no specific permission.
    settingsController.getAllSettings
);

// --- ROUTE 2: Update Settings ---
// This is a highly privileged action.
// It requires a valid token (auth) AND the specific permission to manage settings.
router.put(
    '/update', 
    auth,                      // Step 1: Must be logged in.
    can('settings:manage'),    // Step 2: Must have the 'settings:manage' permission.
    settingsController.updateSettings
);



router.get('/delivery-rules', settingsController.getDeliveryRules);


module.exports = router;