// File: /services/notificationService.js
const db = require('../../db');

/**
 * Checks the stock for a given seller_product_id and sends notifications if it's low.
 * @param {number} sellerProductId The ID of the seller_product to check.
 * @param {object} connection A database connection object, for transactions.
 */
async function checkStockAndNotify(sellerProductId, connection) {
  try {
    // 1. Get the current stock, threshold, and last notification time
    const [offerRows] = await connection.query(
      `SELECT 
        sp.quantity, 
        sp.low_stock_threshold, 
        sp.last_low_stock_notified_at,
        p.name as product_name
       FROM seller_products sp
       JOIN products p ON sp.product_id = p.id
       WHERE sp.id = ?`,
      [sellerProductId]
    );

    if (offerRows.length === 0) {
      console.warn(`Could not find seller_product with ID ${sellerProductId} to check stock.`);
      return;
    }
    const offer = offerRows[0];

    // 2. Check if stock is below or at the threshold
    if (offer.quantity <= offer.low_stock_threshold) {
      const now = new Date();
      const lastNotified = offer.last_low_stock_notified_at ? new Date(offer.last_low_stock_notified_at) : null;
      
      // 3. Anti-Spam Check: Only notify if never notified before, or if it has been over 24 hours.
      let shouldNotify = true;
      if (lastNotified) {
        const hoursSinceLastNotification = (now - lastNotified) / (1000 * 60 * 60);
        if (hoursSinceLastNotification < 24) {
          shouldNotify = false;
        }
      }

      if (shouldNotify) {
        const message = `Stock for product "${offer.product_name}" is low! Only ${offer.quantity} units remaining.`;
        const link = `/inventory?search=${encodeURIComponent(offer.product_name)}`; // Link to the inventory page

        console.log(`Sending low stock notification for product ID: ${sellerProductId}`);
        
        // --- Trigger all notification channels ---
        await createInPanelNotification(message, link, connection);
        // await sendLowStockEmail(message); // We'll uncomment this when email service is ready
        // await sendLowStockSms(message);   // We'll uncomment this when SMS service is ready

        // 4. Update the timestamp to prevent re-notifying
        await connection.query(
          'UPDATE seller_products SET last_low_stock_notified_at = NOW() WHERE id = ?',
          [sellerProductId]
        );
      }
    }
  } catch (error) {
    console.error(`Error in checkStockAndNotify for ID ${sellerProductId}:`, error);
    // Do not throw error, as this shouldn't block the main process (like order creation)
  }
}

/**
 * Creates a notification record in the database for the admin panel UI.
 */
async function createInPanelNotification(message, link, connection) {
  const query = 'INSERT INTO admin_notifications (type, message, link) VALUES (?, ?, ?)';
  await connection.query(query, ['low_stock', message, link]);
}

// Placeholder for email service
async function sendLowStockEmail(message) {
  console.log("--- SIMULATING EMAIL ---");
  console.log("To: admin@example.com");
  console.log("Subject: Low Stock Alert!");
  console.log(`Body: ${message}`);
  console.log("--- END EMAIL SIMULATION ---");
  // In a real app, this would use a service like Nodemailer
}


module.exports = {
  checkStockAndNotify,
};