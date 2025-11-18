const moment = require('moment-timezone');

class CartItem {
  constructor({
    // --- Fields from the `cart_items` table ---
    cart_item_id, // The ID of the cart_item row itself
    quantity,
    added_at,

    // --- Fields from the `seller_products` join ---
    offer_id, // This is the seller_product_id
    selling_price,
    mrp,
    minimum_order_quantity,

    // --- Fields from the `products` and `brands` joins ---
    product_id,
    name,
    main_image_url,
    brand_name
  }) {
    const timeZone = 'Asia/Kolkata';

    // Core Cart Item Info
    this.id = cart_item_id;
    this.quantity = parseInt(quantity, 10);

    // The specific offer being purchased
    this.offerId = offer_id; 

    // Detailed Product Info (from joins)
    this.productId = product_id;
    this.name = name;
    this.brandName = brand_name;
    this.imageUrl = main_image_url;

    // Pricing and Quantity Rules
    this.price = parseFloat(selling_price);
    this.mrp = parseFloat(mrp);
    this.moq = parseInt(minimum_order_quantity, 10) || 1;
    
    this.addedAt = moment(added_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
  }
}

module.exports = CartItem;