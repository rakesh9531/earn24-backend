// // File: /Routes/notificationRoutes.js
// const express = require('express');
// const router = express.Router();
// const notificationController = require('../Controllers/notificationController');
// // const authMiddleware = require('../middleware/authMiddleware');

// // router.use(authMiddleware); // Protect these routes

// router.get('/all', notificationController.getAllNotifications);
// router.get('/unread-count', notificationController.getUnreadCount);
// router.post('/:notificationId/mark-as-read', notificationController.markAsRead);

// module.exports = router;

// File: /src/Routes/notificationRoutes.js
const express = require('express');
const router = express.Router();
const notificationController = require('../Controllers/notificationController');
const { auth } = require('../Middleware/auth'); // Import your auth middleware

// All notification routes should be protected
router.use(auth);

// GET /api/notifications/all
router.get('/all', notificationController.getAllNotifications);

// GET /api/notifications/unread-count
router.get('/unread-count', notificationController.getUnreadCount);

// POST /api/notifications/:notificationId/mark-as-read
router.post('/:notificationId/mark-as-read', notificationController.markAsRead);

module.exports = router;