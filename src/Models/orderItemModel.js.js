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
    cancellation_reason,
    brand_name,
    variant_title,
    sku,
    return_request,
    has_return_policy,
    is_replacement_available,
    return_window_days,
    replacement_window_days,
    seller_name,
    seller_city,
    seller_state,
    seller_address,
    tracking_number,
    courier_name,
    dispatch_mode,
    delivery_agent_name,
    delivery_agent_phone,
    pickup_status,
    picked_up_at,
    delivered_at
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
    this.brandName = brand_name || '';
    this.variantTitle = variant_title || '';
    this.sku = sku || '';
    this.return_request = return_request || null;
    this.returnRequest = return_request || null;
    this.has_return_policy = (has_return_policy === 1 || has_return_policy === true || has_return_policy === '1' || has_return_policy === 'true') ? 1 : 0;
    this.is_replacement_available = (is_replacement_available === 1 || is_replacement_available === true || is_replacement_available === '1' || is_replacement_available === 'true') ? 1 : 0;
    this.hasReturnPolicy = this.has_return_policy === 1;
    this.isReplacementAvailable = this.is_replacement_available === 1;
    this.returnWindowDays = parseInt(return_window_days || 7, 10);
    this.replacementWindowDays = parseInt(replacement_window_days || 7, 10);

    // Seller & Logistics Tracking data
    this.sellerName = seller_name || '';
    this.sellerCity = seller_city || '';
    this.sellerState = seller_state || '';
    this.sellerAddress = seller_address || '';
    this.trackingNumber = tracking_number || null;
    this.courierName = courier_name || null;
    this.dispatchMode = dispatch_mode || 'LOCAL_RIDER';
    this.deliveryAgentName = delivery_agent_name || null;
    this.deliveryAgentPhone = delivery_agent_phone || null;
    this.pickupStatus = pickup_status || 'PENDING';
    this.pickedUpAt = picked_up_at ? moment(picked_up_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss') : null;
    this.deliveredAt = delivered_at ? moment(delivered_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss') : null;

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