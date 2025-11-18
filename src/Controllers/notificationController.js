// File: /Controllers/notificationController.js
const db = require('../../db');

// Get all notifications, newest first, with pagination
exports.getAllNotifications = async (req, res) => {
  try {
    const [notifications] = await db.query(
      'SELECT id, type, message, link, is_read, created_at FROM admin_notifications ORDER BY created_at DESC LIMIT 50'
    );
    res.status(200).json({ status: true, data: notifications });
  } catch (error) {
    res.status(500).json({ status: false, message: 'An error occurred.' });
  }
};

// Get the count of unread notifications
exports.getUnreadCount = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT COUNT(*) as unreadCount FROM admin_notifications WHERE is_read = FALSE');
    res.status(200).json({ status: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ status: false, message: 'An error occurred.' });
  }
};

// Mark a specific notification as read
exports.markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    await db.query('UPDATE admin_notifications SET is_read = TRUE WHERE id = ?', [notificationId]);
    res.status(200).json({ status: true, message: 'Notification marked as read.' });
  } catch (error) {
    res.status(500).json({ status: false, message: 'An error occurred.' });
  }
};