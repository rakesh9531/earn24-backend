// src/jobs/monthlyFundDistributor.js
const cron = require('node-cron');
const db = require('../../db');
const { MLM_CONFIG } = require('../Services/mlmConfig');

async function recordFundCommission(data, connection) {
    // Write to Unified Commission Ledger
    await connection.query(
        `INSERT INTO commission_ledger (user_id, source_user_id, source_order_id, commission_type, base_bv, percentage_applied, amount_credited, notes) 
         VALUES (?, NULL, NULL, ?, ?, ?, ?, ?)`,
        [data.userId, data.type, data.baseBv, data.percentage, data.amount, data.notes]
    );

    // Update Wallet
    await connection.query('UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?', [data.amount, data.userId]);
}

async function distributeFund(fundName, requiredRank, connection, yearMonth) {
    console.log(`[CRON] Distributing ${fundName}...`);
    const poolColumn = fundName.toLowerCase().replace(/ /g, '_') + '_fund';
    const [pools] = await connection.query(`SELECT ${poolColumn} as total_pool FROM monthly_company_pools WHERE year_month = ?`, [yearMonth]);
    const totalPoolAmount = pools.length > 0 ? parseFloat(pools[0].total_pool) : 0;
    if (totalPoolAmount <= 0) return;

    const requiredRankIndex = MLM_CONFIG.RANKS.indexOf(requiredRank);
    const qualifiedRanks = MLM_CONFIG.RANKS.slice(requiredRankIndex);

    const [qualifiedUsers] = await connection.query(`
        SELECT id, last_12_months_repurchase_bv as personal_bv_points
        FROM users WHERE current_monthly_qualified_rank IN (?) AND is_blocked = FALSE`, [qualifiedRanks]);
    if (qualifiedUsers.length === 0) return;

    const totalPoints = qualifiedUsers.reduce((sum, user) => sum + parseFloat(user.personal_bv_points), 0);
    if (totalPoints <= 0) return;

    const valuePerPoint = totalPoolAmount / totalPoints;

    for (const user of qualifiedUsers) {
        const payout = user.personal_bv_points * valuePerPoint;
        if (payout > 0) {
            await recordFundCommission({ 
                userId: user.id, 
                amount: payout, 
                type: fundName.toUpperCase().replace(/ /g, '_'), 
                baseBv: totalPoolAmount, 
                percentage: (user.personal_bv_points / totalPoints) * 100, 
                notes: `Payout for ${fundName} (Points: ${user.personal_bv_points})`
            }, connection);
            console.log(`[CRON] Payout for ${fundName}: User ${user.id} gets ₹${payout.toFixed(2)}`);
        }
    }
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

        await connection.commit();
        console.log('[CRON] Monthly Fund Distribution finished successfully.');
    } catch(err) { await connection.rollback(); console.error(err); }
    finally { connection.release(); }
}

exports.scheduleFundJob = () => {
    cron.schedule('0 3 5 * *', runMonthlyFundDistribution, { scheduled: true, timezone: "Asia/Kolkata" });
};

// =========================================================================
// 🚨 DELETE AFTER TESTING: START (OPTIONAL)
// -------------------------------------------------------------------------
// Yeh testing function hai. Testing poori hone ke baad aap chahien toh is pure 
// function ko yahan se hata sakte hain.
exports.runImmediateFundDistributionForTesting = async (connection) => {
    console.log('[TESTING] Starting Immediate Fund Distribution...');
    try {
        // Sync rank for testing so immediate promotions are recognized
        await connection.query('UPDATE users SET current_monthly_qualified_rank = `rank` WHERE is_blocked = FALSE');

        const currentMonth = new Date(); 
        const yearMonth = currentMonth.getFullYear() * 100 + (currentMonth.getMonth() + 1);

        await distributeFund('Leadership Fund', MLM_CONFIG.FUND_QUALIFICATION_RANKS.LEADERSHIP_FUND, connection, yearMonth);
        await distributeFund('Travel Fund', MLM_CONFIG.FUND_QUALIFICATION_RANKS.TRAVEL_FUND, connection, yearMonth);
        await distributeFund('Bike Fund', MLM_CONFIG.FUND_QUALIFICATION_RANKS.BIKE_FUND, connection, yearMonth);
        await distributeFund('Car Fund', MLM_CONFIG.FUND_QUALIFICATION_RANKS.CAR_FUND, connection, yearMonth);
        await distributeFund('House Fund', MLM_CONFIG.FUND_QUALIFICATION_RANKS.HOUSE_FUND, connection, yearMonth);

        console.log('[TESTING] Immediate Fund Distribution finished successfully.');
    } catch(err) { 
        console.error('[TESTING] Error in Immediate Fund Distribution:', err); 
    }
};
// -------------------------------------------------------------------------
// 🚨 DELETE AFTER TESTING: END
// =========================================================================