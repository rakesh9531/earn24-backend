// Models/retailerModel.js
const moment = require('moment-timezone');

class Retailer {
  constructor({
    id,
    shop_name,
    owner_name,
    phone_number,
    email,
    // Note: We deliberately omit 'password' from the constructor
    shop_address,
    pincode,
    is_verified,
    is_active,
    created_at,
    updated_at
  }) {
    const timeZone = 'Asia/Kolkata'; // Corrected syntax

    this.id = id;
    this.shopName = shop_name;
    this.ownerName = owner_name;
    this.phone = phone_number;
    this.email = email;

    this.location = {
        address: shop_address,
        pincode: pincode
    };

    this.status = {
        isVerified: Boolean(is_verified),
        isActive: Boolean(is_active)
    };

    this.createdAt = moment(created_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
    this.updatedAt = moment(updated_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
  }
}

module.exports = Retailer;