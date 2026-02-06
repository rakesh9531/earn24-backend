const db = require('../../db');

/**
 * Fetches orders for the admin panel, filterable by status.
 * Primarily used to get 'CONFIRMED' orders that need to be processed.
 */
exports.getOrdersByStatus = async (req, res) => {
    // Default to fetching 'CONFIRMED' orders if no status is provided
    const status = req.query.status || 'CONFIRMED';
    
    try {
        const query = `
            SELECT o.id, o.order_number, o.total_amount, o.order_status, o.created_at, u.full_name as customer_name
            FROM orders o
            JOIN users u ON o.user_id = u.id
            WHERE o.order_status = ?
            ORDER BY o.created_at ASC
        `;
        const [orders] = await db.query(query, [status]);

        res.status(200).json({ status: true, data: orders });
    } catch (error) {
        console.error("Error fetching orders by status:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};


/**
 * Assigns an order to a delivery agent.
 * This action changes the order status to 'SHIPPED'.
 */
exports.assignOrderForDelivery = async (req, res) => {
    const { orderId } = req.params;
    const { deliveryAgentId } = req.body;

    if (!deliveryAgentId) {
        return res.status(400).json({ status: false, message: "Delivery Agent ID is required." });
    }

    try {
        // First, check if the order is in a state that can be shipped (i.e., 'CONFIRMED')
        const [orderRows] = await db.query('SELECT order_status FROM orders WHERE id = ?', [orderId]);
        if (orderRows.length === 0) {
            return res.status(404).json({ status: false, message: "Order not found." });
        }
        if (orderRows[0].order_status !== 'CONFIRMED') {
            return res.status(409).json({ status: false, message: `Cannot ship an order with status '${orderRows[0].order_status}'.` });
        }

        // Update the order status and assign the delivery agent
        const query = "UPDATE orders SET order_status = 'SHIPPED', delivery_agent_id = ? WHERE id = ?";
        const [result] = await db.query(query, [deliveryAgentId, orderId]);

        if (result.affectedRows === 0) {
            // This case is unlikely if the above check passed, but it's good for safety
            return res.status(404).json({ status: false, message: 'Order not found.' });
        }

        // TODO: In a real app, you would send a push notification to the delivery agent here.

        res.status(200).json({ status: true, message: "Order assigned for delivery successfully." });

    } catch (error) {
        console.error("Error assigning order for delivery:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};



// exports.getAdminOrderDetails = async (req, res) => {
//     const { orderId } = req.params;
//     try {
//         // Fetch main order details, customer info, and address info in one query
//         const orderQuery = `
//             SELECT 
//                 o.*, 
//                 u.full_name as customer_name, 
//                 u.mobile_number as customer_phone,
//                 ua.address_line_1,
//                 ua.address_line_2,
//                 ua.city,
//                 ua.state,
//                 ua.pincode,
//                 ua.landmark
//             FROM orders o 
//             JOIN users u ON o.user_id = u.id
//             LEFT JOIN user_addresses ua ON o.shipping_address_id = ua.id
//             WHERE o.id = ?
//         `;
//         const [orderRows] = await db.query(orderQuery, [orderId]);
//         if (orderRows.length === 0) {
//             return res.status(404).json({ status: false, message: 'Order not found.' });
//         }
        
//         // Fetch all line items for this order
//         const itemsQuery = `
//             SELECT 
//                 oi.product_name, oi.quantity, oi.price_per_unit, oi.total_price,
//                 p.main_image_url 
//             FROM order_items oi
//             JOIN products p ON oi.product_id = p.id
//             WHERE oi.order_id = ?
//         `;
//         const [itemRows] = await db.query(itemsQuery, [orderId]);

//         // Combine the results into a single, clean object
//         const orderDetails = {
//             ...orderRows[0], // Includes all fields from the 'orders' table
//             items: itemRows
//         };
        
//         res.status(200).json({ status: true, data: orderDetails });

//     } catch (error) {
//         console.error("Error fetching admin order details:", error);
//         res.status(500).json({ status: false, message: 'An error occurred.' });
//     }
// };







//  Above working 


exports.getAdminOrderDetails = async (req, res) => {
    const { orderId } = req.params;
    try {
        // 1. Fetch main order details, customer info, and address info
        const orderQuery = `
            SELECT 
                o.*, 
                u.full_name as customer_name, 
                u.mobile_number as customer_phone,
                u.email as customer_email,
                ua.address_line_1,
                ua.address_line_2,
                ua.city,
                ua.state,
                ua.pincode,
                ua.landmark,
                da.full_name as agent_name,
                da.phone_number as agent_phone
            FROM orders o 
            JOIN users u ON o.user_id = u.id
            LEFT JOIN user_addresses ua ON o.shipping_address_id = ua.id
            LEFT JOIN delivery_agents da ON o.delivery_agent_id = da.id
            WHERE o.id = ?
        `;
        const [orderRows] = await db.query(orderQuery, [orderId]);
        
        if (orderRows.length === 0) {
            return res.status(404).json({ status: false, message: 'Order not found.' });
        }
        
        // 2. Fetch all line items for this order with Attributes and Brand
        const itemsQuery = `
            SELECT 
                oi.id as order_item_id,
                oi.product_name, 
                oi.quantity, 
                oi.price_per_unit, 
                oi.total_price,
                oi.attributes_snapshot, -- This stores the 'Weight/Size/Color' snapshot
                p.main_image_url,
                b.name as brand_name
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            LEFT JOIN brands b ON p.brand_id = b.id
            WHERE oi.order_id = ?
        `;
        const [itemRows] = await db.query(itemsQuery, [orderId]);

        // 3. Process the items to parse the JSON attributes snapshot
        const processedItems = itemRows.map(item => ({
            ...item,
            // Convert the JSON string from DB into a real Javascript Object/Array
            attributes: item.attributes_snapshot ? (typeof item.attributes_snapshot === 'string' ? JSON.parse(item.attributes_snapshot) : item.attributes_snapshot) : {}
        }));

        // 4. Combine results into a single clean object
        const orderDetails = {
            ...orderRows[0], 
            items: processedItems
        };
        
        res.status(200).json({ status: true, data: orderDetails });

    } catch (error) {
        console.error("Error fetching admin order details:", error);
        res.status(500).json({ status: false, message: 'An internal server error occurred.' });
    }
};





// --------------------------------------------------------------------------------------------------


exports.settleAgentCash = async (req, res) => {
    const { orderId } = req.body;
    const adminId = req.user.id; 

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Fetch order details first to know the amount and agent
        const [order] = await connection.query(
            "SELECT total_amount, delivery_agent_id, order_number FROM orders WHERE id = ? AND payment_method = 'COD' AND order_status = 'DELIVERED' AND is_cash_settled = 0 FOR UPDATE",
            [orderId]
        );

        if (!order[0]) {
            await connection.rollback();
            return res.status(400).json({ status: false, message: "Order not found, not COD, or already settled." });
        }

        const { total_amount, delivery_agent_id, order_number } = order[0];

        // 2. Update the Order as Settled
        await connection.query(
            `UPDATE orders 
             SET is_cash_settled = 1, 
                 cash_settled_at = NOW(), 
                 settled_by_admin_id = ? 
             WHERE id = ?`,
            [adminId, orderId]
        );

        // 3. ROBUST STEP: Create a Ledger Entry for Audit
        // This table should exist to track financial movements
        const ledgerSql = `
            INSERT INTO admin_settlement_logs 
            (admin_id, agent_id, order_id, amount_received, remarks) 
            VALUES (?, ?, ?, ?, ?)`;
        
        await connection.query(ledgerSql, [
            adminId, 
            delivery_agent_id, 
            orderId, 
            total_amount, 
            `Cash received for Order ${order_number}`
        ]);

        await connection.commit();
        res.json({ status: true, message: `₹${total_amount} settled successfully for Order ${order_number}` });

    } catch (e) {
        await connection.rollback();
        console.error("Settlement Error:", e);
        res.status(500).json({ status: false, message: "Internal server error during settlement." });
    } finally {
        connection.release();
    }
};




// 2. POST /api/admin/orders/verify-settlement
exports.verifySettlement = async (req, res) => {
    const { orderId } = req.body;
    const adminId = req.user.id;
    try {
        await db.query(
            "UPDATE orders SET is_cash_settled = 1, cash_settled_at = NOW(), settled_by_admin_id = ? WHERE id = ?",
            [adminId, orderId]
        );
        res.json({ status: true, message: "Cash collection verified and settled!" });
    } catch (e) { res.status(500).json({ status: false, message: e.message }); }
};


// / 1. New function for "All Orders History" page
exports.getAllOrdersHistory = async (req, res) => {
    try {
        const query = `
            SELECT o.*, u.full_name as customer_name, u.mobile_number as customer_phone
            FROM orders o
            JOIN users u ON o.user_id = u.id
            ORDER BY o.created_at DESC`;
        const [rows] = await db.query(query);
        res.json({ status: true, data: rows });
    } catch (e) {
        res.status(500).json({ status: false, message: e.message });
    }
};

// 2. Verified function for Cash Settlement list
exports.getPendingSettlements = async (req, res) => {
    try {
        const query = `
            SELECT o.id, o.order_number, o.total_amount, o.delivered_at,
                   u.full_name as customer_name,
                   da.full_name as agent_name, da.phone_number as agent_phone
            FROM orders o
            JOIN users u ON o.user_id = u.id
            JOIN delivery_agents da ON o.delivery_agent_id = da.id
            WHERE o.payment_method = 'COD' 
            AND o.order_status = 'DELIVERED' 
            AND o.is_cash_settled = 0
            ORDER BY o.delivered_at ASC`;
        const [rows] = await db.query(query);
        res.status(200).json({ status: true, data: rows });
    } catch (e) {
        console.error(e);
        res.status(500).json({ status: false, message: "Server error. Check if is_cash_settled column exists." });
    }
};