const moment = require('moment-timezone');

class ProfitDistributionLedger {
    constructor({
        id,
        order_item_id,
        user_id,
        distribution_type,
        total_profit_on_item,
        distributable_amount,
        percentage_applied,
        amount_credited,
        transaction_date
    }) {
        const timeZone = 'Asia/Kolkata';

        this.id = id;
        this.orderItemId = order_item_id;
        this.userId = user_id;
        this.distributionType = distribution_type;
        this.totalProfitOnItem = parseFloat(total_profit_on_item);
        this.distributableAmount = parseFloat(distributable_amount);
        this.percentageApplied = parseFloat(percentage_applied);
        this.amountCredited = parseFloat(amount_credited);
        this.transactionDate = moment(transaction_date).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
    }
}

module.exports = ProfitDistributionLedger;