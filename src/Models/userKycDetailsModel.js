const moment = require('moment-timezone');

class KycDetails {
    constructor({
        id,
        user_id,
        pan_number,
        aadhaar_number,
        bank_account_holder_name,
        bank_account_number,
        bank_ifsc_code,
        bank_name,
        status,
        rejection_reason,
        verified_by,
        verified_at,
        created_at,
        updated_at
    }) {
        const timeZone = 'Asia/Kolkata';

        this.id = id;
        this.userId = user_id;

        // Group identity details
        this.identity = {
            panNumber: pan_number,
            aadhaarNumber: aadhaar_number
        };

        // Group bank details for clean access
        this.bank = {
            accountHolderName: bank_account_holder_name,
            accountNumber: bank_account_number,
            ifscCode: bank_ifsc_code,
            bankName: bank_name
        };

        // Verification Status
        this.status = status || 'NOT_SUBMITTED';
        this.rejectionReason = rejection_reason;
        this.verifiedBy = verified_by;
        this.verifiedAt = verified_at ? moment(verified_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss') : null;

        this.createdAt = moment(created_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
        this.updatedAt = moment(updated_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
    }
}

module.exports = KycDetails;