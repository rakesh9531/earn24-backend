// src/Services/commissionService.js
const db = require('../../db');

/**
 * Enhanced Commission Service for BV Tracking and Monthly Pool Management
 * This calculates BV per unit and updates the company pools.
 */

exports.processOrderForCommissions = async (connection, orderId) => {
    try {
        console.log(`[BV Tracking] Starting processing for Order ID: ${orderId}`);

        // 1. Fetch Order Basics
        const [orderRows] = await connection.query("SELECT user_id FROM orders WHERE id = ?", [orderId]);
        if (!orderRows.length) return;
        const userId = orderRows[0].user_id;

        // 2. Fetch App Settings
        const [settingsRows] = await connection.query("SELECT setting_key, setting_value FROM app_settings");
        const settings = settingsRows.reduce((acc, s) => { acc[s.setting_key] = parseFloat(s.setting_value); return acc; }, {});

        const bvPct = settings.bv_generation_pct_of_profit || 80.0;
        const yearMonth = new Date().getFullYear() * 100 + (new Date().getMonth() + 1);

        // 3. Fetch Order Items with Profit details (FIXED JOIN for GST)
        const [items] = await connection.query(`
            SELECT oi.id, oi.price_per_unit, oi.quantity, sp.purchase_price, h.gst_percentage
            FROM order_items oi
            JOIN seller_products sp ON oi.seller_product_id = sp.id
            JOIN products p ON sp.product_id = p.id
            LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
            WHERE oi.order_id = ?`, [orderId]);

        let totalOrderBV = 0;

        for (const item of items) {
            // Calculate Net Profit per unit
            const basePrice = item.price_per_unit / (1 + ((item.gst_percentage || 0) / 100));
            const netProfitPerUnit = basePrice - item.purchase_price;

            if (netProfitPerUnit > 0) {
                const bvPerUnit = netProfitPerUnit * (bvPct / 100);
                const totalBVForItem = bvPerUnit * item.quantity;
                totalOrderBV += totalBVForItem;

                // Update order_items table with BV info
                await connection.query(
                    "UPDATE order_items SET bv_earned_per_unit = ?, total_bv_earned = ? WHERE id = ?",
                    [bvPerUnit, totalBVForItem, item.id]
                );
            }
        }

        // 4. Update Global Totals (Orders and Users)
        if (totalOrderBV > 0) {
            await connection.query("UPDATE orders SET total_bv = ? WHERE id = ?", [totalOrderBV, orderId]);
            await connection.query("UPDATE users SET total_bv = total_bv + ? WHERE id = ?", [totalOrderBV, userId]);

            // 5. Update Monthly Company Pool total_company_bv (Generic BV tracking)
            await connection.query(
                `INSERT INTO monthly_company_pools (year_month, total_company_bv) 
                 VALUES (?, ?) 
                 ON DUPLICATE KEY UPDATE total_company_bv = total_company_bv + ?`,
                [yearMonth, totalOrderBV, totalOrderBV]
            );
            
            console.log(`[BV Tracking] Success: Total BV Generated: ${totalOrderBV}`);
        }

    } catch (err) {
        console.error(`[BV Tracking Error] Order ID: ${orderId}:`, err);
        throw err;
    }
};