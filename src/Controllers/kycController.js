const db = require('../../db'); // Adjust path if needed
const KycDetails = require('../Models/userKycDetailsModel'); // Adjust path to your model

// --- USER-FACING CONTROLLERS ---

/**
 * A logged-in user submits their KYC details for the first time.
 */
exports.submitKyc = async (req, res) => {
    const userId = req.user.id; // From authMiddleware
    const { 
        panNumber, 
        aadhaarNumber, 
        accountHolderName, 
        accountNumber, 
        ifscCode,
        bankName 
    } = req.body;

    // Basic Validation
    if (!panNumber || !aadhaarNumber || !accountHolderName || !accountNumber || !ifscCode) {
        return res.status(400).json({ status: false, message: "All KYC and bank fields are required." });
    }

    // Check if user already has a pending or approved KYC
    const [existingKyc] = await db.query('SELECT id, status FROM user_kyc WHERE user_id = ?', [userId]);
    if (existingKyc.length > 0 && ['PENDING', 'APPROVED'].includes(existingKyc[0].status)) {
        return res.status(409).json({ status: false, message: `Your KYC status is already ${existingKyc[0].status}.` });
    }

    try {
        const query = `
            INSERT INTO user_kyc 
            (user_id, pan_number, aadhaar_number, bank_account_holder_name, bank_account_number, bank_ifsc_code, bank_name, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
            ON DUPLICATE KEY UPDATE 
            pan_number=VALUES(pan_number), aadhaar_number=VALUES(aadhaar_number), bank_account_holder_name=VALUES(bank_account_holder_name),
            bank_account_number=VALUES(bank_account_number), bank_ifsc_code=VALUES(bank_ifsc_code), bank_name=VALUES(bank_name), status='PENDING', rejection_reason=NULL
        `;
        
        await db.query(query, [userId, panNumber, aadhaarNumber, accountHolderName, accountNumber, ifscCode, bankName]);
        
        res.status(201).json({ status: true, message: 'KYC details submitted successfully. Verification is pending.' });

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
 */
exports.getMyKycStatus = async (req, res) => {
    const userId = req.user.id;
    try {
        const [rows] = await db.query('SELECT * FROM user_kyc WHERE user_id = ?', [userId]);
        if (rows.length === 0) {
            // It's not an error if they haven't submitted yet.
            return res.status(200).json({ status: true, data: { status: 'NOT_SUBMITTED' } });
        }
        res.status(200).json({ status: true, data: new KycDetails(rows[0]) });
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
        const { status = 'PENDING' } = req.query; // Default to showing pending requests

        const query = `
            SELECT kyc.*, u.full_name as user_name, u.email as user_email 
            FROM user_kyc kyc
            JOIN users u ON kyc.user_id = u.id
            WHERE kyc.status = ?
            ORDER BY kyc.updated_at ASC
        `;
        const [requests] = await db.query(query, [status]);

        res.status(200).json({ status: true, data: requests });
    } catch (error) {
        console.error("Error fetching KYC requests:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};

/**
 * Admin gets the full details of one specific KYC request.
 */
exports.getKycDetailsById = async (req, res) => {
     // Similar to getMyKycStatus but fetches by kyc.id instead of user_id
     // You would also join with the users table to show user's name
     res.status(501).json({ message: 'Not implemented yet' });
};

/**
 * Admin approves or rejects a KYC request.
 */
exports.updateKycStatus = async (req, res) => {
    const adminId = req.user.id; // Admin who is performing the action
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
        
        const [result] = await db.query(query, [status, status === 'REJECTED' ? rejectionReason : null, adminId, kycId]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: false, message: 'KYC request not found.' });
        }

        // You would trigger a notification to the user here.

        res.status(200).json({ status: true, message: `KYC has been successfully ${status.toLowerCase()}.` });

    } catch (error) {
        console.error("Error updating KYC status:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};