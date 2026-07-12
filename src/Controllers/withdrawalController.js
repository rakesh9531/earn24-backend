// src/Controllers/withdrawalController.js
const db = require('../../db');
const payuPayoutService = require('../Services/payuPayoutService');

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
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search ? req.query.search.trim() : '';

    let countQuery = `
        SELECT COUNT(*) as total 
        FROM user_withdraw_requests wr
        JOIN users u ON wr.user_id = u.id
    `;
    let dataQuery = `
        SELECT wr.*, u.username, u.full_name, u.mobile_number 
        FROM user_withdraw_requests wr
        JOIN users u ON wr.user_id = u.id
    `;

    const whereClauses = [];
    const params = [];

    if (status) {
        whereClauses.push("wr.status = ?");
        params.push(status);
    }

    if (search) {
        const searchPattern = `%${search}%`;
        whereClauses.push("(u.full_name LIKE ? OR u.username LIKE ? OR u.mobile_number LIKE ? OR wr.utr_number LIKE ?)");
        params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    if (whereClauses.length > 0) {
        const whereString = " WHERE " + whereClauses.join(" AND ");
        countQuery += whereString;
        dataQuery += whereString;
    }

    dataQuery += " ORDER BY wr.requested_at DESC LIMIT ? OFFSET ?";

    try {
        const [countResult] = await db.query(countQuery, params);
        const totalRecords = countResult[0].total;

        const dataParams = [...params, limit, offset];
        const [rows] = await db.query(dataQuery, dataParams);
        
        // Parse snapshots
        const formattedRows = rows.map(r => {
            if (r.bank_details_snapshot) {
                r.bank_details_snapshot = typeof r.bank_details_snapshot === 'string'
                    ? JSON.parse(r.bank_details_snapshot)
                    : r.bank_details_snapshot;
            }
            return r;
        });

        res.status(200).json({ 
            status: true, 
            data: formattedRows,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(totalRecords / limit),
                totalRecords: totalRecords,
                limit: limit
            }
        });
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

    // Fetch current payout mode
    let payoutMode = 'manual';
    try {
        const [modeRows] = await db.query(
            "SELECT setting_value FROM app_settings WHERE setting_key = 'payout_mode'"
        );
        if (modeRows.length > 0) {
            payoutMode = modeRows[0].setting_value;
        }
    } catch (modeErr) {
        console.error("Error reading payout_mode setting, falling back to manual:", modeErr.message);
    }

    if (status === 'APPROVED' && payoutMode === 'manual' && !utrNumber) {
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
        let finalUtrNumber = utrNumber;

        if (status === 'APPROVED') {
            if (payoutMode === 'automatic') {
                const bankDetails = typeof withdrawReq.bank_details_snapshot === 'string'
                    ? JSON.parse(withdrawReq.bank_details_snapshot)
                    : withdrawReq.bank_details_snapshot;

                const payoutResult = await payuPayoutService.processPayout({
                    requestId: requestId,
                    amount: amount,
                    bankDetails
                });

                if (payoutResult.status === 'SUCCESS') {
                    finalUtrNumber = payoutResult.utr;
                } else if (payoutResult.status === 'PENDING') {
                    // Update admin remarks and commit
                    await connection.query(
                        "UPDATE user_withdraw_requests SET admin_remarks = ? WHERE id = ?",
                        ["Processing via PayU Payouts...", requestId]
                    );
                    await connection.commit();
                    return res.status(200).json({ 
                        status: true, 
                        message: "Payout request initiated successfully. Status is processing at PayU." 
                    });
                } else {
                    // Fail the request if transfer failed
                    await connection.rollback();
                    return res.status(400).json({ 
                        status: false, 
                        message: `PayU Payout failed: ${payoutResult.message}` 
                    });
                }
            }

            // Permanent debit: subtract from locked balance
            await connection.query(
                "UPDATE user_wallets SET locked_balance = locked_balance - ? WHERE user_id = ?",
                [amount, withdrawReq.user_id]
            );

            // Update transaction remarks to append UTR for simple audits
            const newRemarks = `Withdrawal request approved. Paid amount: ₹${amount.toFixed(2)}. UTR: ${finalUtrNumber}`;
            await connection.query(
                "UPDATE user_wallet_transactions SET remarks = ? WHERE user_id = ? AND reference_id = ?",
                [newRemarks, withdrawReq.user_id, `WITHDRAW_${requestId}`]
            );

            // Update request details
            await connection.query(
                "UPDATE user_withdraw_requests SET status = 'APPROVED', utr_number = ?, admin_remarks = ?, processed_at = NOW() WHERE id = ?",
                [finalUtrNumber, adminRemarks || "Approved", requestId]
            );

            console.log(`[Payout] Withdrawal APPROVED for Request ID ${requestId}, UTR: ${finalUtrNumber}`);
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

/**
 * ADMIN API: Export withdrawal requests as CSV
 */
exports.adminExportWithdrawals = async (req, res) => {
    try {
        const { status } = req.query;
        
        let query = `
            SELECT wr.id, wr.user_id, wr.amount, wr.status, wr.bank_details_snapshot, wr.utr_number, wr.requested_at, wr.processed_at,
                   u.username, u.full_name, u.mobile_number 
            FROM user_withdraw_requests wr
            JOIN users u ON wr.user_id = u.id
        `;
        const params = [];
        if (status) {
            query += " WHERE wr.status = ?";
            params.push(status);
        }
        query += " ORDER BY wr.requested_at DESC";
        
        const [rows] = await db.query(query, params);
        
        let csvContent = "Request ID,User ID,Username,Full Name,Mobile,Amount,Status,Requested At,Processed At,Bank Name,Account Number,IFSC Code,Holder Name\n";
        
        for (const row of rows) {
            let bankName = "";
            let accNum = "";
            let ifsc = "";
            let holder = "";
            
            try {
                const bank = typeof row.bank_details_snapshot === 'string'
                    ? JSON.parse(row.bank_details_snapshot)
                    : row.bank_details_snapshot;
                if (bank) {
                    bankName = bank.bank_name || "";
                    accNum = bank.bank_account_number || "";
                    ifsc = bank.bank_ifsc_code || "";
                    holder = bank.bank_account_holder_name || "";
                }
            } catch (err) {
                console.error("Error parsing bank details for request", row.id, err);
            }
            
            const clean = (val) => {
                if (val === null || val === undefined) return "";
                const str = String(val).replace(/"/g, '""');
                return str.includes(",") || str.includes("\n") || str.includes('"') ? `"${str}"` : str;
            };
            
            csvContent += `${row.id},${row.user_id},${clean(row.username)},${clean(row.full_name)},${clean(row.mobile_number)},${row.amount},${row.status},${row.requested_at ? new Date(row.requested_at).toISOString() : ""},${row.processed_at ? new Date(row.processed_at).toISOString() : ""},${clean(bankName)},${clean(accNum)},${clean(ifsc)},${clean(holder)}\n`;
        }
        
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename=withdrawals_${status || 'all'}_export_${Date.now()}.csv`);
        return res.status(200).send(csvContent);
        
    } catch (error) {
        console.error("Admin export withdrawals error:", error);
        res.status(500).json({ status: false, message: error.message });
    }
};

/**
 * PUBLIC API: PayU Payout Status Webhook (Asynchronous Callback)
 */
exports.payuPayoutWebhook = async (req, res) => {
    // PayU sends webhook payload
    const payload = req.body;
    console.log("[PayU Payout Webhook Received]:", JSON.stringify(payload));

    // Support both formats (object-level and flat-level structures)
    const status = payload.status || payload.data?.status;
    const refId = payload.merchantRefId || payload.data?.merchantRefId || payload.txnid;
    const utr = payload.utr || payload.data?.utr;
    const message = payload.message || payload.data?.errorMessage || "Updated via Webhook";

    if (!refId) {
        return res.status(400).json({ status: false, message: "Missing transaction reference ID" });
    }

    // Extract request ID (e.g. from 'WITHDRAW_123' -> 123)
    const requestId = refId.startsWith('WITHDRAW_') ? parseInt(refId.split('_')[1], 10) : parseInt(refId, 10);
    if (isNaN(requestId)) {
        return res.status(400).json({ status: false, message: "Invalid request ID format" });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

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
            // Responding 200 OK anyway to prevent PayU retrying infinitely
            return res.status(200).json({ status: true, message: "Request already processed" });
        }

        const amount = parseFloat(withdrawReq.amount);

        if (status === 'SUCCESS' || status === 'success' || status === 'APPROVED') {
            // Success transition
            await connection.query(
                "UPDATE user_wallets SET locked_balance = locked_balance - ? WHERE user_id = ?",
                [amount, withdrawReq.user_id]
            );

            const newRemarks = `Withdrawal request approved. Paid amount: ₹${amount.toFixed(2)}. UTR: ${utr || "PAYU_AUTO"}`;
            await connection.query(
                "UPDATE user_wallet_transactions SET remarks = ? WHERE user_id = ? AND reference_id = ?",
                [newRemarks, withdrawReq.user_id, `WITHDRAW_${requestId}`]
            );

            await connection.query(
                "UPDATE user_withdraw_requests SET status = 'APPROVED', utr_number = ?, admin_remarks = ?, processed_at = NOW() WHERE id = ?",
                [utr || "PAYU_AUTO", "Approved via PayU webhook callback", requestId]
            );

            console.log(`[Webhook Success] Withdrawal APPROVED for Request ID ${requestId}, UTR: ${utr}`);
        } else if (status === 'FAILED' || status === 'failed' || status === 'REJECTED') {
            // Failure transition
            await connection.query(
                "UPDATE user_wallets SET balance = balance + ?, locked_balance = locked_balance - ? WHERE user_id = ?",
                [amount, amount, withdrawReq.user_id]
            );

            const refundRemarks = `Refund: Rejected withdrawal request #${requestId}. Reason: PayU Payout Failed - ${message}`;
            await connection.query(
                `INSERT INTO user_wallet_transactions (user_id, txn_type, amount, source, reference_id, remarks) 
                 VALUES (?, 'credit', ?, 'refund', ?, ?)`,
                [withdrawReq.user_id, amount, `WITHDRAW_REFUND_${requestId}`, refundRemarks]
            );

            await connection.query(
                "UPDATE user_withdraw_requests SET status = 'REJECTED', admin_remarks = ?, processed_at = NOW() WHERE id = ?",
                [`PayU Payout failed: ${message}`, requestId]
            );

            console.log(`[Webhook Failed] Withdrawal REJECTED for Request ID ${requestId}. Refunded to user.`);
        }

        await connection.commit();
        return res.status(200).json({ status: true, message: "Webhook processed successfully" });

    } catch (err) {
        await connection.rollback();
        console.error("Error processing PayU Payout Webhook:", err);
        return res.status(500).json({ status: false, message: err.message });
    } finally {
        connection.release();
    }
};
