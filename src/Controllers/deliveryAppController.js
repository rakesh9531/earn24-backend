const db = require('../../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const smsService = require('../utils/smsHelper'); // Import the SMS utility

/**
 * 1. AGENT LOGIN (Existing)
 */
exports.login = async (req, res) => {
    console.log("LOGIN REQUEST RECEIVED:", req.body); 
    const { phoneNumber, password } = req.body;
    try {
        const [rows] = await db.query("SELECT * FROM delivery_agents WHERE phone_number = ? AND is_active = 1", [phoneNumber]);
        if (rows.length === 0) return res.status(401).json({ status: false, message: "Agent account not found or inactive." });

        const valid = await bcrypt.compare(password, rows[0].password);
        if (!valid) return res.status(401).json({ status: false, message: "Invalid password." });

        const token = jwt.sign({ id: rows[0].id, role: 'delivery_agent' }, process.env.JWT_SECRET, { expiresIn: '24h' });
        res.json({ status: true, token, agent: { name: rows[0].full_name, id: rows[0].id } });
    } catch (e) {
        res.status(500).json({ status: false, message: "Server Error during login." });
    }
};

/**
 * 2. GET ASSIGNED TASKS (Existing)
 */
// exports.getMyOrders = async (req, res) => {
//     const agentId = req.user.id;
//     try {
//         const query = `
//             SELECT o.id, o.order_number, o.total_amount, o.payment_method, o.order_status,
//                    u.full_name as customer_name, u.mobile_number as customer_phone,
//                    sa.address_line1, sa.city, sa.pincode
//             FROM orders o
//             JOIN users u ON o.user_id = u.id
//             JOIN shipping_addresses sa ON o.shipping_address_id = sa.id
//             WHERE o.delivery_agent_id = ? AND o.order_status NOT IN ('DELIVERED', 'CANCELLED')
//             ORDER BY o.created_at DESC
//         `;
//         const [orders] = await db.query(query, [agentId]);
//         res.json({ status: true, data: orders });
//     } catch (e) {
//         res.status(500).json({ status: false, message: e.message });
//     }
// };




exports.getMyOrders = async (req, res) => {
    const agentId = req.user.id;
    try {
        const query = `
            SELECT o.id, o.order_number, o.total_amount, o.payment_method, o.order_status,
                   u.full_name as customer_name, u.mobile_number as customer_phone,
                   sa.address_line_1, sa.address_line_2, sa.city, sa.pincode
            FROM orders o
            JOIN users u ON o.user_id = u.id
            JOIN shipping_addresses sa ON o.shipping_address_id = sa.id
            -- This ensures the agent only sees orders assigned to THEM
            WHERE o.delivery_agent_id = ? 
            AND o.order_status NOT IN ('DELIVERED', 'CANCELLED')
            ORDER BY o.created_at DESC
        `;
        const [orders] = await db.query(query, [agentId]);
        res.json({ status: true, data: orders });
    } catch (e) {
        res.status(500).json({ status: false, message: e.message });
    }
};






/**
 * 3. START DELIVERY (With 2Factor SMS)
 */
exports.startDelivery = async (req, res) => {
    const { orderId } = req.body;
    const agentId = req.user.id;
    const otp = Math.floor(100000 + Math.random() * 900000).toString(); 

    try {
        // 1. Check if this order is actually assigned to THIS agent
        const [order] = await db.query(
            "SELECT o.id, u.mobile_number FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = ? AND o.delivery_agent_id = ?", 
            [orderId, agentId]
        );

        if (!order[0]) {
            return res.status(403).json({ status: false, message: "Unauthorized. This order is not assigned to you." });
        }

        const customerMobile = order[0].mobile_number;

        // 2. Update DB with OTP
        await db.query("UPDATE orders SET delivery_otp = ?, order_status = 'OUT_FOR_DELIVERY' WHERE id = ?", [otp, orderId]);
        
        // 3. Trigger 2Factor SMS
        const smsSent = await smsService.sendSms(customerMobile, otp);
        
        res.json({ 
            status: true, 
            message: smsSent ? "OTP sent to customer." : "Delivery started, but SMS failed. Please use debug OTP.",
            debug_otp: otp // Keep this for testing until your 2Factor is live
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ status: false, message: "Failed to initiate delivery." });
    }
};

/**
 * 4. COMPLETE DELIVERY (Robust Verification)
 */
exports.completeDelivery = async (req, res) => {
    const { orderId, otp, paymentMode } = req.body;
    const agentId = req.user.id;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // Security: Lock the row and check assigned agent + OTP
        const [orderRows] = await connection.query(
            "SELECT delivery_otp, total_amount, order_status FROM orders WHERE id = ? AND delivery_agent_id = ? FOR UPDATE", 
            [orderId, agentId]
        );

        if (!orderRows[0]) throw new Error("Order not found or not assigned to you.");
        if (orderRows[0].delivery_otp !== otp) throw new Error("Invalid Handshake OTP.");

        const updateQuery = `
            UPDATE orders 
            SET order_status = 'DELIVERED', 
                payment_status = 'COMPLETED', 
                delivery_payment_mode = ?, 
                delivery_amount_collected = ?, 
                delivered_at = NOW(),
                delivery_otp = NULL 
            WHERE id = ?
        `;

        await connection.query(updateQuery, [paymentMode, orderRows[0].total_amount, orderId]);

        await connection.commit();
        res.json({ status: true, message: "Verification successful. Order Delivered!" });

    } catch (e) {
        await connection.rollback();
        res.status(400).json({ status: false, message: e.message });
    } finally {
        connection.release();
    }
};