// File: /Controllers/authController.js

const db = require('../../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Joi = require('joi'); // Assuming you use Joi for validation
require('dotenv').config();

// ==========================================================
// === VALIDATORS (Moved here for self-containment)
// ==========================================================

// Validator for user login
const loginUserValidator = (data) => {
  const schema = Joi.object({
    login: Joi.string().required(),
    password: Joi.string().required()
  });
  return schema.validate(data);
};

// Validator for admin login
const loginAdminValidator = (data) => {
    const schema = Joi.object({
      emailOrPhone: Joi.string().required(),
      password: Joi.string().required()
    });
    return schema.validate(data);
  };

// ==========================================================
// === Admin Login Function (Your code, with necessary fixes)
// ==========================================================
exports.adminLogin = async (req, res) => {
    try {
        const { error } = loginAdminValidator(req.body);
        if (error) {
            return res.status(400).json({
                status: false,
                message: error.details[0].message
            });
        }
        
        const { emailOrPhone, password } = req.body;

        // Query now includes a check for active status
        const [adminRows] = await db.query(
            "SELECT * FROM admins WHERE (email = ? OR phone_number = ?) AND is_deleted = 0 AND status = 'active'",
            [emailOrPhone, emailOrPhone]
        );

        if (adminRows.length === 0) {
            return res.status(401).json({
                status: false,
                message: "Invalid credentials or account is inactive."
            });
        }

        const adminData = adminRows[0];
        const isPasswordValid = await bcrypt.compare(password, adminData.password);

        if (!isPasswordValid) {
            return res.status(401).json({
                status: false,
                message: "Invalid credentials."
            });
        }

        // The JWT payload now includes userType and the specific role
        const payload = {
            id: adminData.id,
            userType: 'Admin',
            role: adminData.role 
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, {
            expiresIn: process.env.JWT_EXPIRES_IN || '1d'
        });

        res.status(200).json({
            status: true,
            message: "Login successful.",
            token,
            data: {
                id: adminData.id,
                full_name: adminData.full_name,
                email: adminData.email,
                phoneNumber: adminData.phone_number,
                role: adminData.role,
                admin_pic: adminData.admin_pic,
            }
        });
    } catch (error) {
        console.error('Error in adminLogin:', error);
        res.status(500).json({
            status: false,
            error: error.message,
            message: "Internal server error"
        });
    }
};

// ==========================================================
// === User Login Function (Your code, with necessary fixes)
// ==========================================================
exports.userLogin = async (req, res) => {
  try {
    const { error } = loginUserValidator(req.body);
    if (error) {
      return res.status(400).json({
        status: false,
        message: 'Validation failed',
        errors: error.details.map(err => err.message)
      });
    }

    const { login, password } = req.body;

    // Query now includes a check for active status
    const [users] = await db.query(
      'SELECT * FROM users WHERE (username = ? OR email = ? OR mobile_number = ?) AND is_active = 1 AND is_deleted = 0 LIMIT 1',
      [login, login, login]
    );

    if (users.length === 0) {
      return res.status(401).json({ status: false, message: 'Invalid credentials or account is inactive.' });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ status: false, message: 'Invalid credentials.' });
    }

    // The JWT payload now includes userType
    const payload = {
        id: user.id,
        userType: 'User',
        username: user.username
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.status(200).json({
      status: true,
      message: 'Login successful',
      token,
      data: {
        id: user.id,
        full_name: user.full_name,
        username: user.username,
        email: user.email,
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ status: false, message: 'Server error' });
  }
};


exports.merchantLogin = async (req, res) => {
    try {
        const { emailOrPhone, password } = req.body;
        if (!emailOrPhone || !password) {
            return res.status(400).json({ status: false, message: 'Identifier and password are required.' });
        }
        
        const result = await genericLogin(emailOrPhone, password, 'merchants', 'Merchant');
        
        res.status(200).json({ status: true, message: 'Merchant login successful.', ...result });
    } catch (error) {
        res.status(401).json({ status: false, message: error.message });
    }
};



exports.retailerLogin = async (req, res) => {
    try {
        const { emailOrPhone, password } = req.body;
        // ... (login logic) ...
        const result = await genericLogin(emailOrPhone, password, 'retailers', 'Retailer');
        res.status(200).json({ status: true, message: 'Retailer login successful.', ...result });
    } catch (error) {
        res.status(401).json({ status: false, message: error.message });
    }
};