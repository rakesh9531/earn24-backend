const moment = require('moment-timezone');

class OrderItem {
  constructor({
    id,
    order_id,
    product_id,
    seller_product_id,
    product_name,
    quantity,
    price_per_unit,
    total_price,
    bv_earned_per_unit,
    total_bv_earned,
    created_at,
    // You can also join to get the main_image_url for display in order history
    main_image_url 
  }) {
    const timeZone = 'Asia/Kolkata';

    this.id = id;
    this.orderId = order_id;
    this.productId = product_id;
    this.sellerProductId = seller_product_id;

    // Snapshot data
    this.productName = product_name;
    this.quantity = parseInt(quantity, 10);
    this.pricePerUnit = parseFloat(price_per_unit);
    this.totalPrice = parseFloat(total_price);
    this.bvEarnedPerUnit = parseFloat(bv_earned_per_unit);
    this.totalBvEarned = parseFloat(total_bv_earned);

    // Optional joined data
    this.imageUrl = main_image_url || null;
    
    this.createdAt = moment(created_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
  }
}

module.exports = OrderItem;