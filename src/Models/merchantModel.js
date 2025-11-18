// Models/merchantModel.js
const moment = require('moment-timezone');

class Merchant {
  constructor({
    id,
    business_name,
    owner_name,
    phone_number,
    email,
    // Note: We deliberately omit 'password' from the constructor for security
    gst_number,
    pan_number,
    business_address,
    is_verified,
    is_active,
    created_at,
    updated_at
  }) {
    const timeZone = 'Asia/Kolkata'; // Corrected syntax

    this.id = id;
    this.businessName = business_name;
    this.ownerName = owner_name;
    this.phone = phone_number;
    this.email = email;
    
    this.legalInfo = {
        gstNumber: gst_number,
        panNumber: pan_number,
        address: business_address
    };

    this.status = {
        isVerified: Boolean(is_verified),
        isActive: Boolean(is_active)
    };

    this.createdAt = moment(created_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
    this.updatedAt = moment(updated_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
  }
}

module.exports = Merchant;