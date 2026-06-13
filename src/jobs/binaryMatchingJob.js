// src/jobs/binaryMatchingJob.js
const cron = require('node-cron');
const db = require('../../db');
const moment = require('moment-timezone');

/**
 * Helper to calculate binary depth level for a user (number of parents up to the root)
 */
async function getBinaryUserDepth(connection, userId) {
    let depth = 0;
    let currentId = userId;
    while (currentId) {
        const [parentRows] = await connection.query(
            "SELECT binary_placement_id FROM users WHERE id = ?",
            [currentId]
        );
        if (!parentRows.length || !parentRows[0].binary_placement_id) {
            break;
        }
        currentId = parentRows[0].binary_placement_id;
        depth++;
    }
    return depth;
}

/**
 * Main Same-Depth Binary Matching Logic (Rule 2)
 * Traverses all active users, groups unmatched BV entries by depth (level),
 * performs FIFO matching separately for each depth, applies slab-based payout rates (5% down to 1%),
 * checks Rs 5,000 monthly capping limit, deducts matched BV, and updates wallet & ledgers.
 */
async function runBinaryMatching() {
    console.log('[Binary Job] Starting Binary Matching Payout execution...');
    const connection = await db.getConnection();
    
    try {
        // Fetch all active, non-deleted users who have BV in left and right legs
        const [users] = await connection.query(
            "SELECT id, username, left_leg_bv, right_leg_bv, total_matched_bv FROM users WHERE is_deleted = 0 AND is_blocked = 0 AND (left_leg_bv > 0 AND right_leg_bv > 0)"
        );

        console.log(`[Binary Job] Found ${users.length} users qualified for binary matching evaluation.`);

        const startOfMonth = moment().tz("Asia/Kolkata").startOf('month').format("YYYY-MM-DD HH:mm:ss");
        const endOfMonth = moment().tz("Asia/Kolkata").endOf('month').format("YYYY-MM-DD HH:mm:ss");

        for (const user of users) {
            console.log(`\n[Binary Job Debug] ===== Evaluating matching for user: ${user.username} (ID: ${user.id}) =====`);
            console.log(`[Binary Job Debug] Current aggregate values in users table: left_leg_bv: ${user.left_leg_bv}, right_leg_bv: ${user.right_leg_bv}`);
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
                console.log(`[Binary Job Debug] Monthly payout status: Already paid this month: ₹${currentMonthPayout.toFixed(2)}, Remaining limit: ₹${remainingLimit.toFixed(2)}`);

                if (remainingLimit <= 0) {
                    console.log(`[Binary Job Debug] User ${user.username} has hit the Rs. ${cappingLimit} monthly capping limit. Skipping match.`);
                    await connection.rollback();
                    continue;
                }

                // 2. Fetch all unmatched detailed entries for this user, joining users to get source buyer username
                const [entries] = await connection.query(
                    `SELECT e.id, e.bv_amount, e.matched_amount, e.leg, e.depth, e.source_user_id, e.order_id, u.username as source_username 
                     FROM user_binary_bv_entries e
                     JOIN users u ON e.source_user_id = u.id 
                     WHERE e.user_id = ? AND e.bv_amount > e.matched_amount 
                     ORDER BY e.id ASC`,
                    [user.id]
                );

                console.log(`[Binary Job Debug] Found ${entries.length} unmatched entries in user_binary_bv_entries table.`);

                if (entries.length === 0) {
                    console.log(`[Binary Job Debug] No unmatched entries found for ${user.username}. Skipping.`);
                    await connection.rollback();
                    continue;
                }

                // Group entries by depth and leg
                const leftByDepth = {};
                const rightByDepth = {};

                for (const entry of entries) {
                    const depth = entry.depth;
                    const leg = entry.leg;
                    const unmatchedAmount = parseFloat(entry.bv_amount) - parseFloat(entry.matched_amount);
                    if (unmatchedAmount <= 0) continue;

                    console.log(`[Binary Job Debug] Unmatched Entry -> ID: ${entry.id}, leg: ${leg}, depth: ${depth}, total_bv: ${entry.bv_amount}, unmatched: ${unmatchedAmount.toFixed(2)} (Buyer: ${entry.source_username}, Order ID: ${entry.order_id})`);

                    const targetMap = leg === 'LEFT' ? leftByDepth : rightByDepth;
                    if (!targetMap[depth]) {
                        targetMap[depth] = [];
                    }
                    targetMap[depth].push({
                        id: entry.id,
                        unmatched: unmatchedAmount,
                        source_username: entry.source_username,
                        order_id: entry.order_id
                    });
                }

                // Find unique depths present in both legs
                const leftDepths = Object.keys(leftByDepth).map(Number);
                const rightDepths = Object.keys(rightByDepth).map(Number);
                const commonDepths = leftDepths.filter(d => rightDepths.includes(d));

                console.log(`[Binary Job Debug] Grouping Results -> Left Depths: ${JSON.stringify(leftDepths)}, Right Depths: ${JSON.stringify(rightDepths)}`);
                console.log(`[Binary Job Debug] Common Depth levels to match: ${JSON.stringify(commonDepths)}`);

                if (commonDepths.length === 0) {
                    console.log(`[Binary Job Debug] No common depths found for user ${user.username}. Left and Right legs cannot match. Skipping.`);
                    await connection.rollback();
                    continue;
                }

                let totalMatchedBvThisRun = 0;
                let totalPayoutThisRun = 0;
                const dbUpdates = [];

                // Process matching by depth level
                for (const depth of commonDepths) {
                    const leftList = leftByDepth[depth];
                    const rightList = rightByDepth[depth];

                    console.log(`[Binary Job Debug] --- Processing match for DEPTH LEVEL: ${depth} ---`);
                    let leftIdx = 0;
                    let rightIdx = 0;

                    while (leftIdx < leftList.length && rightIdx < rightList.length) {
                        const leftEntry = leftList[leftIdx];
                        const rightEntry = rightList[rightIdx];

                        const matchQty = Math.min(leftEntry.unmatched, rightEntry.unmatched);
                        if (matchQty > 0) {
                            totalMatchedBvThisRun += matchQty;

                            // Determine percentage based on depth
                            let percentage = 1.00; // default 21+
                            if (depth <= 5) {
                                percentage = 5.00;
                            } else if (depth >= 6 && depth <= 10) {
                                percentage = 4.00;
                            } else if (depth >= 11 && depth <= 15) {
                                percentage = 3.00;
                            } else if (depth >= 16 && depth <= 20) {
                                percentage = 2.00;
                            }

                            const rawPayout = matchQty * (percentage / 100);
                            totalPayoutThisRun += rawPayout;

                            console.log(`[Binary Job Debug] Match Step: Left Entry ID ${leftEntry.id} (Buyer: ${leftEntry.source_username}, Order: ${leftEntry.order_id}) <-> Right Entry ID ${rightEntry.id} (Buyer: ${rightEntry.source_username}, Order: ${rightEntry.order_id})`);
                            console.log(`[Binary Job Debug] Match Qty: ${matchQty.toFixed(2)} BV at Depth ${depth}. Applied Rate: ${percentage}% (Slab: depth ${depth}), Payout: ₹${rawPayout.toFixed(2)} credited to ${user.username}`);

                            // Deduct unmatched amount in memory
                            leftEntry.unmatched -= matchQty;
                            rightEntry.unmatched -= matchQty;

                            // Queue DB updates for matching entries
                            dbUpdates.push({
                                query: "UPDATE user_binary_bv_entries SET matched_amount = matched_amount + ? WHERE id = ?",
                                params: [matchQty, leftEntry.id]
                            });
                            dbUpdates.push({
                                query: "UPDATE user_binary_bv_entries SET matched_amount = matched_amount + ? WHERE id = ?",
                                params: [matchQty, rightEntry.id]
                            });
                        }

                        if (leftEntry.unmatched === 0) leftIdx++;
                        if (rightEntry.unmatched === 0) rightIdx++;
                    }
                }

                if (totalMatchedBvThisRun <= 0) {
                    console.log(`[Binary Job Debug] Total matched BV in this run is 0. Skipping.`);
                    await connection.rollback();
                    continue;
                }

                // Apply capping limit to total payout amount
                let actualPayoutAmount = totalPayoutThisRun;
                let isCapped = false;

                if (totalPayoutThisRun > remainingLimit) {
                    actualPayoutAmount = remainingLimit;
                    isCapped = true;
                    console.log(`[Binary Job Debug] CAPPING TRIGGERED! Raw payout ₹${totalPayoutThisRun.toFixed(2)} exceeds remaining limit ₹${remainingLimit.toFixed(2)}. Adjusted payout: ₹${actualPayoutAmount.toFixed(2)}`);
                }

                // Credit payout to wallet & write ledgers if payout is > 0
                if (actualPayoutAmount > 0) {
                    console.log(`[Binary Job Debug] Crediting Payout of ₹${actualPayoutAmount.toFixed(2)} to User ID ${user.id} wallet.`);
                    // Update user's wallet balance
                    await connection.query(
                        "UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?",
                        [actualPayoutAmount, user.id]
                    );

                    // Insert wallet transaction ledger record
                    await connection.query(
                        `INSERT INTO user_wallet_transactions (user_id, txn_type, amount, source, remarks) 
                         VALUES (?, 'credit', ?, 'level_income', ?)`,
                        [
                            user.id, 
                            actualPayoutAmount, 
                            `Binary Matching: Same-Depth matches totaling ${totalMatchedBvThisRun.toFixed(2)} BV${isCapped ? ' [CAPPED]' : ''}`
                        ]
                    );

                    // Insert into unified commission_ledger
                    const averagePercentage = (totalPayoutThisRun > 0) ? (totalPayoutThisRun / totalMatchedBvThisRun) * 100 : 0;
                    await connection.query(
                        `INSERT INTO commission_ledger (user_id, source_user_id, source_order_id, commission_type, base_bv, percentage_applied, amount_credited, notes) 
                         VALUES (?, NULL, NULL, 'BINARY_MATCHING', ?, ?, ?, ?)`,
                        [
                            user.id,
                            totalMatchedBvThisRun,
                            averagePercentage,
                            actualPayoutAmount,
                            `Binary matching same-depth logic for user ${user.username}. Matched BV: ${totalMatchedBvThisRun.toFixed(2)}.${isCapped ? ' Exceeded monthly capping limit, adjusted payout.' : ''}`
                        ]
                    );

                    // Insert detailed matching payout log
                    await connection.query(
                        `INSERT INTO binary_matching_payouts (user_id, matched_bv, payout_percentage, payout_amount, remarks) 
                         VALUES (?, ?, ?, ?, ?)`,
                        [
                            user.id, 
                            totalMatchedBvThisRun, 
                            averagePercentage, 
                            actualPayoutAmount, 
                            `Matched ${totalMatchedBvThisRun.toFixed(2)} BV at Same-Depth. Raw: ₹${totalPayoutThisRun.toFixed(2)}, Paid: ₹${actualPayoutAmount.toFixed(2)}`
                        ]
                    );
                }

                // Execute database updates for matching entries
                console.log(`[Binary Job Debug] Running database updates for ${dbUpdates.length} matching entries...`);
                for (const update of dbUpdates) {
                    await connection.query(update.query, update.params);
                }

                // Deduct matched BV from left/right legs and update binary levels
                console.log(`[Binary Job Debug] Deducting matched ${totalMatchedBvThisRun.toFixed(2)} BV from aggregate left/right leg values in users table.`);
                await connection.query(
                    `UPDATE users 
                     SET left_leg_bv = GREATEST(0, left_leg_bv - ?), 
                         right_leg_bv = GREATEST(0, right_leg_bv - ?), 
                         total_matched_bv = total_matched_bv + ?,
                         binary_level_matched = binary_level_matched + 1
                     WHERE id = ?`,
                    [totalMatchedBvThisRun, totalMatchedBvThisRun, totalMatchedBvThisRun, user.id]
                );

                await connection.commit();
                console.log(`[Binary Match Success] User ID: ${user.id} (${user.username}) matched same-depth BV: ${totalMatchedBvThisRun.toFixed(2)}. Payout: ₹${actualPayoutAmount.toFixed(2)}`);

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
