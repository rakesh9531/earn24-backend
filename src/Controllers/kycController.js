const db = require('../../db');
const KycDetails = require('../Models/userKycDetailsModel');
const path = require('path');
const fs = require('fs');

// Build a public URL for a stored doc file path
const buildDocUrl = (filePath) => {
    if (!filePath) return null;
    // filePath is stored as relative e.g. 'src/uploads/kyc-docs/pan_card_doc-user1-xxx.jpg'
    // Convert to public URL: /uploads/kyc-docs/filename
    const filename = path.basename(filePath);
    return `/uploads/kyc-docs/${filename}`;
};

// --- USER-FACING CONTROLLERS ---

/**
 * A logged-in user submits their KYC details for the first time,
 * OR re-submits (updates bank details) after a REJECTED status.
 * If KYC is APPROVED, user can update bank details — status resets to PENDING.
 */
exports.submitKyc = async (req, res) => {
    const userId = req.user.id;
    const {
        panNumber,
        aadhaarNumber,
        accountHolderName,
        accountNumber,
        ifscCode,
        bankName
    } = req.body;

    // Basic Validation
    if (!panNumber || !aadhaarNumber || !accountHolderName || !accountNumber || !ifscCode || !bankName) {
        return res.status(400).json({ status: false, message: "All KYC and bank fields are required." });
    }

    try {
        // 1. Check existing KYC status
        const [existingKyc] = await db.query('SELECT id, status, pan_card_doc, aadhaar_card_doc, bank_passbook_doc FROM user_kyc WHERE user_id = ?', [userId]);
        const currentStatus = existingKyc.length > 0 ? existingKyc[0].status : null;
        const existingDocs = existingKyc.length > 0 ? existingKyc[0] : {};

        // 2. If KYC is already PENDING — block re-submission
        if (currentStatus === 'PENDING') {
            return res.status(409).json({
                status: false,
                message: "Your KYC is already under review. Please wait for admin verification before making changes."
            });
        }

        // 3. If KYC is APPROVED — check for any active PENDING withdrawal requests first
        if (currentStatus === 'APPROVED') {
            const [pendingWithdrawals] = await db.query(
                "SELECT id FROM user_withdraw_requests WHERE user_id = ? AND status = 'PENDING' LIMIT 1",
                [userId]
            );
            if (pendingWithdrawals.length > 0) {
                return res.status(409).json({
                    status: false,
                    message: "You have a pending withdrawal request. Please wait for it to be processed before updating your bank details."
                });
            }
        }

        // 4. Extract uploaded document paths from multer (req.files)
        const uploadedFiles = req.files || {};
        const panCardDoc    = uploadedFiles.pan_card_doc    ? uploadedFiles.pan_card_doc[0].path    : (existingDocs.pan_card_doc    || null);
        const aadhaarDoc    = uploadedFiles.aadhaar_card_doc ? uploadedFiles.aadhaar_card_doc[0].path : (existingDocs.aadhaar_card_doc || null);
        const passkbookDoc  = uploadedFiles.bank_passbook_doc ? uploadedFiles.bank_passbook_doc[0].path : (existingDocs.bank_passbook_doc || null);

        // 5. Insert or update KYC — resets status to PENDING for fresh admin review
        const query = `
            INSERT INTO user_kyc 
            (user_id, pan_number, aadhaar_number, bank_account_holder_name, bank_account_number, bank_ifsc_code, bank_name, pan_card_doc, aadhaar_card_doc, bank_passbook_doc, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
            ON DUPLICATE KEY UPDATE 
            pan_number=VALUES(pan_number),
            aadhaar_number=VALUES(aadhaar_number),
            bank_account_holder_name=VALUES(bank_account_holder_name),
            bank_account_number=VALUES(bank_account_number),
            bank_ifsc_code=VALUES(bank_ifsc_code),
            bank_name=VALUES(bank_name),
            pan_card_doc=VALUES(pan_card_doc),
            aadhaar_card_doc=VALUES(aadhaar_card_doc),
            bank_passbook_doc=VALUES(bank_passbook_doc),
            status='PENDING',
            rejection_reason=NULL,
            verified_by=NULL,
            verified_at=NULL
        `;

        await db.query(query, [userId, panNumber, aadhaarNumber, accountHolderName, accountNumber, ifscCode, bankName, panCardDoc, aadhaarDoc, passkbookDoc]);

        const message = currentStatus === 'APPROVED'
            ? 'Bank details updated successfully. Your KYC is now under re-verification. Withdrawals are suspended until approved.'
            : 'KYC details submitted successfully. Verification is pending.';

        res.status(201).json({ status: true, message });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: false, message: "This PAN number is already linked to another account." });
        }
        console.error("Error submitting KYC:", error);
        res.status(500).json({ status: false, message: "An error occurred while submitting KYC." });
    }
};

/**
 * A logged-in user gets their own KYC status.
 * Also returns whether they have a pending withdrawal (for UI guard).
 */
exports.getMyKycStatus = async (req, res) => {
    const userId = req.user.id;
    try {
        const [rows] = await db.query('SELECT * FROM user_kyc WHERE user_id = ?', [userId]);

        // Also check for pending withdrawals so the frontend can disable "Update" button
        const [pendingWithdrawals] = await db.query(
            "SELECT COUNT(*) as count FROM user_withdraw_requests WHERE user_id = ? AND status = 'PENDING'",
            [userId]
        );
        const hasPendingWithdrawal = pendingWithdrawals[0].count > 0;

        if (rows.length === 0) {
            return res.status(200).json({
                status: true,
                data: { status: 'NOT_SUBMITTED' },
                hasPendingWithdrawal
            });
        }

        const kycData = new KycDetails(rows[0]);
        // Attach document URLs
        kycData.documents = {
            panCardDoc:    buildDocUrl(rows[0].pan_card_doc),
            aadhaarDoc:    buildDocUrl(rows[0].aadhaar_card_doc),
            passkbookDoc:  buildDocUrl(rows[0].bank_passbook_doc)
        };

        res.status(200).json({
            status: true,
            data: kycData,
            hasPendingWithdrawal
        });
    } catch (error) {
        console.error("Error fetching KYC status:", error);
        res.status(500).json({ status: false, message: 'Failed to retrieve KYC status.' });
    }
};


// --- ADMIN-FACING CONTROLLERS ---

/**
 * Admin gets a list of all KYC requests (for the admin panel).
 */
exports.getAllKycRequests = async (req, res) => {
    try {
        const { status = 'PENDING' } = req.query;
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const offset = (page - 1) * limit;
        const search = req.query.search ? req.query.search.trim() : '';

        let countQuery = `
            SELECT COUNT(*) as total 
            FROM user_kyc kyc
            JOIN users u ON kyc.user_id = u.id
            WHERE kyc.status = ?
        `;
        let dataQuery = `
            SELECT kyc.*, u.full_name as user_name, u.email as user_email, u.mobile_number as user_mobile
            FROM user_kyc kyc
            JOIN users u ON kyc.user_id = u.id
            WHERE kyc.status = ?
        `;

        const queryParams = [status];

        if (search) {
            const searchPattern = `%${search}%`;
            const searchClause = ` AND (u.full_name LIKE ? OR u.email LIKE ? OR u.mobile_number LIKE ? OR kyc.pan_number LIKE ? OR kyc.aadhaar_number LIKE ? OR kyc.bank_account_number LIKE ?)`;
            countQuery += searchClause;
            dataQuery += searchClause;
            queryParams.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
        }

        dataQuery += ` ORDER BY kyc.updated_at DESC LIMIT ? OFFSET ?`;

        const [countResult] = await db.query(countQuery, queryParams);
        const totalRecords = countResult[0].total;

        const dataParams = [...queryParams, limit, offset];
        const [requests] = await db.query(dataQuery, dataParams);

        res.status(200).json({
            status: true,
            data: requests,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(totalRecords / limit),
                totalRecords: totalRecords,
                limit: limit
            }
        });
    } catch (error) {
        console.error("Error fetching KYC requests:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};

/**
 * Admin gets the full details of one specific KYC request.
 */
exports.getKycDetailsById = async (req, res) => {
    const { kycId } = req.params;
    try {
        const [rows] = await db.query(
            `SELECT kyc.*, u.full_name as user_name, u.email as user_email, u.mobile_number as user_mobile
             FROM user_kyc kyc
             JOIN users u ON kyc.user_id = u.id
             WHERE kyc.id = ?`,
            [kycId]
        );
        if (rows.length === 0) {
            return res.status(404).json({ status: false, message: 'KYC record not found.' });
        }
        res.status(200).json({ status: true, data: rows[0] });
    } catch (error) {
        console.error("Error fetching KYC by ID:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};

/**
 * Admin approves or rejects a KYC request.
 */
exports.updateKycStatus = async (req, res) => {
    const adminId = req.user.id;
    const { kycId } = req.params;
    const { status, rejectionReason } = req.body;

    if (!status || !['APPROVED', 'REJECTED'].includes(status)) {
        return res.status(400).json({ status: false, message: "A valid status ('APPROVED' or 'REJECTED') is required." });
    }

    if (status === 'REJECTED' && !rejectionReason) {
        return res.status(400).json({ status: false, message: "A reason is required for rejection." });
    }

    try {
        const query = `
            UPDATE user_kyc SET 
            status = ?, 
            rejection_reason = ?, 
            verified_by = ?, 
            verified_at = NOW()
            WHERE id = ?
        `;

        const [result] = await db.query(query, [
            status,
            status === 'REJECTED' ? rejectionReason : null,
            adminId,
            kycId
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: false, message: 'KYC request not found.' });
        }

        res.status(200).json({ status: true, message: `KYC has been successfully ${status.toLowerCase()}.` });

    } catch (error) {
        console.error("Error updating KYC status:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};

/**
 * ADMIN API: Force a user to re-submit their KYC.
 * Resets KYC status to NOT_SUBMITTED so user can fill fresh details.
 * Blocks if user has a PENDING withdrawal request.
 */
exports.forceResubmitKyc = async (req, res) => {
    const { kycId } = req.params;
    const { reason } = req.body; // Admin must provide a reason

    if (!reason || !reason.trim()) {
        return res.status(400).json({ status: false, message: "Please provide a reason for requesting re-submission." });
    }

    try {
        // 1. Get KYC record and user_id
        const [kycRows] = await db.query('SELECT id, user_id, status FROM user_kyc WHERE id = ?', [kycId]);
        if (kycRows.length === 0) {
            return res.status(404).json({ status: false, message: 'KYC record not found.' });
        }

        const kyc = kycRows[0];

        // 2. Block if user has a PENDING withdrawal
        const [pendingWithdrawals] = await db.query(
            "SELECT id FROM user_withdraw_requests WHERE user_id = ? AND status = 'PENDING' LIMIT 1",
            [kyc.user_id]
        );
        if (pendingWithdrawals.length > 0) {
            return res.status(409).json({
                status: false,
                message: "Cannot reset KYC: This user has a pending withdrawal request. Process the withdrawal first."
            });
        }

        // 3. Reset KYC — clear all details, set rejection_reason as the admin's re-submission note
        const resetQuery = `
            UPDATE user_kyc SET
            status = 'REJECTED',
            rejection_reason = ?,
            verified_by = NULL,
            verified_at = NULL,
            updated_at = NOW()
            WHERE id = ?
        `;

        // We set to REJECTED with a special reason so user sees it and re-submits
        // (NOT_SUBMITTED would remove the record, REJECTED is cleaner UX)
        await db.query(resetQuery, [`Admin requested re-submission: ${reason.trim()}`, kycId]);

        res.status(200).json({
            status: true,
            message: `KYC has been reset. User will be notified to re-submit their details. Reason: ${reason.trim()}`
        });

    } catch (error) {
        console.error("Error in forceResubmitKyc:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};