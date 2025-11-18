const moment = require('moment-timezone');

class UserBusinessVolume {
    constructor({
        id,
        user_id,
        order_item_id,
        product_id,
        net_profit_base,
        bv_earned,
        transaction_date,
        notes
    }) {
        const timeZone = 'Asia/Kolkata';

        this.id = id;
        this.userId = user_id;
        this.orderItemId = order_item_id;
        this.productId = product_id;
        this.netProfitBase = parseFloat(net_profit_base);
        this.bvEarned = parseFloat(bv_earned);
        this.notes = notes;
        this.transactionDate = moment(transaction_date).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
    }
}

module.exports = UserBusinessVolume;