// src/jobs/monthlyQualificationJob.js
const cron = require('node-cron');
const db = require('../../db');
const { MLM_CONFIG } = require('../Services/mlmConfig');

async function runMonthlyQualificationCheck() {
    console.log('[CRON] Starting Monthly User Qualification Check...');
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Step 1: Block users inactive for 6+ months
        await connection.query(`UPDATE users SET is_blocked = TRUE WHERE last_purchase_date < DATE_SUB(NOW(), INTERVAL 6 MONTH) AND is_blocked = FALSE`);

        // Step 2: Recalculate rolling 12-month BV for all users
        await connection.query(`
            UPDATE users u SET u.last_12_months_repurchase_bv = (
                SELECT IFNULL(SUM(o.total_bv_earned), 0) FROM orders o
                WHERE o.user_id = u.id AND o.payment_status = 'COMPLETED' AND o.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
            )
        `);

        // Step 3: Reset all non-blocked users' qualified rank for the new month
        await connection.query(`UPDATE users SET current_monthly_qualified_rank = rank WHERE is_blocked = FALSE`);
        
        // Step 4: Check qualifications for "Leaders and above"
        const leaderIndex = MLM_CONFIG.RANKS.indexOf('LEADER');
        const ranksToCheck = MLM_CONFIG.RANKS.slice(leaderIndex);
        
        const [usersToCheck] = await connection.query(`SELECT id, rank, last_12_months_repurchase_bv FROM users WHERE rank IN (?) AND is_blocked = FALSE`, [ranksToCheck]);

        for (const user of usersToCheck) {
            let isQualified = false;
            const rules = MLM_CONFIG.MONTHLY_QUALIFICATION_RULES;

            if (user.last_12_months_repurchase_bv >= rules.REPURCHASE_BV_REQUIRED) {
                isQualified = true;
            } else {
                const [newSponsors] = await connection.query(`
                    SELECT COUNT(id) as count, SUM(aggregate_personal_bv) as total_bv FROM users 
                    WHERE sponsor_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH) AND last_purchase_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
                `, [user.id]);
                if (newSponsors.length > 0 && newSponsors[0].count >= rules.NEW_SPONSORS_ALTERNATIVE_COUNT && newSponsors[0].total_bv >= rules.NEW_SPONSORS_ALTERNATIVE_BV) {
                    isQualified = true;
                }
            }
            
            if (!isQualified) {
                await connection.query(`UPDATE users SET current_monthly_qualified_rank = 'DISTRIBUTOR_DIAMOND' WHERE id = ?`, [user.id]);
            }
        }
        
        await connection.commit();
        console.log('[CRON] Monthly User Qualification Check finished successfully.');
    } catch (err) {
        await connection.rollback();
        console.error('[CRON] Error during Monthly Qualification Check:', err);
    } finally {
        connection.release();
    }
}

exports.scheduleQualificationJob = () => {
    cron.schedule('0 2 1 * *', runMonthlyQualificationCheck, { scheduled: true, timezone: "Asia/Kolkata" });
};