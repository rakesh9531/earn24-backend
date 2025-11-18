// Models/hsnCodeModel.js
const moment = require('moment-timezone');

class HsnCode {
    constructor({
        id,
        hsn_code,
        description,
        gst_percentage,
        is_active,
        created_at,
        updated_at,
    }) {
        const timeZone = 'Asia/Kolkata';

        this.id = id;
        this.hsnCode = hsn_code;
        this.description = description;
        this.gstPercentage = parseFloat(gst_percentage);
        this.isActive = Boolean(is_active);

        // Format timestamps to the correct timezone
        this.createdAt = moment(created_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
        this.updatedAt = moment(updated_at).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
    }
}

module.exports = HsnCode;