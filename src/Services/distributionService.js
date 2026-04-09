// src/Services/distributionService.js
const db = require('../../db');

/**
 * Main Central Service for Profit-Based MLM Distribution (15 Funds Model)
 * Mapping correctly to actual User Rank names.
 */

exports.processOrderDistribution = async (connection, orderId) => {
    try {
        console.log(`[MLM Distribution] Starting processing for Order ID: ${orderId}`);

        // 1. Fetch Order Items & Profit Details
        const [orderRows] = await connection.query("SELECT o.user_id, u.sponsor_id, u.rank FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = ?", [orderId]);
        if (!orderRows.length) return;

        const buyerId = orderRows[0].user_id;
        const buyerSponsorId = orderRows[0].sponsor_id;
        const buyerRank = orderRows[0].rank || 'Customer';

        // 2. Fetch All Distribution Rules from app_settings
        const [settingsRows] = await connection.query("SELECT setting_key, setting_value FROM app_settings");
        const settings = settingsRows.reduce((acc, s) => { acc[s.setting_key] = parseFloat(s.setting_value); return acc; }, {});

        const companySharePct = settings.profit_company_share_pct || 20.0;
        const yearMonth = new Date().getFullYear() * 100 + (new Date().getMonth() + 1);

        // 3. Get Order Items (FIXED JOIN for GST)
        const [items] = await connection.query(`
            SELECT oi.id as order_item_id, oi.price_per_unit, oi.quantity, sp.purchase_price, h.gst_percentage
            FROM order_items oi
            JOIN seller_products sp ON oi.seller_product_id = sp.id
            JOIN products p ON sp.product_id = p.id
            LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
            WHERE oi.order_id = ?`, [orderId]);

        for (const item of items) {
            // A. Calculate Net Profit on Item (Anti-Tax Base Price)
            const basePrice = item.price_per_unit / (1 + ((item.gst_percentage || 0) / 100));
            const netProfitOnItem = (basePrice - item.purchase_price) * item.quantity;
            
            if (netProfitOnItem <= 0) {
                console.log(`[MLM] Skipping Distribution: Profit on item ${item.order_item_id} is 0 or negative.`);
                continue;
            }

            // B. Calculate Distributable Profit (80% by default)
            const distributableProfit = netProfitOnItem * ((100 - companySharePct) / 100);
            console.log(`[MLM] Net Profit: ${netProfitOnItem.toFixed(2)}, Distributable (80%): ${distributableProfit.toFixed(2)}`);

            // --- 4. START 15-FUNDS DISTRIBUTION ---

            // FUND 1: CASHBACK (29% Instant to Buyer)
            const cashbackAmt = distributableProfit * (settings.profit_dist_cashback_pct / 100);
            if (cashbackAmt > 0) {
                console.log(`[MLM] Cashback: ₹${cashbackAmt.toFixed(2)} to User ID ${buyerId}`);
                await recordProfitEntry(connection, buyerId, item.order_item_id, 'CASHBACK', netProfitOnItem, distributableProfit, settings.profit_dist_cashback_pct, cashbackAmt);
                await updateWallet(connection, buyerId, cashbackAmt);
            }

            // FUND 2: PERFORMANCE BONUS (4.5% Budget - Differential Logic)
            await distributeDifferentialBonus(connection, buyerId, buyerSponsorId, item.order_item_id, netProfitOnItem, distributableProfit, settings.profit_dist_performance_bonus_pct);

            // FUND 3: ROYALTY FUND (2.0% Budget - Rank Level Logic)
            await distributeRoyaltyBonus(connection, buyerId, buyerSponsorId, item.order_item_id, netProfitOnItem, distributableProfit, settings.profit_dist_royalty_pct);

            // REMAINING 12 FUNDS -> UPDATE MONTHLY POOLS
            const poolUpdates = {
                binary_income_fund: (distributableProfit * (settings.profit_dist_binary_income_pct || 0)) / 100,
                gift_reward_fund: (distributableProfit * (settings.profit_dist_gift_reward_pct || 0)) / 100,
                leadership_fund: (distributableProfit * (settings.profit_dist_leadership_pct || 0)) / 100,
                travel_fund: (distributableProfit * (settings.profit_dist_travel_pct || 0)) / 100,
                bike_fund: (distributableProfit * (settings.profit_dist_bike_pct || 0)) / 100,
                car_fund: (distributableProfit * (settings.profit_dist_car_pct || 0)) / 100,
                house_fund: (distributableProfit * (settings.profit_dist_house_pct || 0)) / 100,
                insurance_fund: (distributableProfit * (settings.profit_dist_insurance_pct || 0)) / 100,
                bonus_relief_fund: (distributableProfit * (settings.profit_dist_bonus_relief_pct || 0)) / 100,
                company_tour_fund: (distributableProfit * (settings.profit_dist_company_tour_pct || 0)) / 100,
                company_programme_fund: (distributableProfit * (settings.profit_dist_company_programme_pct || 0)) / 100,
                company_misc_expenses_fund: (distributableProfit * (settings.profit_dist_misc_expenses_pct || 0)) / 100,
                retailer_fund: (distributableProfit * (settings.profit_dist_retailer_merchandise_pct || 0)) / 100
            };

            await updateMonthlyPools(connection, yearMonth, poolUpdates);
        }

        console.log(`[MLM Distribution] Successfully completed for Order ID: ${orderId}`);
    } catch (err) {
        console.error(`[MLM Distribution Error] Order ID: ${orderId}:`, err);
        throw err;
    }
};

/**
 * PERFORMANCE BONUS (Differential Gap Logic) using exact Rank Names
 */
async function distributeDifferentialBonus(connection, buyerId, sponsorId, orderItemId, netProfit, distributableProfit, totalBudgetPct) {
    let lastPaidPct = 0;
    let currentSponsorId = sponsorId;

    // Mapping exact Rank Names (Silver=1 step, Gold=2 steps, Diamond+=3 steps of the 4.5% budget)
    const rankMultipliers = {
        'Customer': 0,
        'Distributor (Silver)': 1,
        'Distributor (Gold)': 2,
        'Distributor (Diamond)': 3,
        'Leader': 3,
        'Team Leader': 3,
        'Assistant Supervisor': 3,
        'Supervisor': 3,
        'Assistant Manager': 3,
        'Manager': 3,
        'Sr. Manager': 3,
        'Director (Branch Head)': 3
    };

    while (currentSponsorId) {
        const [sponsors] = await connection.query("SELECT id, sponsor_id, rank FROM users WHERE id = ?", [currentSponsorId]);
        if (!sponsors.length) break;

        const sponsor = sponsors[0];
        const multiplier = rankMultipliers[sponsor.rank] || 0; 
        const sponsorMaxPct = (multiplier * (totalBudgetPct / 3));
        const gapPct = sponsorMaxPct - lastPaidPct;

        if (gapPct > 0) {
            const amt = distributableProfit * (gapPct / 100);
            console.log(`[MLM] Performance Bonus: ₹${amt.toFixed(2)} to ${sponsor.rank} (ID: ${sponsor.id})`);
            await recordProfitEntry(connection, sponsor.id, orderItemId, 'PERFORMANCE_BONUS', netProfit, distributableProfit, gapPct, amt);
            await updateWallet(connection, sponsor.id, amt);
            lastPaidPct = sponsorMaxPct;
        }

        if (lastPaidPct >= totalBudgetPct) break; 
        currentSponsorId = sponsor.sponsor_id;
    }
}

/**
 * ROYALTY BONUS (Diamond Level Logic) using exact Rank Names
 */
async function distributeRoyaltyBonus(connection, buyerId, sponsorId, orderItemId, netProfit, distributableProfit, totalBudgetPct) {
    let level = 1;
    let currentSponsorId = sponsorId;
    const royaltyLevels = { 1: 1.0, 2: 0.6, 3: 0.4 }; 

    const diamondAndAbove = [
        'Distributor (Diamond)', 'Leader', 'Team Leader', 'Assistant Supervisor', 
        'Supervisor', 'Assistant Manager', 'Manager', 'Sr. Manager', 'Director (Branch Head)'
    ];

    while (currentSponsorId && level <= 3) {
        const [sponsors] = await connection.query("SELECT id, sponsor_id, rank FROM users WHERE id = ?", [currentSponsorId]);
        if (!sponsors.length) break;

        const sponsor = sponsors[0];
        if (diamondAndAbove.includes(sponsor.rank)) {
            const rate = royaltyLevels[level] || 0;
            if (rate > 0) {
                const amt = distributableProfit * (rate / 100);
                console.log(`[MLM] Royalty L${level}: ₹${amt.toFixed(2)} to User ID ${sponsor.id}`);
                await recordProfitEntry(connection, sponsor.id, orderItemId, `ROYALTY_L${level}`, netProfit, distributableProfit, rate, amt);
                await updateWallet(connection, sponsor.id, amt);
            }
            level++;
        }
        currentSponsorId = sponsor.sponsor_id;
    }
}

/**
 * HELPER: Record Entry in Ledger
 */
async function recordProfitEntry(connection, userId, orderItemId, type, netProfit, distributableAmt, pctApplied, amtCredited) {
    if (amtCredited <= 0) return;
    await connection.query(
        `INSERT INTO profit_distribution_ledger (order_item_id, user_id, distribution_type, total_profit_on_item, distributable_amount, percentage_applied, amount_credited) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [orderItemId, userId, type, netProfit, distributableAmt, pctApplied, amtCredited]
    );
}

/**
 * HELPER: Update User Wallet
 */
async function updateWallet(connection, userId, amount) {
    if (amount <= 0) return;
    await connection.query('UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?', [amount, userId]);
}

/**
 * HELPER: Update Monthly Company Pools (Fixed SQL Grammar)
 */
async function updateMonthlyPools(connection, yearMonth, pools) {
    const keys = Object.keys(pools);
    const values = Object.values(pools);
    
    // Check if total pool contribution is positive to avoid redundant queries
    const totalPoolAmt = values.reduce((sum, v) => sum + v, 0);
    if (totalPoolAmt <= 0) return;

    // Use backticks and manual placeholders for the UPDATE part
    const updateParts = keys.map(key => `\`${key}\` = \`${key}\` + ?`).join(', ');
    const columns = ['\`year_month\`', ...keys.map(k => `\`${k}\``)].join(', ');
    const placeholders = ['?', ...keys.map(() => '?')].join(', ');
    
    await connection.query(
        `INSERT INTO \`monthly_company_pools\` (${columns})
         VALUES (${placeholders})
         ON DUPLICATE KEY UPDATE ${updateParts}`,
        [yearMonth, ...values, ...values]
    );
}
