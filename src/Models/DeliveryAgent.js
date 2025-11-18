const moment = require('moment-timezone');

class DeliveryAgent {
    constructor({
        id,
        full_name,
        phone_number,
        is_active,
        created_at,
        updated_at
        // Note: We deliberately omit the password for security
    }) {
        const timeZone = 'Asia/Kolkata';

        this.id = id;
        this.fullName = full_name;
        this.phoneNumber = phone_number;
        this.isActive = Boolean(is_active);
        this.createdAt = moment(created_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
        this.updatedAt = moment(updated_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
    }
}

// This exports the class itself, not an object containing the class.
module.exports = DeliveryAgent;