module.exports = function slugify(text) {
  return text.toString().toLowerCase()
    .trim()
    .replace(/\s+/g, '-')       // Replace spaces with -
    .replace(/[^\w\-]+/g, '')   // Remove non-word chars
    .replace(/\-\-+/g, '-')     // Replace multiple hyphens
    .replace(/^-+/, '')         // Trim start
    .replace(/-+$/, '');        // Trim end
};
