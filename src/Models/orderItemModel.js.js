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
    attributes_snapshot,
    main_image_url,
    item_status,
    cancelled_at,
    cancellation_reason
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
    this.itemStatus = item_status || 'ACTIVE';
    this.cancelledAt = cancelled_at ? moment(cancelled_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss') : null;
    this.cancellationReason = cancellation_reason || null;

    let parsedAttributes = null;
    let finalImageUrl = main_image_url || null;
    if (attributes_snapshot) {
      try {
        parsedAttributes = typeof attributes_snapshot === 'string' ? JSON.parse(attributes_snapshot) : attributes_snapshot;
        if (parsedAttributes && parsedAttributes['Variant Image']) {
          finalImageUrl = parsedAttributes['Variant Image'];
        }
      } catch (e) {}
    }

    this.attributesSnapshot = parsedAttributes;
    this.imageUrl = finalImageUrl;
    
    this.createdAt = moment(created_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
  }
}

module.exports = OrderItem;