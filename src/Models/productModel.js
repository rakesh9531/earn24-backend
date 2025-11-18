// Models/productModel.js
const moment = require('moment-timezone');

class Product {
  constructor({
    id,
    name,
    slug,
    category_id,
    subcategory_id,
    brand_id,
    hsn_code_id,
    description,
    main_image_url,
    gallery_image_urls,
    is_approved,
    is_active,
    is_deleted,
    created_at,
    updated_at
  }) {
    const timeZone = 'Asia/Kolkata';

    this.id = id;
    this.name = name;
    this.slug = slug;
    this.description = description;

    this.categoryId = category_id;
    this.subcategoryId = subcategory_id;
    this.brandId = brand_id;
    this.hsnCodeId = hsn_code_id;

    this.media = {
      mainImageUrl: main_image_url,
      galleryImageUrls: gallery_image_urls ? (typeof gallery_image_urls === 'string' ? JSON.parse(gallery_image_urls) : gallery_image_urls) : []
    };

    this.status = {
      isApproved: Boolean(is_approved),
      isActive: Boolean(is_active),
      isDeleted: Boolean(is_deleted)
    };
    
    this.createdAt = moment(created_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
    this.updatedAt = moment(updated_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
  }
}

module.exports = Product;