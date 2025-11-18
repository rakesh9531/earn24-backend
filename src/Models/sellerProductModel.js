// File: /Models/sellerProductModel.js

const moment = require('moment-timezone');

class SellerProduct {
  constructor({
    id,
    seller_id,
    product_id,
    sku,
    mrp,
    selling_price,
    purchase_price,
    quantity,
    is_in_stock,
    is_active,
    created_at,
    updated_at,
    pincodes // <-- ADDED: Will be an array we construct from the DB
  }) {
    const timeZone = 'Asia/Kolkata';

    this.id = id;
    this.sellerId = seller_id;
    this.productId = product_id;
    this.sku = sku;
    this.mrp = parseFloat(mrp);
    this.sellingPrice = parseFloat(selling_price);
    this.purchasePrice = parseFloat(purchase_price);
    this.quantity = parseInt(quantity, 10);
    this.pincodes = pincodes || []; // Expect an array

    this.status = {
      isInStock: Boolean(is_in_stock),
      isActive: Boolean(is_active)
    };

    this.createdAt = moment(created_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
    this.updatedAt = moment(updated_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
  }
}

module.exports = SellerProduct;