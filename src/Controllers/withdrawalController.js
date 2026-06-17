// src/Controllers/withdrawalController.js
const db = require('../../db');

/**
 * USER API: Submit a withdrawal request
 */
exports.requestWithdrawal = async (req, res) => {
    const userId = req.user.id;
    const amount = parseFloat(req.body.amount);

    if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({ status: false, message: "A valid withdrawal amount is required." });
    }

    // 1. Fetch user's approved KYC details
    const [kycRows] = await db.query(
        "SELECT status, bank_account_holder_name, bank_account_number, bank_ifsc_code, bank_name, pan_number FROM user_kyc WHERE user_id = ?",
        [userId]
    );

    if (kycRows.length === 0 || kycRows[0].status !== 'APPROVED') {
        return res.status(400).json({ 
            status: false, 
            message: "Please complete and verify your KYC details before making a withdrawal." 
        });
    }

    const kyc = kycRows[0];
    const bankDetailsSnapshot = {
        bank_account_holder_name: kyc.bank_account_holder_name,
        bank_account_number: kyc.bank_account_number,
        bank_ifsc_code: kyc.bank_ifsc_code,
        bank_name: kyc.bank_name,
        pan_number: kyc.pan_number
    };

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 2. Fetch the dynamic minimum withdrawal limit from settings
        const [settingsRows] = await connection.query(
            "SELECT setting_value FROM app_settings WHERE setting_key = 'min_withdrawal_limit'"
        );
        const minLimit = settingsRows.length > 0 ? parseFloat(settingsRows[0].setting_value) : 100.0;

        if (amount < minLimit) {
            await connection.rollback();
            return res.status(400).json({ 
                status: false, 
                message: `Minimum withdrawal limit is Rs. ${minLimit.toFixed(2)}/-` 
            });
        }

        // 3. Fetch user's wallet and lock balance
        const [walletRows] = await connection.query(
            "SELECT balance FROM user_wallets WHERE user_id = ? FOR UPDATE",
            [userId]
        );

        if (walletRows.length === 0 || parseFloat(walletRows[0].balance) < amount) {
            await connection.rollback();
            return res.status(400).json({ status: false, message: "Insufficient wallet balance." });
        }

        // 4. Update wallet balances (move to locked_balance)
        await connection.query(
            "UPDATE user_wallets SET balance = balance - ?, locked_balance = locked_balance + ? WHERE user_id = ?",
            [amount, amount, userId]
        );

        // 5. Create Withdrawal Request
        const [insertResult] = await connection.query(
            `INSERT INTO user_withdraw_requests (user_id, amount, status, bank_details_snapshot) 
             VALUES (?, ?, 'PENDING', ?)`,
            [userId, amount, JSON.stringify(bankDetailsSnapshot)]
        );

        const requestId = insertResult.insertId;

        // 6. Write transaction log for wallet debit
        await connection.query(
            `INSERT INTO user_wallet_transactions (user_id, txn_type, amount, source, reference_id, remarks) 
             VALUES (?, 'debit', ?, 'withdrawal', ?, ?)`,
            [userId, amount, `WITHDRAW_${requestId}`, `Withdrawal request submitted for ₹${amount.toFixed(2)} (Locked)`]
        );

        await connection.commit();
        res.status(201).json({ 
            status: true, 
            message: "Withdrawal request submitted successfully. Amount is now locked pending approval.", 
            requestId 
        });

    } catch (error) {
        await connection.rollback();
        console.error("Request withdrawal error:", error);
        res.status(500).json({ status: false, message: error.message });
    } finally {
        connection.release();
    }
};

/**
 * ADMIN API: Get all withdrawal requests
 */
exports.adminGetWithdrawals = async (req, res) => {
    const { status } = req.query;
    
    let query = `
        SELECT wr.*, u.username, u.full_name, u.mobile_number 
        FROM user_withdraw_requests wr
        JOIN users u ON wr.user_id = u.id
    `;
    const params = [];

    if (status) {
        query += " WHERE wr.status = ?";
        params.push(status);
    }

    query += " ORDER BY wr.requested_at DESC";

    try {
        const [rows] = await db.query(query, params);
        
        // Parse snapshots
        const formattedRows = rows.map(r => {
            if (r.bank_details_snapshot) {
                r.bank_details_snapshot = typeof r.bank_details_snapshot === 'string'
                    ? JSON.parse(r.bank_details_snapshot)
                    : r.bank_details_snapshot;
            }
            return r;
        });

        res.status(200).json({ status: true, data: formattedRows });
    } catch (error) {
        console.error("Admin get withdrawals error:", error);
        res.status(500).json({ status: false, message: error.message });
    }
};

/**
 * ADMIN API: Process withdrawal request (Approve/Reject)
 */
exports.adminProcessWithdrawal = async (req, res) => {
    const { requestId, status, utrNumber, adminRemarks } = req.body;

    if (!requestId || !status) {
        return res.status(400).json({ status: false, message: "Request ID and status are required." });
    }

    if (!['APPROVED', 'REJECTED'].includes(status)) {
        return res.status(400).json({ status: false, message: "Status must be APPROVED or REJECTED." });
    }

    if (status === 'APPROVED' && !utrNumber) {
        return res.status(400).json({ status: false, message: "UTR/Transaction Reference Number is required for approval." });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Fetch request details
        const [reqRows] = await connection.query(
            "SELECT * FROM user_withdraw_requests WHERE id = ? FOR UPDATE",
            [requestId]
        );

        if (reqRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ status: false, message: "Withdrawal request not found." });
        }

        const withdrawReq = reqRows[0];

        if (withdrawReq.status !== 'PENDING') {
            await connection.rollback();
            return res.status(400).json({ status: false, message: `Request is already processed with status: ${withdrawReq.status}` });
        }

        const amount = parseFloat(withdrawReq.amount);

        if (status === 'APPROVED') {
            // Permanent debit: subtract from locked balance
            await connection.query(
                "UPDATE user_wallets SET locked_balance = locked_balance - ? WHERE user_id = ?",
                [amount, withdrawReq.user_id]
            );

            // Update transaction remarks to append UTR for simple audits
            const newRemarks = `Withdrawal request approved. Paid amount: ₹${amount.toFixed(2)}. UTR: ${utrNumber}`;
            await connection.query(
                "UPDATE user_wallet_transactions SET remarks = ? WHERE user_id = ? AND reference_id = ?",
                [newRemarks, withdrawReq.user_id, `WITHDRAW_${requestId}`]
            );

            // Update request details
            await connection.query(
                "UPDATE user_withdraw_requests SET status = 'APPROVED', utr_number = ?, admin_remarks = ?, processed_at = NOW() WHERE id = ?",
                [utrNumber, adminRemarks || "Approved", requestId]
            );

            console.log(`[Payout] Withdrawal APPROVED for Request ID ${requestId}, UTR: ${utrNumber}`);
        } else {
            // Rejection: refund locked balance back to active balance
            await connection.query(
                "UPDATE user_wallets SET balance = balance + ?, locked_balance = locked_balance - ? WHERE user_id = ?",
                [amount, amount, withdrawReq.user_id]
            );

            // Insert a refund transaction log
            const refundRemarks = `Refund: Rejected withdrawal request #${requestId}. Reason: ${adminRemarks || "Rejected by Admin"}`;
            await connection.query(
                `INSERT INTO user_wallet_transactions (user_id, txn_type, amount, source, reference_id, remarks) 
                 VALUES (?, 'credit', ?, 'refund', ?, ?)`,
                [withdrawReq.user_id, amount, `WITHDRAW_REFUND_${requestId}`, refundRemarks]
            );

            // Update request details
            await connection.query(
                "UPDATE user_withdraw_requests SET status = 'REJECTED', admin_remarks = ?, processed_at = NOW() WHERE id = ?",
                [adminRemarks || "Rejected by Admin", requestId]
            );

            console.log(`[Payout] Withdrawal REJECTED for Request ID ${requestId}. Refunded ₹${amount.toFixed(2)} to User ${withdrawReq.user_id}`);
        }

        await connection.commit();
        res.status(200).json({ status: true, message: `Withdrawal request has been successfully ${status.toLowerCase()}.` });

    } catch (error) {
        await connection.rollback();
        console.error("Process withdrawal error:", error);
        res.status(500).json({ status: false, message: error.message });
    } finally {
        connection.release();
    }
};

/**
 * USER API: Get all withdrawal requests for a user
 */
exports.getUserWithdrawals = async (req, res) => {
    const userId = req.user.id;
    try {
        const [rows] = await db.query(
            "SELECT * FROM user_withdraw_requests WHERE user_id = ? ORDER BY requested_at DESC",
            [userId]
        );
        const formattedRows = rows.map(r => {
            if (r.bank_details_snapshot) {
                r.bank_details_snapshot = typeof r.bank_details_snapshot === 'string'
                    ? JSON.parse(r.bank_details_snapshot)
                    : r.bank_details_snapshot;
            }
            return r;
        });
        res.status(200).json({ status: true, data: formattedRows });
    } catch (error) {
        console.error("User get withdrawals error:", error);
        res.status(500).json({ status: false, message: error.message });
    }
};
