const Joi = require('joi');


exports.createAdminSchema = Joi.object({
  full_name: Joi.string().min(3).required(),
  username: Joi.string().alphanum().min(3).max(30).required(),
  password: Joi.string().min(6).required(),
  email: Joi.string().email().required(),
  phone_number: Joi.string().pattern(/^[0-9]{10}$/).required(),
  role: Joi.string().valid('admin', 'manager', 'staff').required(),
  status: Joi.string().valid('active', 'inactive').optional(),
  admin_pic: Joi.string().allow(null, '')
});

