const moment = require('moment-timezone');

class Address {
    constructor({
        id,
        user_id,
        
        // --- These two fields will now come from a JOIN with the 'users' table ---
        full_name,       // e.g., u.full_name
        mobile_number,   // e.g., u.mobile_number

        address_line_1,
        address_line_2,
        landmark,
        city,
        state,
        pincode,
        address_type,
        is_default,
        created_at,
        updated_at
    }) {
        const timeZone = 'Asia/Kolkata';

        this.id = id;
        this.userId = user_id;
        
        // Contact info associated with the address
        this.fullName = full_name;
        this.mobileNumber = mobile_number;

        // Location-specific info
        this.addressLine1 = address_line_1;
        this.addressLine2 = address_line_2;
        this.landmark = landmark;
        this.city = city;
        this.state = state;
        this.pincode = pincode;
        this.addressType = address_type;
        this.isDefault = Boolean(is_default);

        this.createdAt = moment(created_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
        this.updatedAt = moment(updated_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
    }
}

module.exports = Address;