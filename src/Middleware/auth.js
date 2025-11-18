// const jwt = require('jsonwebtoken');
// require('dotenv').config();

// // Middleware to verify JWT and extract user/admin details
// const auth = (req, res, next) => {
//     let token = req.header('Authorization');
    
//     // Check if the token is provided
//     if (!token) {
//         return res.status(401).json({ error: "Access denied. No token provided." });
//     }

//     // If token starts with 'Bearer ', extract the token part only
//     if (token.startsWith("Bearer ")) {
//         token = token.split(" ")[1]; // Remove 'Bearer ' from the token
//     }

//     try {
//         const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
//         req.user = decoded; // Attach decoded user data to the request
//         next();
//     } catch (err) {
//         return res.status(403).json({ status: false, message: 'Invalid or expired token.' });
//     }
// };

// // Middleware to check admin role
// const isAdmin = (req, res, next) => {
//     if (req.user.role == 'user') {
//         return res.status(403).json({ status: false, message: 'Access Denied. Admins only.' });
//     }
//     next();
// };

// module.exports ={
//     auth,
//     isAdmin
// }






// File: /Middleware/auth.js

const jwt = require('jsonwebtoken');
const { permissions } = require('../utils/permissions'); // Import your permissions map
require('dotenv').config();

const auth = (req, res, next) => {
    let token = req.header('Authorization');

    if (!token) {
        return res.status(401).json({ status: false, message: "Access Denied. No token provided." });
    }
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
