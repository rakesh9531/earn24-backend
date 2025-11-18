class Category {
  constructor({
    id,
    name,
    slug,
    description,
    image_url,
    is_active,
    is_deleted,
    created_at,
    updated_at
  }) {
    this.id = id;
    this.name = name;
    this.slug = slug;
    this.description = description;
    this.imageUrl = image_url;
    this.isActive = is_active;
    this.isDeleted = is_deleted;
    this.createdAt = created_at;
    this.updatedAt = updated_at;
  }
}

module.exports = Category;
