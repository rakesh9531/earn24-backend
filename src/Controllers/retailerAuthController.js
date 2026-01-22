const db = require('../../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
    try {
        const { emailOrPhone, password } = req.body;

        const [retailer] = await db.query(
            'SELECT * FROM retailers WHERE (email = ? OR phone_number = ?) AND is_deleted = 0',
            [emailOrPhone, emailOrPhone]
        );

        if (retailer.length === 0) {
            return res.status(404).json({ status: false, message: 'Retailer not found.' });
        }

        const data = retailer[0];

        // Check approval status
        if (data.admin_approval_status !== 'APPROVED') {
            return res.status(403).json({ status: false, message: 'Your account is pending approval or rejected.' });
        }
        
        // Check active status
        if (data.is_active === 0) {
            return res.status(403).json({ status: false, message: 'Your account has been suspended.' });
        }

        // Check Password
        const isMatch = await bcrypt.compare(password, data.password);
        if (!isMatch) {
            return res.status(401).json({ status: false, message: 'Invalid credentials.' });
        }

        // Generate Token
        const token = jwt.sign(
            { id: data.id, role: 'retailer' },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        res.status(200).json({
            status: true,
            message: 'Login successful',
            token,
            retailer: {
                id: data.id,
                shopName: data.shop_name,
                ownerName: data.owner_name,
                email: data.email
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: 'Server Error' });
    }
};