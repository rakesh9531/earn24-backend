const Joi = require('joi');

exports.registerUserValidator = (data) => {
    const schema = Joi.object({
        full_name: Joi.string().min(3).max(100).required(),
        username: Joi.string().alphanum().min(3).max(50).required(),
        email: Joi.string().email().required(),
        
       mobile_number: Joi.string().length(10).pattern(/^[0-9]+$/).required().messages({
            'string.length': 'Mobile number must be exactly 10 digits.',
            'string.pattern.base': 'Mobile number must only contain digits.',
            'any.required': 'Mobile number is required.'
        }),

        password: Joi.string().min(6).required(),
        referral_code: Joi.string().allow(null, '').optional(),
        default_sponsor: Joi.boolean().required(),
        device_token: Joi.string().allow(null, '').optional(),
    })
    .custom((value, helpers) => {
        if (value.referral_code && value.default_sponsor) {
            return helpers.message('Cannot provide a referral code and also be a default sponsor.');
        }
        return value;
    });

    return schema.validate(data, { abortEarly: false });
};

// User Login Validator (Corrected with Improved Messages)

exports.loginUserValidator = (data) => {
  const schema = Joi.object({
    // The validation rule itself is the same (Joi.string().required())
    // Only the custom error messages are updated for clarity.
    login: Joi.string().required().messages({
      'any.required': 'Username, email, or mobile number is required', // <-- UPDATED
      'string.empty': 'Username, email, or mobile number cannot be empty' // <-- UPDATED
    }),
    password: Joi.string().min(6).required().messages({
      'string.min': 'Password must be at least 6 characters',
      'any.required': 'Password is required'
    })
  });

  return schema.validate(data, { abortEarly: false });
};