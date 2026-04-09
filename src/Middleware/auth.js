// File: /Middleware/auth.js

const jwt = require('jsonwebtoken');
const { permissions } = require('../utils/permissions'); // Import your permissions map
require('dotenv').config();

const auth = (req, res, next) => {
    // Check for token in Authorization header OR in query parameter
    let token = req.header('Authorization') || req.query.token;

    if (!token) {
        return res.status(401).json({ status: false, message: "Access Denied. No token provided." });
    }
    
    // If it's from the header and starts with 'Bearer ', strip it
    if (token.startsWith("Bearer ")) {
        token = token.substring(7);
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // The payload contains { id, userType, role }
        next();
    } catch (err) {
        return res.status(403).json({ status: false, message: 'Authentication failed. Invalid or expired token.' });
    }
};

const can = (requiredPermission) => {
    return (req, res, next) => {
        const userRole = req.user?.role;
        if (!userRole) {
            return res.status(403).json({ status: false, message: 'Permission Denied: User role not found in token.' });
        }

        // ✅ Always allow admin
        if (userRole === 'admin') {
            return next();
        }

        const userPermissions = permissions[userRole];
        if (!userPermissions) {
            return res.status(403).json({ status: false, message: `Permission Denied: Role '${userRole}' has no defined permissions.` });
        }
        if (userPermissions.includes(requiredPermission) || userPermissions.includes('*')) {
            next(); // Permission granted
        } else {
            return res.status(403).json({ status: false, message: 'Permission Denied: You do not have the required clearance for this action.' });
        }
    };
};

module.exports = {
    auth,
    can
};
