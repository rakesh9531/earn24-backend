const jwt = require('jsonwebtoken');
const db = require('../../db');

exports.retailerAuth = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1]; // Bearer <token>

        if (!token) {
            return res.status(401).json({ status: false, message: 'Access denied. No token provided.' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Verify if retailer exists and is active
        const [retailer] = await db.query(
            'SELECT * FROM retailers WHERE id = ? AND is_active = 1 AND is_deleted = 0', 
            [decoded.id]
        );

        if (retailer.length === 0) {
            return res.status(403).json({ status: false, message: 'Retailer account not found or suspended.' });
        }

        req.retailer = retailer[0]; // Attach retailer data to request
        next();

    } catch (error) {
        return res.status(401).json({ status: false, message: 'Invalid Token' });
    }
};