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
            JOIN user_addresses sa ON o.shipping_address_id = sa.id
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






// 1. Just start the trip (Status: OUT_FOR_DELIVERY)
exports.startDelivery = async (req, res) => {
    const { orderId } = req.body;
    try {
        await db.query("UPDATE orders SET order_status = 'OUT_FOR_DELIVERY' WHERE id = ?", [orderId]);
        res.json({ status: true, message: "Delivery started. Customer notified." });
    } catch (e) { res.status(500).json({ status: false, message: e.message }); }
};

// 2. NEW: Trigger OTP only when agent reaches customer
exports.sendDeliveryOTP = async (req, res) => {
    const { orderId } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString(); 
    try {
        const [order] = await db.query(
            "SELECT u.mobile_number FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = ?", [orderId]
        );
        
        await db.query("UPDATE orders SET delivery_otp = ? WHERE id = ?", [otp, orderId]);
        const smsSent = await smsService.sendSms(order[0].mobile_number, otp);
        
        res.json({ status: true, message: "OTP sent to customer.", debug_otp: otp });
    } catch (e) { res.status(500).json({ status: false, message: "Failed to send OTP." }); }
};

// 7. STEP 4: Complete Delivery
exports.completeDelivery = async (req, res) => {
    const { orderId, paymentMode } = req.body;
    try {
        await db.query(
            "UPDATE orders SET order_status='DELIVERED', payment_status='COMPLETED', payment_method=?, delivery_otp=NULL, delivered_at=NOW() WHERE id=?", 
            [paymentMode, orderId]
        );
        res.json({ status: true, message: "Delivery Success!" });
    } catch (e) { res.status(500).json({ status: false, message: e.message }); }
};


exports.getAgentStats = async (req, res) => {
    const agentId = req.user.id;
    try {
        const query = `
            SELECT 
                COUNT(CASE WHEN order_status = 'DELIVERED' THEN 1 END) as delivered_count,
                COUNT(CASE WHEN order_status = 'CANCELLED' THEN 1 END) as rejected_count,
                COUNT(CASE WHEN order_status = 'RETURNED' THEN 1 END) as returned_count,
                SUM(CASE WHEN order_status = 'DELIVERED' AND payment_method = 'COD' THEN total_amount ELSE 0 END) as cash_collected,
                SUM(CASE WHEN order_status = 'DELIVERED' AND payment_method = 'ONLINE' THEN total_amount ELSE 0 END) as online_collected
            FROM orders 
            WHERE delivery_agent_id = ?
        `;
        const [stats] = await db.query(query, [agentId]);
        res.json({ status: true, data: stats[0] });
    } catch (e) {
        res.status(500).json({ status: false, message: e.message });
    }
};



// Add this to Controllers/deliveryAppController.js
exports.cancelAssignment = async (req, res) => {
    const { orderId, reason } = req.body;
    const agentId = req.user.id;

    try {
        // We only allow cancellation if the order is not yet DELIVERED
        const [order] = await db.query(
            "SELECT id FROM orders WHERE id = ? AND delivery_agent_id = ? AND order_status != 'DELIVERED'", 
            [orderId, agentId]
        );

        if (!order[0]) {
            return res.status(404).json({ status: false, message: "Order not found or already delivered." });
        }

        // Reset the agent and set status back to CONFIRMED so Admin can see it again
        const query = `
            UPDATE orders 
            SET delivery_agent_id = NULL, 
                order_status = 'CONFIRMED', 
                delivery_otp = NULL 
            WHERE id = ?
        `;
        await db.query(query, [orderId]);

        // ROBUST: Log the cancellation reason in a separate table if you have one
        console.log(`Order ${orderId} cancelled by agent ${agentId}. Reason: ${reason || 'Not specified'}`);

        res.json({ status: true, message: "Assignment cancelled. Order returned to Admin pool." });
    } catch (e) {
        res.status(500).json({ status: false, message: e.message });
    }
};


// Add this to your backend controller
exports.verifyOTP = async (req, res) => {
    const { orderId, otp } = req.body;
    try {
        const [order] = await db.query("SELECT delivery_otp FROM orders WHERE id = ?", [orderId]);
        
        if (!order[0] || order[0].delivery_otp !== otp) {
            return res.status(400).json({ status: false, message: "Invalid OTP code." });
        }

        res.json({ status: true, message: "OTP Verified. Proceed to payment." });
    } catch (e) {
        res.status(500).json({ status: false, message: e.message });
    }
};




// 1. History: Only Completed or Cancelled orders
exports.getHistory = async (req, res) => {
    const agentId = req.user.id;
    const page = parseInt(req.query.page) || 1; // Default to page 1
    const limit = 10; // Number of records per page
    const offset = (page - 1) * limit;

    try {
        // 1. Get the total count of history items (to calculate total pages)
        const [countResult] = await db.query(
            "SELECT COUNT(*) as total FROM orders WHERE delivery_agent_id = ? AND order_status IN ('DELIVERED', 'CANCELLED')", 
            [agentId]
        );
        const totalItems = countResult[0].total;
        const totalPages = Math.ceil(totalItems / limit);

        // 2. Fetch the paginated data
        const query = `
            SELECT o.order_number, o.total_amount, o.order_status, o.payment_method, 
                   o.delivered_at, u.full_name as customer_name
            FROM orders o
            JOIN users u ON o.user_id = u.id
            WHERE o.delivery_agent_id = ? AND o.order_status IN ('DELIVERED', 'CANCELLED')
            ORDER BY o.delivered_at DESC 
            LIMIT ? OFFSET ?`;
            
        const [rows] = await db.query(query, [agentId, limit, offset]);

        res.json({ 
            status: true, 
            data: rows,
            pagination: {
                currentPage: page,
                totalPages: totalPages,
                totalItems: totalItems
            }
        });
    } catch (e) {
        res.status(500).json({ status: false, message: e.message });
    }
};


exports.getEarningsSummary = async (req, res) => {
    const agentId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    try {
        // 1. Overall Totals (Lifetime)
        const [overall] = await db.query(`
            SELECT 
                SUM(CASE WHEN payment_method = 'COD' THEN total_amount ELSE 0 END) as total_cash_lifetime,
                SUM(CASE WHEN payment_method != 'COD' THEN total_amount ELSE 0 END) as total_online_lifetime,
                COUNT(*) as total_orders_lifetime
            FROM orders WHERE delivery_agent_id = ? AND order_status = 'DELIVERED'`, [agentId]);

        // 2. This Month's Summary
        const [thisMonth] = await db.query(`
            SELECT SUM(total_amount) as amount, COUNT(*) as count 
            FROM orders 
            WHERE delivery_agent_id = ? AND order_status = 'DELIVERED' 
            AND MONTH(delivered_at) = MONTH(CURRENT_DATE()) AND YEAR(delivered_at) = YEAR(CURRENT_DATE())`, [agentId]);

        // 3. Paginated Daily History
        const [dailyCount] = await db.query(`
            SELECT COUNT(DISTINCT DATE(delivered_at)) as totalDays 
            FROM orders WHERE delivery_agent_id = ? AND order_status = 'DELIVERED'`, [agentId]);

        const totalPages = Math.ceil(dailyCount[0].totalDays / limit);

        const dailyQuery = `
            SELECT 
                DATE(delivered_at) as date,
                COUNT(*) as total_deliveries,
                SUM(CASE WHEN payment_method = 'COD' THEN total_amount ELSE 0 END) as cash_collected,
                SUM(CASE WHEN payment_method != 'COD' THEN total_amount ELSE 0 END) as online_collected
            FROM orders 
            WHERE delivery_agent_id = ? AND order_status = 'DELIVERED'
            GROUP BY DATE(delivered_at) ORDER BY date DESC LIMIT ? OFFSET ?`;
            
        const [dailyRows] = await db.query(dailyQuery, [agentId, limit, offset]);

        res.json({ 
            status: true, 
            summary: {
                lifetime: overall[0],
                thisMonth: thisMonth[0]
            },
            dailyStats: dailyRows,
            pagination: { currentPage: page, totalPages }
        });
    } catch (e) { res.status(500).json({ status: false, message: e.message }); }
};