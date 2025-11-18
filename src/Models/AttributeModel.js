// models/Attribute.js
class Attribute {
    constructor({ id, name, admin_label, values }) {
        this.id = id;
        this.name = name;
        this.adminLabel = admin_label;
        // The check for `values[0]` handles cases where there are no values (returns `[null]` from SQL)
        this.values = (values && values[0]) ? values : [];
    }
}
module.exports = Attribute;