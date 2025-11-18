class User {
    constructor({
        id,
        full_name,
        username,
        password,
        email,
        mobile_number,    // <-- ADDED
        referral_code,
        default_sponsor,
        sponsor_id,       // <-- ADDED
        device_token,
        is_online,
        is_active,  // You have this
        is_deleted,
        user_pic,
        created_at,
        updated_at
    }) {
        this.id = id;
        this.fullName = full_name;
        this.username = username;
        this.password = password;
        this.email = email;
        this.mobileNumber = mobile_number; // <-- ADDED
        this.referralCode = referral_code;
        this.defaultSponsor = default_sponsor;
        this.sponsorId = sponsor_id;       // <-- ADDED
        this.deviceToken = device_token;
        this.isOnline = is_online;
        this.isActive = is_active;
        this.isDeleted = is_deleted;
        this.userPic = user_pic;
        this.createdAt = created_at;
        this.updatedAt = updated_at;
    }
}

module.exports = User;