const moment = require('moment-timezone');

class Address {
    constructor(data = {}) {
        const timeZone = 'Asia/Kolkata';

        this.id = data.id;
        this.userId = data.user_id;
        
        // Contact info associated with the address
        this.fullName = data.full_name;
        this.mobileNumber = data.mobile_number;

        // Location-specific info
        this.addressLine1 = data.address_line_1;
        this.addressLine2 = data.address_line_2;
        this.landmark = data.landmark;
        this.city = data.city;
        this.state = data.state;
        this.pincode = data.pincode;
        this.addressType = data.address_type;
        this.alternatePhone = data.alternate_phone || null;
        this.isDefault = Boolean(data.is_default);

        this.createdAt = data.created_at ? moment(data.created_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss') : null;
        this.updatedAt = data.updated_at ? moment(data.updated_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss') : null;
    }
}

module.exports = Address;