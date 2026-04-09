// src/Services/commissionService.js
const db = require('../../db');

/**
 * Enhanced Commission Service for BV Tracking (Self & Downline)
 */

exports.processOrderForCommissions = async (connection, orderId) => {
    try {
        console.log(`[BV Tracking] Starting processing for Order ID: ${orderId}`);

        // 1. Fetch Order Basics
        const [orderRows] = await connection.query("SELECT user_id FROM orders WHERE id = ?", [orderId]);
        if (!orderRows.length) return;
        const buyerId = orderRows[0].user_id;

        // 2. Fetch App Settings
        const [settingsRows] = await connection.query("SELECT setting_key, setting_value FROM app_settings");
        const settings = settingsRows.reduce((acc, s) => { acc[s.setting_key] = parseFloat(s.setting_value); return acc; }, {});

        const bvPct = settings.bv_generation_pct_of_profit || 80.0;
        const yearMonth = new Date().getFullYear() * 100 + (new Date().getMonth() + 1);

        // 3. Fetch Order Items for BV calculation
        const [items] = await connection.query(`
            SELECT oi.id, oi.price_per_unit, oi.quantity, sp.purchase_price, h.gst_percentage
            FROM order_items oi
            JOIN seller_products sp ON oi.seller_product_id = sp.id
            JOIN products p ON sp.product_id = p.id
            LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
            WHERE oi.order_id = ?`, [orderId]);

        let totalOrderBV = 0;

        for (const item of items) {
            const basePrice = item.price_per_unit / (1 + ((item.gst_percentage || 0) / 100));
            const netProfitPerUnit = basePrice - item.purchase_price;

            if (netProfitPerUnit > 0) {
                const bvPerUnit = netProfitPerUnit * (bvPct / 100);
                const totalBVForItem = bvPerUnit * item.quantity;
                totalOrderBV += totalBVForItem;

                // 1. Update individual order item with calculated BV
                await connection.query(
                    "UPDATE order_items SET bv_earned_per_unit = ?, total_bv_earned = ? WHERE id = ?",
                    [bvPerUnit, totalBVForItem, item.id]
                );

                // 2. INSERT into the Business Volume Ledger (This is what the Dashboard sums up)
                await connection.query(
                    `INSERT INTO user_business_volume 
                        (user_id, order_item_id, product_id, net_profit_base, bv_earned, transaction_date, notes) 
                     VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
                    [buyerId, item.id, item.product_id, netProfitPerUnit * item.quantity, totalBVForItem, `Self purchase: ${item.id}`]
                );
            }
        }

        if (totalOrderBV > 0) {
            // 3. Update Order Table total
            await connection.query("UPDATE orders SET total_bv_earned = ? WHERE id = ?", [totalOrderBV, orderId]);

            // 4. Update Buyer's BV Metrics (Sync all fields for both display and Rank Qualification)
            // aggregate_personal_bv is used by rankService for promotions
            // total_bv_self is used by some UI components
            // last_12_months_repurchase_bv handles rolling activity rules
            await connection.query(
                `UPDATE users SET 
                    aggregate_personal_bv = aggregate_personal_bv + ?, 
                    total_bv_self = total_bv_self + ?,
                    last_12_months_repurchase_bv = last_12_months_repurchase_bv + ?,
                    last_purchase_date = NOW()
                 WHERE id = ?`, 
                [totalOrderBV, totalOrderBV, totalOrderBV, buyerId]
            );

            // 5. Update Upline BV Metrics (Recursive traversal for team tracking)
            let currentSponsorId = null;
            const [buyerRows] = await connection.query("SELECT sponsor_id FROM users WHERE id = ?", [buyerId]);
            if (buyerRows.length > 0) currentSponsorId = buyerRows[0].sponsor_id;

            while (currentSponsorId) {
                const [sponsorRows] = await connection.query("SELECT id, sponsor_id FROM users WHERE id = ?", [currentSponsorId]);
                if (sponsorRows.length === 0) break;

                const sponsor = sponsorRows[0];
                // Update total_bv_downline for the sponsor
                await connection.query("UPDATE users SET total_bv_downline = total_bv_downline + ? WHERE id = ?", [totalOrderBV, sponsor.id]);
                
                currentSponsorId = sponsor.sponsor_id; // Move up to the next sponsor
            }

            // 6. Update Monthly Company Pool
            await connection.query(
                `INSERT INTO \`monthly_company_pools\` (\`year_month\`, \`total_company_bv\`) 
                 VALUES (?, ?) 
                 ON DUPLICATE KEY UPDATE \`total_company_bv\` = \`total_company_bv\` + ?`,
                [yearMonth, totalOrderBV, totalOrderBV]
            );
            
            console.log(`[BV Tracking] Success: Total BV: ${totalOrderBV} recorded for buyer ${buyerId} and upline.`);

            // 7. Check for potential Rank Promotion
            const rankService = require('./rankService');
            await rankService.checkAndPromoteUser(buyerId);
        }

    } catch (err) {
        console.error(`[BV Tracking Error] Order ID: ${orderId}:`, err);
        throw err;
    }
};