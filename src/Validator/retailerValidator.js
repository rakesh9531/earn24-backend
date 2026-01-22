const Joi = require('joi');

const createRetailerSchema = Joi.object({
    // Changed to camelCase to match Frontend
    shopName: Joi.string().min(3).max(100).required().label('Shop Name'),
    ownerName: Joi.string().min(3).max(100).required().label('Owner Name'),
    email: Joi.string().email().required().label('Email'),
    phoneNumber: Joi.string().pattern(/^[0-9]{10,15}$/).required().messages({'string.pattern.base': 'Phone number must be 10-15 digits'}),
    password: Joi.string().min(6).required().label('Password'),
    
    shopAddress: Joi.string().optional().allow('').label('Address'),
    pincode: Joi.string().required().label('Pincode'),
    gstNumber: Joi.string().optional().allow('').label('GST'),
    panNumber: Joi.string().optional().allow('').label('PAN'),
    
    status: Joi.string().valid('active', 'suspended', 'pending').default('active')
});

const updateStatusSchema = Joi.object({
    status: Joi.string().valid('active', 'suspended', 'pending').required()
});

module.exports = { createRetailerSchema, updateStatusSchema };