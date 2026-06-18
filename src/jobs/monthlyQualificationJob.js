// src/jobs/monthlyQualificationJob.js
const cron = require('node-cron');
const db = require('../../db');
const { MLM_CONFIG } = require('../Services/mlmConfig');

const RANKS = [
    'CUSTOMER', 'DISTRIBUTOR_SILVER', 'DISTRIBUTOR_GOLD', 'DISTRIBUTOR_DIAMOND',
    'LEADER', 'TEAM_LEADER', 'ASSISTANT_SUPERVISOR', 'SUPERVISOR',
    'ASSISTANT_MANAGER', 'MANAGER', 'SR_MANAGER', 'DIRECTOR'
];

const hasRequiredRank = (userRank, requiredRank) => {
    return RANKS.indexOf(userRank) >= RANKS.indexOf(requiredRank);
};

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
        await connection.query(`UPDATE users SET current_monthly_qualified_rank = \`rank\` WHERE is_blocked = FALSE`);

        // Step 4: Check qualifications for "Leaders and above"
        const leaderIndex = RANKS.indexOf('LEADER');
        const ranksToCheck = RANKS.slice(leaderIndex);

        const [usersToCheck] = await connection.query(
            `SELECT id, \`rank\`, last_12_months_repurchase_bv, last_rank_promoted_at, created_at FROM users WHERE \`rank\` IN (?) AND is_blocked = FALSE`,
            [ranksToCheck]
        );

        const rules = MLM_CONFIG.MONTHLY_QUALIFICATION_RULES;

        for (const user of usersToCheck) {
            let isQualified = false;
            const isTeamLeaderOrAbove = hasRequiredRank(user.rank, 'TEAM_LEADER');
            const required12MonthBv = isTeamLeaderOrAbove ? 12000 : 3000;

            // 1. Check primary 12-month repurchase target
            if (user.last_12_months_repurchase_bv >= required12MonthBv) {
                isQualified = true;
            } else {
                // 2. Check 2nd Option: 6000 BV within last 3 months (Leaders) or 24000 BV within last 6 months (Team Leaders+)
                if (isTeamLeaderOrAbove) {
                    const [recent6MonthRows] = await connection.query(
                        `SELECT IFNULL(SUM(bv_earned), 0) as recent_bv 
                         FROM user_business_volume 
                         WHERE user_id = ? AND bv_type = 'SELF' 
                           AND transaction_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)`,
                        [user.id]
                    );
                    if (parseFloat(recent6MonthRows[0].recent_bv || 0) >= 24000) {
                        isQualified = true;
                    }
                } else {
                    const [recent3MonthRows] = await connection.query(
                        `SELECT IFNULL(SUM(bv_earned), 0) as recent_bv 
                         FROM user_business_volume 
                         WHERE user_id = ? AND bv_type = 'SELF' 
                           AND transaction_date >= DATE_SUB(NOW(), INTERVAL 3 MONTH)`,
                        [user.id]
                    );
                    if (parseFloat(recent3MonthRows[0].recent_bv || 0) >= 6000) {
                        isQualified = true;
                    }
                }
            }

            // 3. If still failed, check the new sponsors alternative
            if (!isQualified) {
                const ruleHRanks = ['LEADER', 'TEAM_LEADER', 'ASSISTANT_SUPERVISOR', 'SUPERVISOR', 'ASSISTANT_MANAGER', 'MANAGER'];
                if (ruleHRanks.includes(user.rank)) {
                    const afterDate = user.last_rank_promoted_at || user.created_at;
                    const { checkRuleHQualification } = require('../Services/rankService');
                    const ruleHPassed = await checkRuleHQualification(user.id, afterDate, connection);
                    if (ruleHPassed) {
                        isQualified = true;
                    }
                } else {
                    const [newSponsors] = await connection.query(`
                        SELECT COUNT(id) as count, SUM(aggregate_personal_bv) as total_bv FROM users 
                        WHERE sponsor_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH) AND last_purchase_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
                    `, [user.id]);
                    if (newSponsors.length > 0 && newSponsors[0].count >= rules.NEW_SPONSORS_ALTERNATIVE_COUNT && newSponsors[0].total_bv >= rules.NEW_SPONSORS_ALTERNATIVE_BV) {
                        isQualified = true;
                    }
                }
            }

            // 4. Update qualification status if disqualified
            if (!isQualified) {
                await connection.query(`UPDATE users SET current_monthly_qualified_rank = 'DISTRIBUTOR_DIAMOND' WHERE id = ?`, [user.id]);
            }
        }

        // Step 5: Check and cache qualifying direct sponsor status (the 6-month active rule)
        // Store direct sponsor active status as a JSON mapping in qualifying_sponsor_ids column for downstream check
        const [allUsers] = await connection.query("SELECT id, sponsor_id FROM users WHERE is_deleted = 0");
        const userMap = {};
        allUsers.forEach(u => {
            userMap[u.id] = u;
        });

        for (const u of allUsers) {
            if (u.sponsor_id) {
                const sponsor = userMap[u.sponsor_id];
                if (sponsor) {
                    const [sponsorPurchaseRow] = await connection.query(
                        "SELECT last_purchase_date FROM users WHERE id = ?",
                        [sponsor.id]
                    );
                    const lastPurchase = sponsorPurchaseRow[0]?.last_purchase_date;
                    let active = true;
                    if (!lastPurchase) {
                        active = false;
                    } else {
                        const sixMonthsAgo = new Date();
                        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
                        if (new Date(lastPurchase) < sixMonthsAgo) {
                            active = false;
                        }
                    }
                    const mapping = {
                        sponsor_id: sponsor.id,
                        is_active: active,
                        last_purchase_date: lastPurchase
                    };
                    await connection.query(
                        "UPDATE users SET qualifying_sponsor_ids = ? WHERE id = ?",
                        [JSON.stringify(mapping), u.id]
                    );
                }
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

// For testing purposes
exports.runMonthlyQualificationCheckManual = runMonthlyQualificationCheck;