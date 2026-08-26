const moment = require('moment-timezone');
// You will also need to import your Address and OrderItem models
// const Address = require('./Address');
// const OrderItem = require('./OrderItem');

class Order {
  constructor({
    id,
    user_id,
    shipping_address_id,
    delivery_agent_id,
    order_number,
    subtotal,
    delivery_fee,
    total_amount,
    total_bv_earned,
    payment_method,
    payment_status,
    order_status,

    // --- NEW HANDSHAKE FIELDS ---
    delivery_otp,
    delivery_payment_mode,
    delivery_amount_collected,
    delivered_at,
    // ----------------------------

    created_at,
    updated_at,
    shipping_address,
    items,
    return_request,
    return_window_days,
    is_returnable
  }) {
    const timeZone = 'Asia/Kolkata';

    this.id = id;
    this.userId = user_id;
    this.shippingAddressId = shipping_address_id;
    this.deliveryAgentId = delivery_agent_id;
    
    this.orderNumber = order_number;


    // Delivery & Handshake Data
    this.deliveryOtp = delivery_otp || null;
    this.deliveryPaymentMode = delivery_payment_mode || null;
    this.deliveryAmountCollected = parseFloat(delivery_amount_collected || 0);
    this.deliveredAt = delivered_at ? moment(delivered_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss') : null;



    // Financials
    this.subtotal = parseFloat(subtotal);
    this.deliveryFee = parseFloat(delivery_fee);
    this.totalAmount = parseFloat(total_amount);
    this.totalBvEarned = parseFloat(total_bv_earned);

    // Statuses
    this.paymentMethod = payment_method;
    this.paymentStatus = payment_status;
    this.orderStatus = order_status;

    // Timestamps
    this.createdAt = moment(created_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
    this.updatedAt = moment(updated_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');

    // Associated Data (from JOINs)
    this.shippingAddress = shipping_address || null;
    this.items = items || [];
    this.returnRequest = return_request || null;
    this.returnWindowDays = parseInt(return_window_days || 7);
    this.isReturnable = is_returnable !== undefined ? (is_returnable === 1 || is_returnable === true) : true;
  }
}

module.exports = Order;