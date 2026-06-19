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
        const [orderRows] = await connection.query("SELECT o.user_id, u.sponsor_id, u.`rank` FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = ?", [orderId]);
        if (!orderRows.length) return;

        const buyerId = orderRows[0].user_id;
        const buyerSponsorId = orderRows[0].sponsor_id;
        const buyerRank = orderRows[0].rank || 'CUSTOMER';

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
                await recordProfitEntry(connection, buyerId, item.order_item_id, 'CASHBACK', netProfitOnItem, distributableProfit, settings.profit_dist_cashback_pct, cashbackAmt, buyerId, orderId);
                await updateWallet(connection, buyerId, cashbackAmt);
            }

            // FUND 2: PERFORMANCE BONUS (4.5% Budget - Differential Logic)
            await distributeDifferentialBonus(connection, buyerId, buyerSponsorId, item.order_item_id, netProfitOnItem, distributableProfit, settings.profit_dist_performance_bonus_pct, orderId);

            // FUND 3: ROYALTY FUND (2.0% Budget - Rank Level Logic)
            await distributeRoyaltyBonus(connection, buyerId, buyerSponsorId, item.order_item_id, netProfitOnItem, distributableProfit, settings.profit_dist_royalty_pct, orderId);

            // REMAINING FUNDS -> UPDATE MONTHLY POOLS
            const poolUpdates = {
                cash_back_fund: (distributableProfit * (settings.profit_dist_cashback_pct || 0)) / 100,
                performance_bonus_fund: (distributableProfit * (settings.profit_dist_performance_bonus_pct || 0)) / 100,
                royalty_fund: (distributableProfit * (settings.profit_dist_royalty_pct || 0)) / 100,
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

        // =========================================================================
        // 🚨 DELETE AFTER TESTING: START
        // -------------------------------------------------------------------------
        // const fundDistributor = require('../jobs/monthlyFundDistributor');
        // await fundDistributor.runImmediateFundDistributionForTesting(connection);
        // -------------------------------------------------------------------------
        // 🚨 DELETE AFTER TESTING: END
        // =========================================================================

        console.log(`[MLM Distribution] Successfully completed for Order ID: ${orderId}`);
    } catch (err) {
        console.error(`[MLM Distribution Error] Order ID: ${orderId}:`, err);
        throw err;
    }
};

/**
 * PERFORMANCE BONUS (Differential Gap Logic) using exact Rank Names
 * Based on slide calculations: Silver = 3% of BV (20% of customer cashback), Gold = 6% of BV (40%), Diamond+ = 9% of BV (60%)
 */
async function distributeDifferentialBonus(connection, buyerId, sponsorId, orderItemId, netProfit, distributableProfit, totalBudgetPct, orderId) {
    // 1. Fetch item BV from order_items
    const [itemRows] = await connection.query("SELECT total_bv_earned FROM order_items WHERE id = ?", [orderItemId]);
    const itemBv = itemRows.length ? parseFloat(itemRows[0].total_bv_earned) : 0;
    if (itemBv <= 0) {
        console.log(`[MLM] Performance Bonus: Skipping, total BV for item ${orderItemId} is 0.`);
        return;
    }

    let lastPaidPct = 0;
    let currentSponsorId = sponsorId;

    const rankBvRates = {
        'CUSTOMER': 0,
        'DISTRIBUTOR_SILVER': 3.0,    // 3% of BV
        'DISTRIBUTOR_GOLD': 6.0,      // 6% of BV
        'DISTRIBUTOR_DIAMOND': 9.0,   // 9% of BV
        'LEADER': 9.0,
        'TEAM_LEADER': 9.0,
        'ASSISTANT_SUPERVISOR': 9.0,
        'SUPERVISOR': 9.0,
        'ASSISTANT_MANAGER': 9.0,
        'MANAGER': 9.0,
        'SR_MANAGER': 9.0,
        'DIRECTOR': 9.0
    };

    while (currentSponsorId) {
        const [sponsors] = await connection.query("SELECT id, sponsor_id, `rank` FROM users WHERE id = ?", [currentSponsorId]);
        if (!sponsors.length) break;

        const sponsor = sponsors[0];
        const sponsorRate = rankBvRates[sponsor.rank] || 0;
        const gapPct = sponsorRate - lastPaidPct;

        if (gapPct > 0) {
            const amt = itemBv * (gapPct / 100);
            const nominalPct = gapPct; // Show the exact gap percentage on BV
            console.log(`[MLM] Performance Bonus: ₹${amt.toFixed(2)} to ${sponsor.rank} (ID: ${sponsor.id}), BV: ${itemBv}, gap: ${gapPct}%`);
            await recordProfitEntry(connection, sponsor.id, orderItemId, 'PERFORMANCE_BONUS', netProfit, distributableProfit, nominalPct, amt, buyerId, orderId);
            await updateWallet(connection, sponsor.id, amt);
            lastPaidPct = sponsorRate;
        }

        if (lastPaidPct >= 9.0) break;
        currentSponsorId = sponsor.sponsor_id;
    }
}

/**
 * ROYALTY BONUS (Diamond Level Logic) using exact Rank Names
 * Based on slide calculations: Diamond 2 gets 12% RI, Diamond 3 gets 8% RI, Diamond 4 gets 4% RI from the first Diamond's actual Performance Bonus (PB)
 */
async function distributeRoyaltyBonus(connection, buyerId, sponsorId, orderItemId, netProfit, distributableProfit, totalBudgetPct, orderId) {
    // 1. Fetch item BV from order_items
    const [itemRows] = await connection.query("SELECT total_bv_earned FROM order_items WHERE id = ?", [orderItemId]);
    const itemBv = itemRows.length ? parseFloat(itemRows[0].total_bv_earned) : 0;
    if (itemBv <= 0) return;

    let currentSponsorId = sponsorId;
    let diamondCount = 0;
    let highestRateBelowFirstDiamond = 0;
    let actualFirstDiamondBvRate = 9.0; // Default to full Diamond rate if no active uplines below

    const diamondAndAbove = [
        'DISTRIBUTOR_DIAMOND', 'LEADER', 'TEAM_LEADER', 'ASSISTANT_SUPERVISOR',
        'SUPERVISOR', 'ASSISTANT_MANAGER', 'MANAGER', 'SR_MANAGER', 'DIRECTOR'
    ];

    const rankBvRates = {
        'CUSTOMER': 0,
        'DISTRIBUTOR_SILVER': 3.0,
        'DISTRIBUTOR_GOLD': 6.0,
        'DISTRIBUTOR_DIAMOND': 9.0,
        'LEADER': 9.0,
        'TEAM_LEADER': 9.0,
        'ASSISTANT_SUPERVISOR': 9.0,
        'SUPERVISOR': 9.0,
        'ASSISTANT_MANAGER': 9.0,
        'MANAGER': 9.0,
        'SR_MANAGER': 9.0,
        'DIRECTOR': 9.0
    };

    const royaltyRates = {
        2: 12.0, // 12% of first Diamond's actual PB
        3: 8.0,  // 8% of first Diamond's actual PB
        4: 4.0   // 4% of first Diamond's actual PB
    };

    while (currentSponsorId && diamondCount < 4) {
        const [sponsors] = await connection.query("SELECT id, sponsor_id, `rank` FROM users WHERE id = ?", [currentSponsorId]);
        if (!sponsors.length) break;

        const sponsor = sponsors[0];
        const sponsorRate = rankBvRates[sponsor.rank] || 0;

        if (diamondAndAbove.includes(sponsor.rank)) {
            diamondCount++;
            
            // If this is the first Diamond we encounter, we calculate their actual PB rate
            if (diamondCount === 1) {
                actualFirstDiamondBvRate = Math.max(0, 9.0 - highestRateBelowFirstDiamond);
                console.log(`[MLM] First Diamond encountered: ID ${sponsor.id} (${sponsor.rank}). Highest rate below: ${highestRateBelowFirstDiamond}%. Actual PB rate: ${actualFirstDiamondBvRate}%`);
            } else {
                // For Diamond 2, 3, 4, calculate Royalty based on the first Diamond's actual PB
                const riRate = royaltyRates[diamondCount];
                const amt = itemBv * (actualFirstDiamondBvRate / 100) * (riRate / 100); 
                if (amt > 0) {
                    console.log(`[MLM] Royalty L${diamondCount} (${riRate}%): ₹${amt.toFixed(2)} to User ID ${sponsor.id} (Based on first Diamond PB rate: ${actualFirstDiamondBvRate}%)`);
                    await recordProfitEntry(connection, sponsor.id, orderItemId, `ROYALTY_L${diamondCount}`, netProfit, distributableProfit, riRate, amt, buyerId, orderId);
                    await updateWallet(connection, sponsor.id, amt);
                }
            }
        } else {
            // Keep track of the highest rate below the first Diamond
            if (diamondCount === 0) {
                if (sponsorRate > highestRateBelowFirstDiamond) {
                    highestRateBelowFirstDiamond = sponsorRate;
                }
            }
        }
        currentSponsorId = sponsor.sponsor_id;
    }
}

/**
 * HELPER: Record Entry in Ledger
 */
async function recordProfitEntry(connection, userId, orderItemId, type, netProfit, distributableAmt, pctApplied, amtCredited, buyerId, orderId) {
    if (amtCredited <= 0) return;

    // 1. Record in Legacy Profit Ledger (Existing)
    await connection.query(
        `INSERT INTO profit_distribution_ledger (order_item_id, user_id, distribution_type, total_profit_on_item, distributable_amount, percentage_applied, amount_credited) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [orderItemId, userId, type, netProfit, distributableAmt, pctApplied, amtCredited]
    );

    // 2. Record in Unified Commission Ledger (New - used by Admin Reports)
    // We use total_profit_on_item as base_bv for now if real BV isn't passed here
    await connection.query(
        `INSERT INTO commission_ledger (user_id, source_user_id, source_order_id, commission_type, base_bv, percentage_applied, amount_credited, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, buyerId, orderId, type, netProfit, pctApplied, amtCredited, `Profit from Order Item #${orderItemId}`]
    );

    // 3. Record in User Wallet Transactions (for unified user passbook history)
    await connection.query(
        `INSERT INTO user_wallet_transactions (user_id, txn_type, amount, source, reference_id, remarks) 
         VALUES (?, 'credit', ?, 'level_income', ?, ?)`,
        [
            userId, 
            amtCredited, 
            `ORDER_${orderId}`, 
            `${type.replace(/_/g, ' ')}: ₹${amtCredited.toFixed(2)} from Order #${orderId}`
        ]
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
