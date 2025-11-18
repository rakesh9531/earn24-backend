const Joi = require('joi');

const createCategorySchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  description: Joi.string().allow('', null),
  is_active: Joi.boolean().optional()
});

module.exports = { createCategorySchema };