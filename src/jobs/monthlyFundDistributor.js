// src/jobs/monthlyFundDistributor.js
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

// Helper: check sponsor activity from cached JSON
const isSponsorActiveCached = (qualifyingSponsorIdsJson) => {
    if (!qualifyingSponsorIdsJson) return true; // Default to true if not cached yet
    try {
        const parsed = typeof qualifyingSponsorIdsJson === 'string' 
            ? JSON.parse(qualifyingSponsorIdsJson) 
            : qualifyingSponsorIdsJson;
        return parsed.is_active !== false;
    } catch (e) {
        return true;
    }
};

// Helper queries using transaction connection
const getRolling12MonthTgbvHelper = async (connection, userId) => {
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, 1);
    const [rows] = await connection.query(
        `SELECT IFNULL(SUM(bv_earned), 0) as rolling_tgbv 
         FROM user_business_volume 
         WHERE user_id = ? AND bv_type = 'DOWNLINE' 
           AND transaction_date >= ?`,
        [userId, twelveMonthsAgo]
    );
    return parseFloat(rows[0].rolling_tgbv || 0);
};

const getRolling12MonthPersonalBvHelper = async (connection, userId) => {
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, 1);
    const [rows] = await connection.query(
        `SELECT IFNULL(SUM(bv_earned), 0) as rolling_pbv 
         FROM user_business_volume 
         WHERE user_id = ? AND bv_type = 'SELF' 
           AND transaction_date >= ?`,
        [userId, twelveMonthsAgo]
    );
    return parseFloat(rows[0].rolling_pbv || 0);
};

const checkSponsorsForReliefFundHelper = async (connection, userId) => {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const [newSponsors] = await connection.query(`
        SELECT id, aggregate_personal_bv FROM users 
        WHERE sponsor_id = ? AND created_at >= ? AND is_deleted = 0
    `, [userId, twelveMonthsAgo]);

    const fastStartSponsors = newSponsors.filter(s => parseFloat(s.aggregate_personal_bv) >= 3000).length;
    const min500BvSponsors = newSponsors.filter(s => parseFloat(s.aggregate_personal_bv) >= 500).length;

    const eligibleOption1 = fastStartSponsors >= 2;
    const eligibleOption2 = min500BvSponsors >= 4;
    const eligibleOption3 = fastStartSponsors >= 1 && min500BvSponsors >= 3;

    return eligibleOption1 || eligibleOption2 || eligibleOption3;
};

async function distributeFund(fundName, requiredRank, connection, yearMonth) {
    console.log(`[CRON] Processing ${fundName} for month ${yearMonth}...`);
    const poolColumn = fundName.toLowerCase().replace(/ /g, '_');
    const [pools] = await connection.query(`SELECT \`${poolColumn}\` as total_pool FROM monthly_company_pools WHERE \`year_month\` = ?`, [yearMonth]);
    const totalPoolAmount = pools.length > 0 ? parseFloat(pools[0].total_pool) : 0;
    if (totalPoolAmount <= 0) return;

    // Determine target TGBV and self BV requirements based on fundName
    let targetSelfBv = 1000;
    let targetTgbv = 50000;
    let maxMonths = 0;
    let monthsPaidField = "";
    let rewardType = "";

    switch(fundName) {
        case 'Leadership Fund':
            targetTgbv = 50000;
            rewardType = 'LEADERSHIP_FUND';
            break;
        case 'Travel Fund':
            targetTgbv = 75000;
            rewardType = 'TRAVEL_FUND';
            break;
        case 'Bike Fund':
            targetTgbv = 100000;
            maxMonths = 24;
            monthsPaidField = 'bike_fund_months_paid';
            rewardType = 'BIKE_FUND';
            break;
        case 'Car Fund':
            targetTgbv = 200000;
            maxMonths = 36;
            monthsPaidField = 'car_fund_months_paid';
            rewardType = 'CAR_FUND';
            break;
        case 'House Fund':
            targetTgbv = 200000;
            maxMonths = 60;
            monthsPaidField = 'house_fund_months_paid';
            rewardType = 'HOUSE_FUND';
            break;
        default:
            return;
    }

    const year = Math.floor(yearMonth / 100);
    const month = yearMonth % 100;

    const requiredRankIndex = RANKS.indexOf(requiredRank);
    const qualifiedRanks = RANKS.slice(requiredRankIndex);

    // Fetch potential candidates
    const [candidates] = await connection.query(`
        SELECT id, current_monthly_qualified_rank as \`rank\`, bike_fund_months_paid, car_fund_months_paid, house_fund_months_paid, qualifying_sponsor_ids 
        FROM users WHERE current_monthly_qualified_rank IN (?) AND is_blocked = FALSE AND is_deleted = 0`, [qualifiedRanks]);

    if (candidates.length === 0) return;

    const qualifiedUsers = [];

    for (const user of candidates) {
        // 1. Check months limit for capped funds
        if (maxMonths > 0) {
            const monthsPaid = user[monthsPaidField] || 0;
            if (monthsPaid >= maxMonths) continue;
        }

        // 2. Check sponsor activity
        const sponsorActive = isSponsorActiveCached(user.qualifying_sponsor_ids);
        if (!sponsorActive) continue;

        // 3. Calculate this user's monthly Personal BV & TGBV
        const [personalRows] = await connection.query(
            `SELECT IFNULL(SUM(bv_earned), 0) as personal_bv 
             FROM user_business_volume 
             WHERE user_id = ? AND bv_type = 'SELF' AND YEAR(transaction_date) = ? AND MONTH(transaction_date) = ?`,
            [user.id, year, month]
        );
        const personalBv = parseFloat(personalRows[0].personal_bv || 0);

        const [tgbvRows] = await connection.query(
            `SELECT IFNULL(SUM(bv_earned), 0) as tgbv 
             FROM user_business_volume 
             WHERE user_id = ? AND bv_type = 'DOWNLINE' AND YEAR(transaction_date) = ? AND MONTH(transaction_date) = ?`,
            [user.id, year, month]
        );
        const tgbv = parseFloat(tgbvRows[0].tgbv || 0);

        // 4. Validate targets
        if (personalBv >= targetSelfBv && tgbv >= targetTgbv) {
            qualifiedUsers.push({
                id: user.id,
                personalBv,
                tgbv
            });
        }
    }

    if (qualifiedUsers.length === 0) return;

    const totalPoints = qualifiedUsers.reduce((sum, u) => sum + u.personalBv, 0);
    if (totalPoints <= 0) return;

    const valuePerPoint = totalPoolAmount / totalPoints;

    for (const user of qualifiedUsers) {
        const poolShare = user.personalBv * valuePerPoint;
        let payout = poolShare;

        // Bike Fund minimum guarantee rule
        if (rewardType === 'BIKE_FUND' && payout < 2500) {
            payout = 2500;
        }

        if (payout > 0) {
            const [existing] = await connection.query(
                "SELECT id FROM reward_claims WHERE user_id = ? AND reward_type = ? AND claim_month = ?",
                [user.id, rewardType, yearMonth]
            );

            const details = {
                payout_amount: payout,
                pool_share: poolShare,
                tgbv: user.tgbv,
                personal_bv: user.personalBv,
                calculation_notes: `Pool size: ${totalPoolAmount}, Points: ${totalPoints}, Value per point: ${valuePerPoint}`
            };

            if (existing.length > 0) {
                await connection.query(
                    "UPDATE reward_claims SET user_details = ?, updated_at = NOW() WHERE id = ?",
                    [JSON.stringify(details), existing[0].id]
                );
            } else {
                await connection.query(
                    `INSERT INTO reward_claims (user_id, reward_type, claim_month, status, user_details) 
                     VALUES (?, ?, ?, 'PENDING', ?)`,
                    [user.id, rewardType, yearMonth, JSON.stringify(details)]
                );
            }
            console.log(`[CRON] Generated claim for ${fundName}: User ${user.id} can claim ₹${payout.toFixed(2)}`);
        }
    }

    // Reset the pool column in the database after successful processing
    await connection.query(
        `UPDATE \`monthly_company_pools\` SET \`${poolColumn}\` = 0.00 WHERE \`year_month\` = ?`,
        [yearMonth]
    );
    console.log(`[CRON] Reset pool column \`${poolColumn}\` to 0.00 for year_month ${yearMonth}`);
}

async function distributeReliefFund(connection, yearMonth) {
    console.log(`[CRON] Processing Relief Fund for month ${yearMonth}...`);
    
    const year = Math.floor(yearMonth / 100);
    const month = yearMonth % 100;

    // Get previous 12 months keys
    const yearMonthKeys = [];
    for (let i = 0; i < 12; i++) {
        const d = new Date(year, month - 1 - i, 1);
        yearMonthKeys.push(d.getFullYear() * 100 + (d.getMonth() + 1));
    }

    const [pools] = await connection.query(
        `SELECT SUM(bonus_relief_fund) as total_relief_pool FROM monthly_company_pools WHERE year_month IN (?)`,
        [yearMonthKeys]
    );
    const totalReliefPool = pools.length > 0 ? parseFloat(pools[0].total_relief_pool) : 0;
    if (totalReliefPool <= 0) return;

    // Fetch Senior Managers or above
    const [candidates] = await connection.query(
        "SELECT id, `rank` FROM users WHERE `rank` IN ('SR_MANAGER', 'DIRECTOR') AND is_blocked = FALSE AND is_deleted = 0"
    );

    const qualifiedUsers = [];

    for (const user of candidates) {
        const rollingTgbv = await getRolling12MonthTgbvHelper(connection, user.id);
        const rollingPersonalBv = await getRolling12MonthPersonalBvHelper(connection, user.id);
        const hasSponsors = await checkSponsorsForReliefFundHelper(connection, user.id);

        if (rollingPersonalBv >= 12000 && rollingTgbv >= 5000000 && hasSponsors) {
            qualifiedUsers.push({
                id: user.id,
                personalBv: rollingPersonalBv
            });
        }
    }

    if (qualifiedUsers.length === 0) return;

    const totalPoints = qualifiedUsers.reduce((sum, u) => sum + u.personalBv, 0);
    if (totalPoints <= 0) return;

    const valuePerPoint = totalReliefPool / totalPoints;

    for (const user of qualifiedUsers) {
        const payout = user.personalBv * valuePerPoint;
        if (payout > 0) {
            const [existing] = await connection.query(
                "SELECT id FROM reward_claims WHERE user_id = ? AND reward_type = 'RELIEF_FUND' AND claim_month = ?",
                [user.id, yearMonth]
            );

            const details = {
                payout_amount: payout,
                personal_bv: user.personalBv,
                total_relief_pool: totalReliefPool,
                calculation_notes: `Annual Relief Fund run. Pool: ${totalReliefPool}, Points: ${totalPoints}`
            };

            if (existing.length > 0) {
                await connection.query(
                    "UPDATE reward_claims SET user_details = ?, updated_at = NOW() WHERE id = ?",
                    [JSON.stringify(details), existing[0].id]
                );
            } else {
                await connection.query(
                    `INSERT INTO reward_claims (user_id, reward_type, claim_month, status, user_details) 
                     VALUES (?, 'RELIEF_FUND', ?, 'PENDING', ?)`,
                    [user.id, yearMonth, JSON.stringify(details)]
                );
            }
            console.log(`[CRON] Generated Relief Fund claim for user ${user.id}: ₹${payout.toFixed(2)}`);
        }
    }

    // Reset relief fund pool values for the past 12 months
    await connection.query(
        "UPDATE monthly_company_pools SET bonus_relief_fund = 0.00 WHERE year_month IN (?)",
        [yearMonthKeys]
    );
}

async function runMonthlyFundDistribution() {
    console.log('[CRON] Starting Monthly Fund Distribution...');
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const lastMonth = new Date();
        lastMonth.setDate(0); // Go to the last day of the previous month
        const yearMonth = lastMonth.getFullYear() * 100 + (lastMonth.getMonth() + 1);

        await distributeFund('Leadership Fund', MLM_CONFIG.FUND_QUALIFICATION_RANKS.LEADERSHIP_FUND, connection, yearMonth);
        await distributeFund('Travel Fund', MLM_CONFIG.FUND_QUALIFICATION_RANKS.TRAVEL_FUND, connection, yearMonth);
        await distributeFund('Bike Fund', MLM_CONFIG.FUND_QUALIFICATION_RANKS.BIKE_FUND, connection, yearMonth);
        await distributeFund('Car Fund', MLM_CONFIG.FUND_QUALIFICATION_RANKS.CAR_FUND, connection, yearMonth);
        await distributeFund('House Fund', MLM_CONFIG.FUND_QUALIFICATION_RANKS.HOUSE_FUND, connection, yearMonth);
        await distributeReliefFund(connection, yearMonth);

        await connection.commit();
        console.log('[CRON] Monthly Fund Distribution finished successfully.');
    } catch (err) {
        await connection.rollback();
        console.error(err);
    } finally {
        connection.release();
    }
}

exports.scheduleFundJob = () => {
    cron.schedule('0 3 5 * *', runMonthlyFundDistribution, { scheduled: true, timezone: "Asia/Kolkata" });
};

exports.runImmediateFundDistributionForTesting = async (connection) => {
    console.log('[TESTING] Starting Immediate Fund Distribution...');
    try {
        const currentMonth = new Date();
        const yearMonth = currentMonth.getFullYear() * 100 + (currentMonth.getMonth() + 1);

        await distributeFund('Leadership Fund', MLM_CONFIG.FUND_QUALIFICATION_RANKS.LEADERSHIP_FUND, connection, yearMonth);
        await distributeFund('Travel Fund', MLM_CONFIG.FUND_QUALIFICATION_RANKS.TRAVEL_FUND, connection, yearMonth);
        await distributeFund('Bike Fund', MLM_CONFIG.FUND_QUALIFICATION_RANKS.BIKE_FUND, connection, yearMonth);
        await distributeFund('Car Fund', MLM_CONFIG.FUND_QUALIFICATION_RANKS.CAR_FUND, connection, yearMonth);
        await distributeFund('House Fund', MLM_CONFIG.FUND_QUALIFICATION_RANKS.HOUSE_FUND, connection, yearMonth);
        await distributeReliefFund(connection, yearMonth);

        console.log('[TESTING] Immediate Fund Distribution finished successfully.');
    } catch (err) {
        console.error('[TESTING] Error in Immediate Fund Distribution:', err);
        throw err;
    }
};

exports.runMonthlyFundDistributionDirect = runMonthlyFundDistribution;