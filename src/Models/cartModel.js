const moment = require('moment-timezone');

class Cart {
  constructor({
    id,
    user_id,
    created_at,
    updated_at,
    items // This will be an array of CartItem objects, added by our logic
  }) {
    const timeZone = 'Asia/Kolkata';

    this.id = id;
    this.userId = user_id;

    // The cart itself doesn't have a total; that's calculated from the items.
    // The `items` array will be populated by our controller.
    this.items = items || [];

    this.createdAt = moment(created_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
    this.updatedAt = moment(updated_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
  }
}

module.exports = Cart;