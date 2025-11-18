// models/AttributeValue.js
class AttributeValue {
    constructor({ id, attribute_id, value }) {
        this.id = id;
        this.attributeId = attribute_id;
        this.value = value;
    }
}
module.exports = AttributeValue;