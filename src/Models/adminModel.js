class Admin {
  constructor({
    id,
    full_name,
    username,
    password,
    email,
    phone_number,
    role,
    status,
    admin_pic,
    is_online,
    is_deleted,
    created_at,
    updated_at
  }) {
    this.id = id;
    this.fullName = full_name;
    this.username = username;
    this.password = password;
    this.email = email;
    this.phoneNumber = phone_number;
    this.role = role;
    this.status = status;
    this.adminPic = admin_pic;
    this.isOnline = is_online;
    this.isDeleted = is_deleted;
    this.createdAt = created_at;
    this.updatedAt = updated_at;
  }
}

module.exports = Admin;
