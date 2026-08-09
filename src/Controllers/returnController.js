const db = require('../../db');
const shiprocketService = require('../Services/shiprocketService');

/**
 * Customer submits a Return or Replacement request
 */
exports.submitReturnRequest = async (req, res) => {
    const userId = req.user.id;
    const { orderId, orderItemId, returnType, reason, images } = req.body;

    if (!orderId || !orderItemId || !reason) {
        return res.status(400).json({ status: false, message: "Order ID, Item ID, and Reason are required." });
    }

    try {
        // 1. Verify order belongs to user and is DELIVERED
        const [orderRows] = await db.query(
            "SELECT id, order_status, updated_at FROM orders WHERE id = ? AND user_id = ?",
            [orderId, userId]
        );

        if (orderRows.length === 0) {
            return res.status(404).json({ status: false, message: "Order not found." });
        }

        const order = orderRows[0];
        if (order.order_status !== 'DELIVERED') {
            return res.status(400).json({ status: false, message: "Return can only be requested for DELIVERED orders." });
        }

        // 2. Check 7-Day Policy Window
        const deliveryDate = new Date(order.updated_at);
        const daysDiff = (Date.now() - deliveryDate.getTime()) / (1000 * 3600 * 24);
        if (daysDiff > 7) {
            return res.status(400).json({ status: false, message: "Return policy window (7 days) has expired for this order." });
        }

        // 3. Get item & merchant info
        const [itemRows] = await db.query(
            "SELECT seller_product_id, total_price FROM order_items WHERE id = ? AND order_id = ?",
            [orderItemId, orderId]
        );

        if (itemRows.length === 0) {
            return res.status(404).json({ status: false, message: "Order item not found." });
        }

        const item = itemRows[0];
        const [spRows] = await db.query(
            "SELECT seller_id FROM seller_products WHERE id = ?",
            [item.seller_product_id]
        );
        const merchantId = spRows[0] ? spRows[0].seller_id : 1;

        // 4. Insert Return Record
        const sql = `
            INSERT INTO order_returns 
            (order_id, order_item_id, user_id, merchant_id, return_type, reason, images_json, refund_amount, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
        `;
        const [result] = await db.query(sql, [
            orderId, orderItemId, userId, merchantId, returnType || 'RETURN', reason,
            images ? JSON.stringify(images) : null, item.total_price
        ]);

        res.status(201).json({
            status: true,
            message: "Return request submitted successfully. Waiting for merchant/admin approval.",
            returnId: result.insertId
        });

    } catch (error) {
        console.error("Error submitting return request:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};

/**
 * Fetches return requests for Admin / Merchant
 */
exports.getReturnRequests = async (req, res) => {
    try {
        const { status, role, userId } = req.query;
        let query = `
            SELECT r.*, o.order_number, u.full_name as user_name, u.phone_number as user_phone
            FROM order_returns r
            JOIN orders o ON r.order_id = o.id
            JOIN users u ON r.user_id = u.id
        `;
        const queryParams = [];

        if (status) {
            query += " WHERE r.status = ?";
            queryParams.push(status);
        }

        query += " ORDER BY r.created_at DESC";

        const [rows] = await db.query(query, queryParams);
        res.status(200).json({ status: true, data: rows });
    } catch (error) {
        console.error("Error fetching return requests:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};

/**
 * Approve or Reject Return Request
 */
exports.actionReturnRequest = async (req, res) => {
    const { returnId } = req.params;
    const { action, adminNotes } = req.body; // action: 'APPROVED' or 'REJECTED'

    if (!['APPROVED', 'REJECTED'].includes(action)) {
        return res.status(400).json({ status: false, message: "Invalid action. Must be APPROVED or REJECTED." });
    }

    try {
        const [returnRows] = await db.query("SELECT * FROM order_returns WHERE id = ?", [returnId]);
        if (returnRows.length === 0) {
            return res.status(404).json({ status: false, message: "Return request not found." });
        }

        const ret = returnRows[0];
        const newStatus = action === 'APPROVED' ? 'PICKUP_INITIATED' : 'REJECTED';

        await db.query(
            "UPDATE order_returns SET status = ?, admin_notes = ? WHERE id = ?",
            [newStatus, adminNotes || null, returnId]
        );

        res.status(200).json({
            status: true,
            message: `Return request ${action.toLowerCase()} successfully.`
        });
    } catch (error) {
        console.error("Error taking action on return request:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};
