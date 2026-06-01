// src/jobs/binaryMatchingJob.js
const cron = require('node-cron');
const db = require('../../db');
const moment = require('moment-timezone');

/**
 * Main Binary Matching Logic
 * Traverses all active users, checks left/right legs BV, matches them,
 * applies level-based payout rates (5% down to 1%), checks Rs 5,000 monthly capping limit,
 * deducts matched BV, and updates wallet & ledgers.
 */
async function runBinaryMatching() {
    console.log('[Binary Job] Starting Binary Matching Payout execution...');
    const connection = await db.getConnection();
    
    try {
        // Fetch all active, non-deleted users who have BV in left or right legs
        const [users] = await connection.query(
            "SELECT id, username, left_leg_bv, right_leg_bv, binary_level_matched, total_matched_bv FROM users WHERE is_deleted = 0 AND is_blocked = 0 AND (left_leg_bv > 0 AND right_leg_bv > 0)"
        );

        console.log(`[Binary Job] Found ${users.length} users qualified for binary matching evaluation.`);

        const startOfMonth = moment().tz("Asia/Kolkata").startOf('month').format("YYYY-MM-DD HH:mm:ss");
        const endOfMonth = moment().tz("Asia/Kolkata").endOf('month').format("YYYY-MM-DD HH:mm:ss");

        for (const user of users) {
            const leftLegBv = parseFloat(user.left_leg_bv) || 0;
            const rightLegBv = parseFloat(user.right_leg_bv) || 0;
            const matchedBv = Math.min(leftLegBv, rightLegBv);

            if (matchedBv <= 0) continue;

            await connection.beginTransaction();

            try {
                // 1. Calculate Monthly Capping Limit (Rs. 5,000 max payout per month)
                const [payoutRows] = await connection.query(
                    `SELECT SUM(payout_amount) as total_month_payout 
                     FROM binary_matching_payouts 
                     WHERE user_id = ? AND created_at >= ? AND created_at <= ?`,
                    [user.id, startOfMonth, endOfMonth]
                );

                const currentMonthPayout = parseFloat(payoutRows[0].total_month_payout) || 0;
                const cappingLimit = 5000.00;
                const remainingLimit = Math.max(0, cappingLimit - currentMonthPayout);

                if (remainingLimit <= 0) {
                    console.log(`[Binary Job] User ${user.username} (ID: ${user.id}) has hit the Rs. ${cappingLimit} monthly capping limit. Skipping match.`);
                    await connection.rollback();
                    continue;
                }

                // 2. Determine payout percentage based on the match level
                // Level 1: 5%, Level 2: 4%, Level 3: 3%, Level 4: 2%, Level 5+: 1%
                const currentLevel = parseInt(user.binary_level_matched) || 0;
                let payoutPercentage = 1.00;
                if (currentLevel === 0) payoutPercentage = 5.00;
                else if (currentLevel === 1) payoutPercentage = 4.00;
                else if (currentLevel === 2) payoutPercentage = 3.00;
                else if (currentLevel === 3) payoutPercentage = 2.00;

                // 3. Calculate payout amount
                let rawPayoutAmount = matchedBv * (payoutPercentage / 100);
                let actualPayoutAmount = rawPayoutAmount;
                let isCapped = false;

                if (rawPayoutAmount > remainingLimit) {
                    actualPayoutAmount = remainingLimit;
                    isCapped = true;
                }

                if (actualPayoutAmount <= 0) {
                    await connection.rollback();
                    continue;
                }

                // 4. Update user's wallet balance
                await connection.query(
                    "UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?",
                    [actualPayoutAmount, user.id]
                );

                // 5. Insert wallet transaction ledger record
                await connection.query(
                    `INSERT INTO user_wallet_transactions (user_id, txn_type, amount, source, remarks) 
                     VALUES (?, 'credit', ?, 'level_income', ?)`,
                    [
                        user.id, 
                        actualPayoutAmount, 
                        `Binary Matching: Level ${currentLevel + 1} match of ${matchedBv} BV (${payoutPercentage}% payout)${isCapped ? ' [CAPPED]' : ''}`
                    ]
                );

                // 6. Insert into unified commission_ledger
                await connection.query(
                    `INSERT INTO commission_ledger (user_id, source_user_id, source_order_id, commission_type, base_bv, percentage_applied, amount_credited, notes) 
                     VALUES (?, NULL, NULL, 'BINARY_MATCHING', ?, ?, ?, ?)`,
                    [
                        user.id,
                        matchedBv,
                        payoutPercentage,
                        actualPayoutAmount,
                        `Binary leg matching for user ${user.username}. Matched BV: ${matchedBv}. Level: ${currentLevel + 1}.${isCapped ? ' Exceeded monthly capping limit, adjusted payout.' : ''}`
                    ]
                );

                // 7. Insert detailed matching payout log
                await connection.query(
                    `INSERT INTO binary_matching_payouts (user_id, matched_bv, payout_percentage, payout_amount, remarks) 
                     VALUES (?, ?, ?, ?, ?)`,
                    [
                        user.id, 
                        matchedBv, 
                        payoutPercentage, 
                        actualPayoutAmount, 
                        `Matched ${matchedBv} BV at Level ${currentLevel + 1}. Raw: ₹${rawPayoutAmount.toFixed(2)}, Paid: ₹${actualPayoutAmount.toFixed(2)}`
                    ]
                );

                // 8. Deduct matched BV from left/right legs and update binary levels
                await connection.query(
                    `UPDATE users 
                     SET left_leg_bv = left_leg_bv - ?, 
                         right_leg_bv = right_leg_bv - ?, 
                         total_matched_bv = total_matched_bv + ?, 
                         binary_level_matched = binary_level_matched + 1 
                     WHERE id = ?`,
                    [matchedBv, matchedBv, matchedBv, user.id]
                );

                await connection.commit();
                console.log(`[Binary Match Success] User ID: ${user.id} (${user.username}) matched ${matchedBv} BV at level ${currentLevel + 1}. Payout: ₹${actualPayoutAmount.toFixed(2)}`);

            } catch (userErr) {
                await connection.rollback();
                console.error(`[Binary Match Error] Transaction failed for user ID: ${user.id}:`, userErr);
            }
        }

        console.log('[Binary Job] Binary Matching Payout execution finished successfully.');
    } catch (err) {
        console.error('[Binary Job Error] Fatal error running binary matching:', err);
    } finally {
        connection.release();
    }
}

/**
 * Schedule binary matching job to run daily at midnight (00:05 AM IST)
 */
function scheduleBinaryMatchingJob() {
    // Run at 00:05 every day
    cron.schedule('5 0 * * *', runBinaryMatching, {
        scheduled: true,
        timezone: "Asia/Kolkata"
    });
    console.log('[Cron Scheduler] Scheduled Binary leg matching job successfully.');
}

module.exports = {
    runBinaryMatching,
    scheduleBinaryMatchingJob
};
