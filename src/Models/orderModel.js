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
    created_at,
    updated_at,
    // These will be populated from JOINs
    shipping_address,
    items 
  }) {
    const timeZone = 'Asia/Kolkata';

    this.id = id;
    this.userId = user_id;
    this.shippingAddressId = shipping_address_id;
    this.deliveryAgentId = delivery_agent_id;
    
    this.orderNumber = order_number;

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
    // The constructor expects that the data passed in might already have
    // the full address object and an array of OrderItem objects.
    this.shippingAddress = shipping_address || null; // Will be a full Address object
    this.items = items || []; // Will be an array of OrderItem objects
  }
}

module.exports = Order;