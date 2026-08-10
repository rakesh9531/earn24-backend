// Controllers/merchantWalletController.js
// Handles: Wallet summary, transactions, bank details, settlements
const db = require('../../db');
const moment = require('moment-timezone');
const IST = 'Asia/Kolkata';

const PLATFORM_FEE_PERCENT = 0.10;   // 10%
const RETURN_WINDOW_DAYS   = 7;

// ─────────────────────────────────────────────────────────────
// INTERNAL HELPER — Called when an order is DELIVERED
// Creates merchant_transaction + updates merchant_wallet
// ─────────────────────────────────────────────────────────────
exports.creditMerchantOnDelivery = async (orderId, merchantId, grossAmount) => {
    const platformFee = Math.round(grossAmount * PLATFORM_FEE_PERCENT * 100) / 100;
    const netAmount   = Math.round((grossAmount - platformFee) * 100) / 100;

    const deliveryDate = moment().tz(IST).format('YYYY-MM-DD HH:mm:ss');
    const releaseDate  = moment().tz(IST).add(RETURN_WINDOW_DAYS, 'days').format('YYYY-MM-DD HH:mm:ss');

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // 1. Record transaction (status = PENDING while in return window)
        await conn.query(`
            INSERT INTO merchant_transactions
              (merchant_id, order_id, gross_amount, platform_fee, net_amount,
               status, delivery_date, release_date)
            VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?)
            ON DUPLICATE KEY UPDATE gross_amount=VALUES(gross_amount)
        `, [merchantId, orderId, grossAmount, platformFee, netAmount, deliveryDate, releaseDate]);

        // 2. Create wallet row if not exists, then add to pending
        await conn.query(`
            INSERT INTO merchant_wallet (merchant_id, pending_amount, platform_fee_total)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE
              pending_amount     = pending_amount + VALUES(pending_amount),
              platform_fee_total = platform_fee_total + VALUES(platform_fee_total),
              total_earned       = total_earned + ?
        `, [merchantId, netAmount, platformFee, netAmount]);

        // 3. Mark delivered_at on the order
        await conn.query(
            `UPDATE orders SET delivered_at = NOW() WHERE id = ?`,
            [orderId]
        );

        await conn.commit();
        console.log(`[Wallet] Credited ₹${netAmount} PENDING for merchant ${merchantId}, order ${orderId}`);
        return { success: true, netAmount, releaseDate };

    } catch (err) {
        await conn.rollback();
        console.error('[Wallet] creditMerchantOnDelivery error:', err);
        throw err;
    } finally {
        conn.release();
    }
};

// ─────────────────────────────────────────────────────────────
// CRON JOB FUNCTION — Release PENDING → AVAILABLE after 7 days
// Called by a scheduled cron (every midnight)
// ─────────────────────────────────────────────────────────────
exports.releaseMaturedTransactions = async () => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // Find all PENDING transactions whose release_date has passed
        const [matured] = await conn.query(`
            SELECT id, merchant_id, net_amount
            FROM merchant_transactions
            WHERE status = 'PENDING' AND release_date <= NOW()
        `);

        if (matured.length === 0) {
            console.log('[Wallet Cron] No matured transactions to release.');
            await conn.commit();
            return;
        }

        for (const tx of matured) {
            // Move from pending → available in wallet
            await conn.query(`
                UPDATE merchant_wallet
                SET pending_amount   = GREATEST(0, pending_amount - ?),
                    available_amount = available_amount + ?
                WHERE merchant_id = ?
            `, [tx.net_amount, tx.net_amount, tx.merchant_id]);

            // Update transaction status
            await conn.query(
                `UPDATE merchant_transactions SET status = 'AVAILABLE' WHERE id = ?`,
                [tx.id]
            );
        }

        await conn.commit();
        console.log(`[Wallet Cron] Released ${matured.length} transactions to AVAILABLE.`);
    } catch (err) {
        await conn.rollback();
        console.error('[Wallet Cron] releaseMaturedTransactions error:', err);
    } finally {
        conn.release();
    }
};

// ─────────────────────────────────────────────────────────────
// GET /merchant/wallet/summary — Dashboard wallet data
// ─────────────────────────────────────────────────────────────
exports.getWalletSummary = async (req, res) => {
    const merchantId = req.user.id;
    try {
        // Auto-release matured transactions first
        await exports.releaseMaturedTransactions();

        const [[wallet]] = await db.query(
            `SELECT * FROM merchant_wallet WHERE merchant_id = ?`,
            [merchantId]
        );

        // Next Saturday calculation
        const today = moment().tz(IST);
        const dayOfWeek = today.day(); // 0=Sun, 6=Sat
        const daysUntilSat = (6 - dayOfWeek + 7) % 7 || 7;
        const nextSettlement = today.clone().add(daysUntilSat, 'days').format('ddd, DD MMM YYYY');

        res.json({
            status: true,
            data: {
                totalEarned:      wallet?.total_earned      || 0,
                pendingAmount:    wallet?.pending_amount    || 0,
                availableAmount:  wallet?.available_amount  || 0,
                paidAmount:       wallet?.paid_amount       || 0,
                platformFeeTotal: wallet?.platform_fee_total || 0,
                nextSettlementDate: nextSettlement,
                returnWindowDays: RETURN_WINDOW_DAYS,
                platformFeePercent: PLATFORM_FEE_PERCENT * 100
            }
        });
    } catch (err) {
        console.error('[Wallet] getWalletSummary error:', err);
        res.status(500).json({ status: false, message: 'Could not fetch wallet summary.' });
    }
};

// ─────────────────────────────────────────────────────────────
// GET /merchant/wallet/transactions — Transaction history
// ─────────────────────────────────────────────────────────────
exports.getTransactions = async (req, res) => {
    const merchantId = req.user.id;
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * limit;

    try {
        let where = 'WHERE mt.merchant_id = ?';
        const params = [merchantId];
        if (status) { where += ' AND mt.status = ?'; params.push(status); }

        const [rows] = await db.query(`
            SELECT mt.*, o.order_number
            FROM merchant_transactions mt
            LEFT JOIN orders o ON mt.order_id = o.id
            ${where}
            ORDER BY mt.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

        const [[{ total }]] = await db.query(
            `SELECT COUNT(*) as total FROM merchant_transactions mt ${where}`,
            params
        );

        res.json({ status: true, data: rows, total, page: parseInt(page), limit: parseInt(limit) });
    } catch (err) {
        console.error('[Wallet] getTransactions error:', err);
        res.status(500).json({ status: false, message: 'Could not fetch transactions.' });
    }
};

// ─────────────────────────────────────────────────────────────
// POST /merchant/bank-details — Save bank account
// ─────────────────────────────────────────────────────────────
exports.saveBankDetails = async (req, res) => {
    const merchantId = req.user.id;
    const { account_holder_name, account_number, ifsc_code, bank_name, branch_name, account_type } = req.body;

    if (!account_holder_name || !account_number || !ifsc_code) {
        return res.status(400).json({ status: false, message: 'Account holder name, account number, and IFSC code are required.' });
    }

    try {
        await db.query(`
            INSERT INTO merchant_bank_details
              (merchant_id, account_holder_name, account_number, ifsc_code, bank_name, branch_name, account_type)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              account_holder_name = VALUES(account_holder_name),
              account_number      = VALUES(account_number),
              ifsc_code           = VALUES(ifsc_code),
              bank_name           = VALUES(bank_name),
              branch_name         = VALUES(branch_name),
              account_type        = VALUES(account_type),
              is_verified         = 0,
              updated_at          = NOW()
        `, [merchantId, account_holder_name, account_number, ifsc_code, bank_name || null, branch_name || null, account_type || 'SAVINGS']);

        res.json({ status: true, message: 'Bank details saved successfully. Pending admin verification.' });
    } catch (err) {
        console.error('[Wallet] saveBankDetails error:', err);
        res.status(500).json({ status: false, message: 'Could not save bank details.' });
    }
};

// ─────────────────────────────────────────────────────────────
// GET /merchant/bank-details — Fetch bank account
// ─────────────────────────────────────────────────────────────
exports.getBankDetails = async (req, res) => {
    const merchantId = req.user.id;
    try {
        const [[details]] = await db.query(
            `SELECT * FROM merchant_bank_details WHERE merchant_id = ?`,
            [merchantId]
        );
        res.json({ status: true, data: details || null });
    } catch (err) {
        res.status(500).json({ status: false, message: 'Could not fetch bank details.' });
    }
};

// ─────────────────────────────────────────────────────────────
// POST /merchant/settlement/request — Merchant requests payout
// ─────────────────────────────────────────────────────────────
exports.requestSettlement = async (req, res) => {
    const merchantId = req.user.id;
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const [[wallet]] = await conn.query(
            `SELECT available_amount FROM merchant_wallet WHERE merchant_id = ?`,
            [merchantId]
        );

        if (!wallet || wallet.available_amount < 100) {
            return res.status(400).json({ status: false, message: 'Minimum ₹100 available balance required for settlement.' });
        }

        // Check pending settlement doesn't already exist
        const [[existingSettlement]] = await conn.query(
            `SELECT id FROM merchant_settlements WHERE merchant_id = ? AND status IN ('REQUESTED','PROCESSING')`,
            [merchantId]
        );
        if (existingSettlement) {
            return res.status(400).json({ status: false, message: 'You already have a pending settlement request.' });
        }

        const [[bankDetails]] = await conn.query(
            `SELECT * FROM merchant_bank_details WHERE merchant_id = ?`,
            [merchantId]
        );
        if (!bankDetails) {
            return res.status(400).json({ status: false, message: 'Please add your bank account details before requesting settlement.' });
        }

        const amount = wallet.available_amount;

        // Create settlement request
        await conn.query(`
            INSERT INTO merchant_settlements
              (merchant_id, amount, bank_account_number, ifsc_code, account_holder_name, status)
            VALUES (?, ?, ?, ?, ?, 'REQUESTED')
        `, [merchantId, amount, bankDetails.account_number, bankDetails.ifsc_code, bankDetails.account_holder_name]);

        // Move available → pending settlement (deduct from available)
        await conn.query(`
            UPDATE merchant_wallet
            SET available_amount = 0
            WHERE merchant_id = ?
        `, [merchantId]);

        // Mark transactions as SETTLED
        await conn.query(`
            UPDATE merchant_transactions
            SET status = 'SETTLED'
            WHERE merchant_id = ? AND status = 'AVAILABLE'
        `, [merchantId]);

        await conn.commit();
        res.json({ status: true, message: `Settlement request of ₹${amount} submitted. Admin will process within 2-3 business days.`, amount });

    } catch (err) {
        await conn.rollback();
        console.error('[Wallet] requestSettlement error:', err);
        res.status(500).json({ status: false, message: 'Could not process settlement request.' });
    } finally {
        conn.release();
    }
};

// ─────────────────────────────────────────────────────────────
// GET /merchant/settlements — Merchant's settlement history
// ─────────────────────────────────────────────────────────────
exports.getSettlements = async (req, res) => {
    const merchantId = req.user.id;
    try {
        const [rows] = await db.query(
            `SELECT * FROM merchant_settlements WHERE merchant_id = ? ORDER BY requested_at DESC`,
            [merchantId]
        );
        res.json({ status: true, data: rows });
    } catch (err) {
        res.status(500).json({ status: false, message: 'Could not fetch settlements.' });
    }
};

// ─────────────────────────────────────────────────────────────
// ADMIN: GET /admin/settlements — All pending settlements
// ─────────────────────────────────────────────────────────────
exports.adminGetAllSettlements = async (req, res) => {
    const { status = 'REQUESTED' } = req.query;
    try {
        const [rows] = await db.query(`
            SELECT ms.*, m.business_name, m.owner_name, m.phone_number
            FROM merchant_settlements ms
            JOIN merchants m ON ms.merchant_id = m.id
            WHERE ms.status = ?
            ORDER BY ms.requested_at ASC
        `, [status]);
        res.json({ status: true, data: rows });
    } catch (err) {
        res.status(500).json({ status: false, message: 'Could not fetch settlements.' });
    }
};

// ─────────────────────────────────────────────────────────────
// ADMIN: PATCH /admin/settlements/:id/pay — Mark as PAID
// ─────────────────────────────────────────────────────────────
exports.adminMarkSettlementPaid = async (req, res) => {
    const { id } = req.params;
    const { utr_number, admin_notes } = req.body;

    if (!utr_number) {
        return res.status(400).json({ status: false, message: 'UTR number is required to mark settlement as paid.' });
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const [[settlement]] = await conn.query(
            `SELECT * FROM merchant_settlements WHERE id = ?`, [id]
        );
        if (!settlement) return res.status(404).json({ status: false, message: 'Settlement not found.' });
        if (settlement.status === 'PAID') return res.status(400).json({ status: false, message: 'Already paid.' });

        await conn.query(`
            UPDATE merchant_settlements
            SET status = 'PAID', utr_number = ?, admin_notes = ?, paid_at = NOW()
            WHERE id = ?
        `, [utr_number, admin_notes || null, id]);

        // Add to merchant's paid_amount
        await conn.query(`
            UPDATE merchant_wallet
            SET paid_amount = paid_amount + ?
            WHERE merchant_id = ?
        `, [settlement.amount, settlement.merchant_id]);

        await conn.commit();
        res.json({ status: true, message: `Settlement of ₹${settlement.amount} marked as PAID with UTR: ${utr_number}` });

    } catch (err) {
        await conn.rollback();
        console.error('[Admin Settlement] error:', err);
        res.status(500).json({ status: false, message: 'Could not update settlement.' });
    } finally {
        conn.release();
    }
};
