// src/jobs/mlmDistributionJob.js
const cron = require('node-cron');
const db = require('../../db');
const distributionService = require('../Services/distributionService');

/**
 * Scheduled Job to process MLM Distribution & Cashback for orders
 * whose 7-day Return/Replace policy window has expired with no approved return.
 */
async function processPendingReturnWindowDistributions() {
    console.log('[MLM Distribution Job] Checking for orders with expired return windows...');
    const connection = await db.getConnection();

    try {
        // Fetch all delivered orders where return window has passed and distribution hasn't occurred yet
        const [orders] = await connection.query(`
            SELECT DISTINCT o.id as order_id, o.user_id, o.order_status
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            LEFT JOIN order_returns ord ON oi.id = ord.order_item_id
            WHERE (o.order_status = 'DELIVERED' OR oi.item_status = 'DELIVERED')
              AND (oi.is_mlm_distributed = 0 OR o.is_mlm_distributed = 0)
              AND (
                oi.return_window_expiry_date <= NOW()
                OR (oi.return_window_expiry_date IS NULL AND oi.delivered_at <= DATE_SUB(NOW(), INTERVAL 7 DAY))
                OR (oi.return_window_expiry_date IS NULL AND oi.delivered_at IS NULL AND o.created_at <= DATE_SUB(NOW(), INTERVAL 7 DAY))
              )
              AND (
                ord.id IS NULL 
                OR ord.status = 'REJECTED' 
                OR ord.admin_action = 'REJECTED'
              )
        `);

        if (orders.length === 0) {
            console.log('[MLM Distribution Job] No pending orders with expired return window found.');
            return;
        }

        console.log(`[MLM Distribution Job] Found ${orders.length} orders ready for cashback/commission distribution.`);

        for (const order of orders) {
            try {
                await connection.beginTransaction();
                console.log(`[MLM Distribution Job] Processing order #${order.order_id}...`);
                
                await distributionService.processOrderDistribution(connection, order.order_id);

                await connection.query('UPDATE order_items SET is_mlm_distributed = 1 WHERE order_id = ?', [order.order_id]);
                await connection.query('UPDATE orders SET is_mlm_distributed = 1 WHERE id = ?', [order.order_id]);

                await connection.commit();
                console.log(`✅ [MLM Distribution Job] Successfully completed distribution for order #${order.order_id}`);
            } catch (err) {
                if (connection) await connection.rollback();
                console.error(`❌ [MLM Distribution Job] Error processing order #${order.order_id}:`, err.message);
            }
        }

    } catch (error) {
        console.error('[MLM Distribution Job] Error running pending distributions:', error.message);
    } finally {
        if (connection) connection.release();
    }
}

// Schedule to run every hour at minute 0 (e.g. 1:00, 2:00, etc.)
cron.schedule('0 * * * *', () => {
    processPendingReturnWindowDistributions();
});

// Run once after server boot (with 10s delay to allow DB init)
setTimeout(() => {
    processPendingReturnWindowDistributions();
}, 10000);

module.exports = {
    processPendingReturnWindowDistributions
};
