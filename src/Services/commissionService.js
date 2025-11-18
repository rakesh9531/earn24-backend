// src/Services/commissionService.js
const db = require('../../db');
const rankService = require('./rankService');
const { MLM_CONFIG } = require('./mlmConfig');

async function recordCommission(commissionData, connection) {
    const { userId, amount, type, orderId, sourceUserId, baseBv, percentage, notes } = commissionData;
    if (amount <= 0) return;
    await connection.query(
        `INSERT INTO commission_ledger (user_id, amount_credited, commission_type, source_order_id, source_user_id, base_bv, percentage_applied, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, amount, type, orderId, sourceUserId, baseBv, percentage, notes]
    );
    await connection.query('UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?', [amount, userId]);
}

exports.processOrderForCommissions = async (orderId, appSettings) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [orders] = await connection.query('SELECT user_id, total_bv_earned FROM orders WHERE id = ?', [orderId]);
        if (!orders.length || orders[0].total_bv_earned <= 0) { await connection.commit(); return; }
        const totalOrderBV = parseFloat(orders[0].total_bv_earned);
        const buyerId = orders[0].user_id;
        
        const [buyerRows] = await connection.query('SELECT id, sponsor_id, rank, current_monthly_qualified_rank FROM users WHERE id = ?', [buyerId]);
        const buyer = buyerRows[0];
        const buyerPaidAsRank = buyer.current_monthly_qualified_rank || buyer.rank;

        // PART A: Allocate BV to Monthly Pools
        const yearMonth = new Date().getFullYear() * 100 + (new Date().getMonth() + 1);
        await connection.query(
            `INSERT INTO monthly_company_pools (year_month, total_company_bv, cash_back_fund, performance_bonus_fund, royalty_fund, binary_income_fund, gift_reward_fund, leadership_fund, travel_fund, bike_fund, car_fund, house_fund, insurance_fund, bonus_relief_fund, company_tour_fund, company_programme_fund, company_misc_expenses_fund, retailer_fund)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
             total_company_bv = total_company_bv + VALUES(total_company_bv), cash_back_fund = cash_back_fund + VALUES(cash_back_fund),
             performance_bonus_fund = performance_bonus_fund + VALUES(performance_bonus_fund), royalty_fund = royalty_fund + VALUES(royalty_fund),
             binary_income_fund = binary_income_fund + VALUES(binary_income_fund), gift_reward_fund = gift_reward_fund + VALUES(gift_reward_fund),
             leadership_fund = leadership_fund + VALUES(leadership_fund), travel_fund = travel_fund + VALUES(travel_fund),
             bike_fund = bike_fund + VALUES(bike_fund), car_fund = car_fund + VALUES(car_fund), house_fund = house_fund + VALUES(house_fund),
             insurance_fund = insurance_fund + VALUES(insurance_fund), bonus_relief_fund = bonus_relief_fund + VALUES(bonus_relief_fund),
             company_tour_fund = company_tour_fund + VALUES(company_tour_fund), company_programme_fund = company_programme_fund + VALUES(company_programme_fund),
             company_misc_expenses_fund = company_misc_expenses_fund + VALUES(company_misc_expenses_fund), retailer_fund = retailer_fund + VALUES(retailer_fund)`,
            [yearMonth, totalOrderBV, (totalOrderBV * appSettings.fund_pct_cash_back)/100, (totalOrderBV * appSettings.fund_pct_performance_bonus)/100, (totalOrderBV * appSettings.fund_pct_royalty)/100, (totalOrderBV * appSettings.fund_pct_binary_income)/100, (totalOrderBV * appSettings.fund_pct_gift_reward)/100, (totalOrderBV * appSettings.fund_pct_leadership)/100, (totalOrderBV * appSettings.fund_pct_travel)/100, (totalOrderBV * appSettings.fund_pct_bike)/100, (totalOrderBV * appSettings.fund_pct_car)/100, (totalOrderBV * appSettings.fund_pct_house)/100, (totalOrderBV * appSettings.fund_pct_insurance)/100, (totalOrderBV * appSettings.fund_pct_bonus_relief)/100, (totalOrderBV * appSettings.fund_pct_company_tour)/100, (totalOrderBV * appSettings.fund_pct_company_programme)/100, (totalOrderBV * appSettings.fund_pct_company_misc_expenses)/100, (totalOrderBV * appSettings.fund_pct_retailer)/100]
        );

        // PART B: Real-Time Commissions
        const cashbackAmount = (totalOrderBV * 15) / 100;
        await recordCommission({ userId: buyer.id, amount: cashbackAmount, type: 'SELF_CASHBACK', orderId, sourceUserId: buyer.id, baseBv: totalOrderBV, percentage: 15 }, connection);
        
        const selfPerformanceBonusRate = MLM_CONFIG.PERFORMANCE_BONUS_RATES[buyerPaidAsRank] || 0;
        if (selfPerformanceBonusRate > 0) {
            await recordCommission({ userId: buyer.id, amount: (totalOrderBV * selfPerformanceBonusRate)/100, type: 'SELF_PERFORMANCE_BONUS', orderId, sourceUserId: buyer.id, baseBv: totalOrderBV, percentage: selfPerformanceBonusRate }, connection);
        }

        let lastPaidPercent = selfPerformanceBonusRate;
        let currentSponsorId = buyer.sponsor_id;
        while (currentSponsorId) {
            const [sponsors] = await connection.query('SELECT id, sponsor_id, rank, current_monthly_qualified_rank FROM users WHERE id = ?', [currentSponsorId]);
            if (!sponsors.length) break;
            const sponsor = sponsors[0];
            const sponsorPaidAsRank = sponsor.current_monthly_qualified_rank || sponsor.rank;
            const sponsorPercent = MLM_CONFIG.PERFORMANCE_BONUS_RATES[sponsorPaidAsRank] || 0;
            const differentialPercent = sponsorPercent - lastPaidPercent;

            if (differentialPercent > 0) {
                await recordCommission({ userId: sponsor.id, amount: (totalOrderBV * differentialPercent)/100, type: 'PERFORMANCE_BONUS', orderId, sourceUserId: buyer.id, baseBv: totalOrderBV, percentage: differentialPercent }, connection);
            }
            lastPaidPercent = sponsorPercent;
            currentSponsorId = sponsor.sponsor_id;
            if (lastPaidPercent >= 30) break;
        }

        let royaltySponsorId = buyer.sponsor_id;
        while (royaltySponsorId) {
            const [sponsors] = await connection.query('SELECT id, sponsor_id, rank, current_monthly_qualified_rank FROM users WHERE id = ?', [royaltySponsorId]);
            if (!sponsors.length) break;
            const sponsor = sponsors[0];
            const sponsorPaidAsRank = sponsor.current_monthly_qualified_rank || sponsor.rank;
            const royaltyRate = MLM_CONFIG.ROYALTY_BONUS_RATES[sponsorPaidAsRank] || 0;
            if (royaltyRate > 0) {
                 await recordCommission({ userId: sponsor.id, amount: (totalOrderBV * royaltyRate)/100, type: 'ROYALTY_BONUS', orderId, sourceUserId: buyer.id, baseBv: totalOrderBV, percentage: royaltyRate }, connection);
            }
            royaltySponsorId = sponsor.sponsor_id;
        }

        // PART C: Update Volumes
        await connection.query('UPDATE users SET last_purchase_date = CURDATE(), aggregate_personal_bv = aggregate_personal_bv + ? WHERE id = ?', [totalOrderBV, buyer.id]);
        
        await connection.commit();
        rankService.checkAndPromoteUser(buyer.id).catch(console.error);

    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
};

exports.triggerCommissionProcessing = async (orderId) => {
    try {
        console.log(`[MLM] Triggering commission processing for Order ID: ${orderId}`);
        const [settingsRows] = await db.query("SELECT setting_key, setting_value FROM app_settings");
        const appSettings = settingsRows.reduce((acc, { setting_key, setting_value }) => ({ ...acc, [setting_key]: parseFloat(setting_value) }), {});
        await exports.processOrderForCommissions(orderId, appSettings);
        console.log(`[MLM] Successfully completed commission processing for Order ID: ${orderId}`);
    } catch (error) {
        console.error(`[MLM] CRITICAL ERROR during commission processing for Order ID: ${orderId}`, error);
    }
};