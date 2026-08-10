// Controllers/returnController.js (FULL REWRITE)
// Handles: Return requests, Replacement requests, Merchant actions, Admin resolution, Refunds
const db    = require('../../db');
const moment = require('moment-timezone');
const IST   = 'Asia/Kolkata';

const RETURN_WINDOW_DAYS      = 7;
const REPLACEMENT_WINDOW_DAYS = 7;

// ─────────────────────────────────────────────────────────────
// CUSTOMER: POST /returns/submit
// Submit a Return OR Replacement request
// ─────────────────────────────────────────────────────────────
exports.submitReturnRequest = async (req, res) => {
    const userId = req.user.id;
    const {
        orderId,
        orderItemId,
        requestType,   // 'RETURN' | 'REPLACEMENT'
        reason,
        evidence_images // array of image URLs or base64
    } = req.body;

    if (!orderId || !orderItemId || !reason || !requestType) {
        return res.status(400).json({ status: false, message: 'orderId, orderItemId, requestType, and reason are required.' });
    }
    if (!['RETURN', 'REPLACEMENT'].includes(requestType)) {
        return res.status(400).json({ status: false, message: 'requestType must be RETURN or REPLACEMENT.' });
    }

    try {
        // 1. Verify order belongs to user and is DELIVERED
        const [[order]] = await db.query(
            `SELECT id, order_status, delivered_at, updated_at FROM orders WHERE id = ? AND user_id = ?`,
            [orderId, userId]
        );
        if (!order) return res.status(404).json({ status: false, message: 'Order not found.' });
        if (order.order_status !== 'DELIVERED') {
            return res.status(400).json({ status: false, message: 'Requests can only be made for DELIVERED orders.' });
        }

        // 2. Check window (delivered_at preferred, fallback updated_at)
        const deliveryDate = order.delivered_at || order.updated_at;
        const windowDays = requestType === 'RETURN' ? RETURN_WINDOW_DAYS : REPLACEMENT_WINDOW_DAYS;
        const daysDiff = (Date.now() - new Date(deliveryDate).getTime()) / (1000 * 3600 * 24);
        if (daysDiff > windowDays) {
            return res.status(400).json({
                status: false,
                message: `${requestType === 'RETURN' ? 'Return' : 'Replacement'} policy window (${windowDays} days) has expired for this order.`
            });
        }

        // 3. Check duplicate request
        const [[existing]] = await db.query(
            `SELECT id FROM order_returns WHERE order_item_id = ? AND request_type = ? AND status NOT IN ('REJECTED','CLOSED')`,
            [orderItemId, requestType]
        );
        if (existing) {
            return res.status(400).json({ status: false, message: `A ${requestType.toLowerCase()} request for this item is already in progress.` });
        }

        // 4. Get order item & merchant info
        const [[item]] = await db.query(
            `SELECT oi.*, sp.seller_id as merchant_seller_id
             FROM order_items oi
             JOIN seller_products sp ON oi.seller_product_id = sp.id
             WHERE oi.id = ? AND oi.order_id = ?`,
            [orderItemId, orderId]
        );
        if (!item) return res.status(404).json({ status: false, message: 'Order item not found.' });

        // Get merchant_id from sellers table
        const [[sellerRow]] = await db.query(
            `SELECT sellerable_id FROM sellers WHERE id = ? AND sellerable_type = 'Merchant'`,
            [item.merchant_seller_id]
        );
        const merchantId = sellerRow?.sellerable_id || null;

        // 5. Insert request
        const [result] = await db.query(`
            INSERT INTO order_returns
              (order_id, order_item_id, user_id, merchant_id, return_type, request_type,
               reason, evidence_images, refund_amount, status,
               merchant_action, admin_action, refund_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 'PENDING', 'PENDING', 'NOT_INITIATED')
        `, [
            orderId, orderItemId, userId, merchantId,
            requestType === 'RETURN' ? 'RETURN' : 'REPLACEMENT',
            requestType, reason,
            evidence_images ? JSON.stringify(evidence_images) : null,
            item.total_price
        ]);

        res.status(201).json({
            status: true,
            message: `${requestType === 'RETURN' ? 'Return' : 'Replacement'} request submitted successfully. Merchant will review within 48 hours.`,
            requestId: result.insertId
        });

    } catch (err) {
        console.error('[Return] submitReturnRequest error:', err);
        res.status(500).json({ status: false, message: 'An error occurred.' });
    }
};

// ─────────────────────────────────────────────────────────────
// CUSTOMER: GET /returns/my-requests
// ─────────────────────────────────────────────────────────────
exports.getMyReturnRequests = async (req, res) => {
    const userId = req.user.id;
    try {
        const [rows] = await db.query(`
            SELECT r.*, o.order_number,
                   m.business_name as merchant_name,
                   p.name as product_name
            FROM order_returns r
            JOIN orders o ON r.order_id = o.id
            LEFT JOIN merchants m ON r.merchant_id = m.id
            LEFT JOIN order_items oi ON r.order_item_id = oi.id
            LEFT JOIN seller_products sp ON oi.seller_product_id = sp.id
            LEFT JOIN products p ON sp.product_id = p.id
            WHERE r.user_id = ?
            ORDER BY r.created_at DESC
        `, [userId]);

        res.json({ status: true, data: rows });
    } catch (err) {
        console.error('[Return] getMyReturnRequests error:', err);
        res.status(500).json({ status: false, message: 'Could not fetch requests.' });
    }
};

// ─────────────────────────────────────────────────────────────
// MERCHANT: GET /merchant/returns — See return requests for their products
// ─────────────────────────────────────────────────────────────
exports.getMerchantReturnRequests = async (req, res) => {
    const merchantId = req.user.id;
    const { status } = req.query;

    try {
        let where = 'WHERE r.merchant_id = ?';
        const params = [merchantId];
        if (status) { where += ' AND r.status = ?'; params.push(status); }

        const [rows] = await db.query(`
            SELECT r.*, o.order_number,
                   u.full_name as customer_name,
                   IFNULL(u.mobile_number,'') as customer_phone,
                   p.name as product_name
            FROM order_returns r
            JOIN orders o ON r.order_id = o.id
            JOIN users u ON r.user_id = u.id
            LEFT JOIN order_items oi ON r.order_item_id = oi.id
            LEFT JOIN seller_products sp ON oi.seller_product_id = sp.id
            LEFT JOIN products p ON sp.product_id = p.id
            ${where}
            ORDER BY r.created_at DESC
        `, params);

        res.json({ status: true, data: rows });
    } catch (err) {
        console.error('[Return] getMerchantReturnRequests error:', err);
        res.status(500).json({ status: false, message: 'Could not fetch requests.' });
    }
};

// ─────────────────────────────────────────────────────────────
// MERCHANT: PATCH /merchant/returns/:id/action
// Merchant accepts or disputes a return/replacement
// ─────────────────────────────────────────────────────────────
exports.merchantReturnAction = async (req, res) => {
    const merchantId = req.user.id;
    const { id }     = req.params;
    const { action, merchant_notes } = req.body;  // action: 'ACCEPTED' | 'DISPUTED'

    if (!['ACCEPTED', 'DISPUTED'].includes(action)) {
        return res.status(400).json({ status: false, message: 'action must be ACCEPTED or DISPUTED.' });
    }

    try {
        const [[ret]] = await db.query(
            `SELECT * FROM order_returns WHERE id = ? AND merchant_id = ?`,
            [id, merchantId]
        );
        if (!ret) return res.status(404).json({ status: false, message: 'Return request not found.' });
        if (ret.merchant_action !== 'PENDING') {
            return res.status(400).json({ status: false, message: 'You have already taken action on this request.' });
        }

        let newStatus = ret.status;

        if (action === 'ACCEPTED') {
            // Merchant accepts → goes to admin for final approval
            newStatus = 'MERCHANT_ACCEPTED';
        } else {
            // Merchant disputes → escalated to admin
            newStatus = 'DISPUTED';
        }

        await db.query(`
            UPDATE order_returns
            SET merchant_action = ?, merchant_notes = ?, status = ?
            WHERE id = ?
        `, [action, merchant_notes || null, newStatus, id]);

        res.json({
            status: true,
            message: action === 'ACCEPTED'
                ? 'Return accepted. Admin will initiate refund/replacement.'
                : 'Request disputed. Admin will review and take final decision.'
        });
    } catch (err) {
        console.error('[Return] merchantReturnAction error:', err);
        res.status(500).json({ status: false, message: 'Could not process action.' });
    }
};

// ─────────────────────────────────────────────────────────────
// ADMIN: GET /admin/returns — All return/replacement requests
// ─────────────────────────────────────────────────────────────
exports.adminGetAllReturnRequests = async (req, res) => {
    const { status, requestType, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    try {
        let where = 'WHERE 1=1';
        const params = [];
        if (status)      { where += ' AND r.status = ?'; params.push(status); }
        if (requestType) { where += ' AND r.request_type = ?'; params.push(requestType); }

        const [rows] = await db.query(`
            SELECT r.*, o.order_number,
                   u.full_name as customer_name, IFNULL(u.mobile_number,'') as customer_phone,
                   m.business_name as merchant_name,
                   p.name as product_name
            FROM order_returns r
            JOIN orders o ON r.order_id = o.id
            JOIN users u ON r.user_id = u.id
            LEFT JOIN merchants m ON r.merchant_id = m.id
            LEFT JOIN order_items oi ON r.order_item_id = oi.id
            LEFT JOIN seller_products sp ON oi.seller_product_id = sp.id
            LEFT JOIN products p ON sp.product_id = p.id
            ${where}
            ORDER BY r.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

        const [[{ total }]] = await db.query(
            `SELECT COUNT(*) as total FROM order_returns r ${where}`,
            params
        );

        res.json({ status: true, data: rows, total, page: parseInt(page) });
    } catch (err) {
        console.error('[Admin Return] getAll error:', err);
        res.status(500).json({ status: false, message: 'Could not fetch return requests.' });
    }
};

// ─────────────────────────────────────────────────────────────
// ADMIN: PATCH /admin/returns/:id/resolve
// Final decision: APPROVED or REJECTED
// ─────────────────────────────────────────────────────────────
exports.adminResolveReturn = async (req, res) => {
    const { id }  = req.params;
    const { action, admin_notes } = req.body; // action: 'APPROVED' | 'REJECTED'

    if (!['APPROVED', 'REJECTED'].includes(action)) {
        return res.status(400).json({ status: false, message: 'action must be APPROVED or REJECTED.' });
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const [[ret]] = await conn.query(`SELECT * FROM order_returns WHERE id = ?`, [id]);
        if (!ret) return res.status(404).json({ status: false, message: 'Return request not found.' });

        let newStatus   = action === 'APPROVED' ? 'APPROVED' : 'REJECTED';
        let refundStatus = ret.refund_status;

        if (action === 'APPROVED') {
            if (ret.request_type === 'RETURN') {
                // Initiate refund to customer wallet
                await conn.query(`
                    INSERT INTO user_wallet_transactions
                      (user_id, amount, type, description, reference_id)
                    VALUES (?, ?, 'CREDIT', 'Refund for return request #${id}', ?)
                    ON DUPLICATE KEY UPDATE amount = VALUES(amount)
                `, [ret.user_id, ret.refund_amount, id]);

                // Update user wallet balance
                await conn.query(`
                    UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?
                `, [ret.refund_amount, ret.user_id]);

                // Deduct from merchant wallet (claw back)
                if (ret.merchant_id) {
                    const platformFee = ret.refund_amount * 0.10;
                    const netAmount   = ret.refund_amount - platformFee;
                    await conn.query(`
                        UPDATE merchant_wallet
                        SET pending_amount   = GREATEST(0, pending_amount - ?),
                            available_amount = GREATEST(0, available_amount - ?),
                            total_earned     = GREATEST(0, total_earned - ?)
                        WHERE merchant_id = ?
                    `, [netAmount, netAmount, netAmount, ret.merchant_id]);

                    // Mark transaction as REFUNDED
                    await conn.query(`
                        UPDATE merchant_transactions SET status = 'REFUNDED'
                        WHERE order_id = ? AND merchant_id = ?
                    `, [ret.order_id, ret.merchant_id]);
                }

                refundStatus = 'COMPLETED';
                newStatus    = 'REFUNDED';
            } else {
                // REPLACEMENT — just mark dispatched (actual dispatch is manual)
                newStatus = 'REPLACEMENT_INITIATED';
                refundStatus = 'NOT_INITIATED';
            }
        }

        await conn.query(`
            UPDATE order_returns
            SET admin_action = ?, admin_notes = ?, status = ?, refund_status = ?
            WHERE id = ?
        `, [action, admin_notes || null, newStatus, refundStatus, id]);

        await conn.commit();
        res.json({
            status: true,
            message: action === 'APPROVED'
                ? `${ret.request_type === 'RETURN' ? 'Refund of ₹' + ret.refund_amount + ' credited to customer wallet.' : 'Replacement initiated.'}`
                : 'Request rejected. Customer has been notified.'
        });
    } catch (err) {
        await conn.rollback();
        console.error('[Admin Return] resolve error:', err);
        res.status(500).json({ status: false, message: 'Could not resolve request.' });
    } finally {
        conn.release();
    }
};
