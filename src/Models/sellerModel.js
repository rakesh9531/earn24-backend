// Models/sellerModel.js
const moment = require('moment-timezone');

class Seller {
  constructor({
    id,
    sellerable_id,
    sellerable_type,
    display_name,
    is_active,
    created_at
  }) {
    const timeZone = 'Asia/Kolkata';

    this.id = id;
    this.sellerableId = sellerable_id; // e.g., The ID from the merchants or retailers table
    this.sellerableType = sellerable_type; // e.g., 'Merchant' or 'Retailer'
    this.displayName = display_name;
    this.isActive = Boolean(is_active);
    this.createdAt = moment(created_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
  }
}

module.exports = Seller;