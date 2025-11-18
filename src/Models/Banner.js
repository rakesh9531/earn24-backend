const moment = require('moment-timezone');

class Banner {
    constructor({
        id,
        title,
        image_url,
        link_to,
        display_order,
        is_active,
        created_at,
        updated_at
    }) {
        const timeZone = 'Asia/Kolkata';

        this.id = id;
        this.title = title;
        this.imageUrl = image_url;
        this.linkTo = link_to;
        this.displayOrder = display_order;
        this.isActive = Boolean(is_active);
        this.createdAt = moment(created_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
        this.updatedAt = moment(updated_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
    }
}

module.exports = Banner;