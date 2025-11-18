// models/Brand.js

const moment = require('moment-timezone');

class Brand {
  constructor({
    id,
    name,
    slug,
    logo_url,
    description,
    is_active,
    created_at,
    updated_at,
  }) {
    this.id = id;
    this.name = name;
    this.slug = slug;
    this.logoUrl = logo_url;
    this.description = description;
    this.isActive = Boolean(is_active);

    // --- Format timestamps to the desired timezone ---
    const timeZone = 'Asia/Kolkata';
    this.createdAt = moment(created_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
    this.updatedAt = moment(updated_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
  }
}

module.exports = Brand;