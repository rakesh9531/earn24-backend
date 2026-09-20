// Controllers/returnController.js (FULL REWRITE)
// Handles: Return requests, Replacement requests, Merchant actions, Admin resolution, Refunds
const db    = require('../../db');
const moment = require('moment-timezone');
const IST   = 'Asia/Kolkata';

const RETURN_WINDOW_DAYS      = 7;
const REPLACEMENT_WINDOW_DAYS = 7;

let isMigrationChecked = false;
async function safeAddColumn(table, column, def) {
    try {
        const [existing] = await db.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
            [table, column]
        );
        if (!existing || existing.length === 0) {
            await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${def}`);
        }
    } catch (e) {
        await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${def}`).catch(() => {});
    }
}

async function ensureReturnTableColumns() {
    if (isMigrationChecked) return;
    try {
        await db.query(`ALTER TABLE orders MODIFY COLUMN order_number VARCHAR(100);`).catch(() => {});
        await db.query(`ALTER TABLE order_returns MODIFY COLUMN status VARCHAR(50) DEFAULT 'PENDING';`).catch(() => {});
        await db.query(`ALTER TABLE order_returns MODIFY COLUMN merchant_action VARCHAR(50) DEFAULT 'PENDING';`).catch(() => {});
        await db.query(`ALTER TABLE order_returns MODIFY COLUMN admin_action VARCHAR(50) DEFAULT 'PENDING';`).catch(() => {});
        await db.query(`ALTER TABLE order_returns MODIFY COLUMN refund_status VARCHAR(50) DEFAULT 'NOT_INITIATED';`).catch(() => {});
        await db.query(`ALTER TABLE order_returns MODIFY COLUMN evidence_images LONGTEXT NULL;`).catch(() => {});
        
        await safeAddColumn('order_returns', 'merchant_notes', 'TEXT NULL');
        await safeAddColumn('order_returns', 'admin_notes', 'TEXT NULL');
        await safeAddColumn('order_returns', 'variant_attribute_id', 'INT NULL');
        await safeAddColumn('order_returns', 'reverse_awb_code', 'VARCHAR(100) NULL');
        await safeAddColumn('order_returns', 'reverse_courier_name', 'VARCHAR(100) NULL');
        await safeAddColumn('order_returns', 'replacement_awb_code', 'VARCHAR(100) NULL');
        await safeAddColumn('order_returns', 'replacement_courier_name', 'VARCHAR(100) NULL');
        await safeAddColumn('order_returns', 'pickup_otp', 'VARCHAR(10) NULL');
        await safeAddColumn('order_returns', 'delivery_otp', 'VARCHAR(10) NULL');
        await safeAddColumn('order_returns', 'rejection_reason', 'VARCHAR(255) NULL');
        await safeAddColumn('order_returns', 'refund_method', 'VARCHAR(20) DEFAULT "WALLET"');
        await safeAddColumn('order_returns', 'customer_upi_id', 'VARCHAR(100) NULL');
        await safeAddColumn('order_returns', 'delivery_agent_id', 'INT NULL');
        await safeAddColumn('order_returns', 'pickup_scheduled_date', 'DATE NULL');
        await safeAddColumn('order_returns', 'qc_status', 'VARCHAR(20) DEFAULT "PENDING"');
        await safeAddColumn('order_returns', 'qc_remarks', 'TEXT NULL');
        await safeAddColumn('order_returns', 'refund_utr', 'VARCHAR(100) NULL');
        await safeAddColumn('order_returns', 'replacement_order_id', 'INT NULL');
        await safeAddColumn('order_returns', 'pickup_proof_image', 'LONGTEXT NULL');
        await safeAddColumn('order_returns', 'picked_up_at', 'DATETIME NULL');
        await safeAddColumn('order_returns', 'received_at_hub_at', 'DATETIME NULL');
        await safeAddColumn('order_returns', 'received_by_type', 'VARCHAR(50) NULL');
        await safeAddColumn('order_returns', 'received_by_id', 'INT NULL');
        await safeAddColumn('order_returns', 'hub_notes', 'TEXT NULL');
        await safeAddColumn('order_returns', 'return_quantity', 'INT DEFAULT 1');

        isMigrationChecked = true;
    } catch (e) {
        console.warn('[returnController] Auto-migration check warning:', e.message);
    }
}

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
        evidence_images, // array of image URLs or base64
        variant_attribute_id,
        refund_method,
        refundMethod,
        customer_upi_id,
        customerUpiId
    } = req.body;

    const chosenRefundMethod = 'WALLET'; // 100% Policy: all returns credit to user Earn24 Wallet
    const upiId = null;

    if (!orderId || !orderItemId || !reason || !requestType) {
        return res.status(400).json({ status: false, message: 'orderId, orderItemId, requestType, and reason are required.' });
    }
    if (!['RETURN', 'REPLACEMENT'].includes(requestType)) {
        return res.status(400).json({ status: false, message: 'requestType must be RETURN or REPLACEMENT.' });
    }

    try {
        await ensureReturnTableColumns();

        // 1. Verify order belongs to user and is DELIVERED
        const [[order]] = await db.query(
            `SELECT id, order_status, delivered_at, updated_at FROM orders WHERE id = ? AND user_id = ?`,
            [orderId, userId]
        );
        if (!order) return res.status(404).json({ status: false, message: 'Order not found.' });
        if (order.order_status !== 'DELIVERED') {
            return res.status(400).json({ status: false, message: 'Requests can only be made for DELIVERED orders.' });
        }

        // 2. Check policy eligibility & stock for item
        const [[item]] = await db.query(
            `SELECT oi.*, sp.seller_id as merchant_seller_id, sp.stock_quantity as current_stock,
                    IFNULL(sp.has_return_policy, IFNULL(psc.has_return_policy, 0)) as has_return_policy,
                    IFNULL(sp.return_window_days, IFNULL(psc.return_window_days, 7)) as return_window_days,
                    IFNULL(sp.is_replacement_available, IFNULL(psc.is_replacement_available, 0)) as is_replacement_available,
                    IFNULL(sp.replacement_window_days, IFNULL(psc.replacement_window_days, 7)) as replacement_window_days
             FROM order_items oi
             JOIN seller_products sp ON oi.seller_product_id = sp.id
             LEFT JOIN products p ON sp.product_id = p.id
             LEFT JOIN product_subcategories psc ON p.subcategory_id = psc.id
             WHERE oi.id = ? AND oi.order_id = ?`,
            [orderItemId, orderId]
        );
        if (!item) return res.status(404).json({ status: false, message: 'Order item not found.' });

        const canReturn = item.has_return_policy === 1 || item.has_return_policy === true || item.has_return_policy === '1';
        if (requestType === 'RETURN' && !canReturn) {
            return res.status(400).json({ status: false, message: 'Returns are not allowed for this product offer by the seller.' });
        }

        const canReplace = item.is_replacement_available === 1 || item.is_replacement_available === true || item.is_replacement_available === '1';
        if (requestType === 'REPLACEMENT' && !canReplace) {
            return res.status(400).json({ status: false, message: 'Replacements are not allowed for this product offer by the seller.' });
        }

        // Check active delivery window
        const deliveryDate = order.delivered_at || order.updated_at;
        const windowDays = requestType === 'RETURN' ? item.return_window_days : item.replacement_window_days;
        const daysDiff = (Date.now() - new Date(deliveryDate).getTime()) / (1000 * 3600 * 24);
        if (daysDiff > windowDays) {
            return res.status(400).json({
                status: false,
                message: `${requestType === 'RETURN' ? 'Return' : 'Replacement'} window (${windowDays} days) has expired.`
            });
        }

        // Check stock for replacement
        if (requestType === 'REPLACEMENT' && item.current_stock <= 0) {
            return res.status(400).json({
                status: false,
                code: 'OUT_OF_STOCK_FOR_REPLACEMENT',
                message: 'Product is currently out of stock for replacement. Would you like to request a Refund Return instead?'
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

        // Calculate requested quantity and proportionate refund amount
        const orderedQty = parseInt(item.quantity) || 1;
        const requestedQty = Math.min(Math.max(1, parseInt(req.body.quantity || req.body.return_quantity || 1)), orderedQty);
        const unitPrice = (parseFloat(item.total_price || 0) / orderedQty) || parseFloat(item.price_per_unit || item.price || 0);
        const calculatedRefundAmount = (unitPrice * requestedQty).toFixed(2);

        // Get merchant_id from sellers table
        const [[sellerRow]] = await db.query(
            `SELECT sellerable_id FROM sellers WHERE id = ? AND sellerable_type = 'Merchant'`,
            [item.merchant_seller_id]
        );
        const merchantId = sellerRow?.sellerable_id || null;

        // Generate OTPs
        const pickupOtp = Math.floor(1000 + Math.random() * 9000).toString();
        const deliveryOtp = Math.floor(1000 + Math.random() * 9000).toString();

        // 5. Insert request
        const [result] = await db.query(`
            INSERT INTO order_returns
              (order_id, order_item_id, user_id, merchant_id, return_type, request_type,
               reason, evidence_images, refund_amount, return_quantity, status,
               merchant_action, admin_action, refund_status, variant_attribute_id, pickup_otp, delivery_otp,
               refund_method, customer_upi_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 'PENDING', 'PENDING', 'NOT_INITIATED', ?, ?, ?, ?, ?)
        `, [
            orderId, orderItemId, userId, merchantId,
            requestType === 'RETURN' ? 'RETURN' : 'REPLACEMENT',
            requestType, reason,
            evidence_images ? JSON.stringify(evidence_images) : null,
            calculatedRefundAmount,
            requestedQty,
            variant_attribute_id || null,
            pickupOtp,
            deliveryOtp,
            chosenRefundMethod,
            upiId
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
            SELECT r.*, r.admin_remarks as reject_reason, o.order_number,
                   m.business_name as merchant_name,
                   p.name as product_name,
                   COALESCE(p.main_image_url, '') as main_image_url
            FROM order_returns r
            JOIN orders o ON r.order_id = o.id
            LEFT JOIN merchants m ON r.merchant_id = m.id
            LEFT JOIN order_items oi ON r.order_item_id = oi.id
            LEFT JOIN seller_products sp ON oi.seller_product_id = sp.id
            LEFT JOIN products p ON sp.product_id = p.id
            WHERE r.user_id = ?
            ORDER BY r.created_at DESC
        `, [userId]);

        const formattedRows = rows.map(r => ({
            ...r,
            reject_reason: r.admin_remarks || r.merchant_notes || null,
            admin_remarks: r.admin_remarks || r.merchant_notes || null,
            status_display: r.status === 'REJECTED' ? `REJECTED: ${r.admin_remarks || 'Not approved'}` : r.status
        }));

        res.json({ status: true, data: formattedRows });
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
                   p.name as product_name,
                   p.main_image_url as product_image,
                   COALESCE(da.full_name, '') as return_agent_name,
                   IFNULL(da.phone_number, '') as return_agent_phone,
                   oi.attributes_snapshot, oi.price_per_unit, oi.total_price,
                   rep_o.order_number as replacement_child_order_number,
                   rep_o.order_status as replacement_child_order_status
            FROM order_returns r
            JOIN orders o ON r.order_id = o.id
            JOIN users u ON r.user_id = u.id
            LEFT JOIN order_items oi ON r.order_item_id = oi.id
            LEFT JOIN seller_products sp ON oi.seller_product_id = sp.id
            LEFT JOIN products p ON sp.product_id = p.id
            LEFT JOIN delivery_agents da ON r.delivery_agent_id = da.id
            LEFT JOIN orders rep_o ON (r.replacement_order_id = rep_o.id OR r.replacement_order_id = rep_o.order_number)
            ${where}
            ORDER BY r.created_at DESC
        `, params);

        const processed = rows.map(r => {
            let ev = [];
            if (r.evidence_images) {
                try {
                    ev = typeof r.evidence_images === 'string' ? JSON.parse(r.evidence_images) : r.evidence_images;
                    if (typeof ev === 'string') { try { ev = JSON.parse(ev); } catch(e) {} }
                } catch(e) { ev = [r.evidence_images]; }
            }
            return {
                ...r,
                evidence_images: Array.isArray(ev) ? ev : (ev ? [ev] : [])
            };
        });

        res.json({ status: true, data: processed });
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
        await ensureReturnTableColumns();

        let [[ret]] = await db.query(
            `SELECT * FROM order_returns WHERE id = ? AND merchant_id = ?`,
            [id, merchantId]
        );

        if (!ret) {
            // Check fallback in case sellerable_id or NULL merchant_id
            const [[checkRet]] = await db.query(
                `SELECT r.* FROM order_returns r
                 LEFT JOIN order_items oi ON r.order_item_id = oi.id
                 LEFT JOIN seller_products sp ON oi.seller_product_id = sp.id
                 LEFT JOIN sellers s ON sp.seller_id = s.id
                 WHERE r.id = ? AND (r.merchant_id = ? OR s.sellerable_id = ? OR r.merchant_id IS NULL)`,
                [id, merchantId, merchantId]
            );
            ret = checkRet;
        }

        if (!ret) return res.status(404).json({ status: false, message: 'Return request not found.' });
        if (ret.merchant_action && ret.merchant_action !== 'PENDING') {
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

        try {
            await db.query(`
                UPDATE order_returns
                SET merchant_action = ?, merchant_notes = ?, status = ?
                WHERE id = ?
            `, [action, merchant_notes || null, newStatus, id]);
        } catch (updateErr) {
            await safeAddColumn('order_returns', 'merchant_notes', 'TEXT NULL');
            try {
                await db.query(`
                    UPDATE order_returns
                    SET merchant_action = ?, merchant_notes = ?, status = ?
                    WHERE id = ?
                `, [action, merchant_notes || null, newStatus, id]);
            } catch (fallbackErr) {
                await db.query(`
                    UPDATE order_returns
                    SET merchant_action = ?, status = ?
                    WHERE id = ?
                `, [action, newStatus, id]);
            }
        }

        res.json({
            status: true,
            message: action === 'ACCEPTED'
                ? 'Return accepted. Admin will initiate refund/replacement.'
                : 'Request disputed. Admin will review and take final decision.'
        });
    } catch (err) {
        console.error('[Return] merchantReturnAction error:', err);
        res.status(500).json({ status: false, message: err.message || 'Could not process action.' });
    }
};

// ─────────────────────────────────────────────────────────────
// ADMIN: GET /admin/returns — All return/replacement requests
// ─────────────────────────────────────────────────────────────
exports.adminGetAllReturnRequests = async (req, res) => {
    const { status, requestType, page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;

    try {
        await ensureReturnTableColumns();

        let where = 'WHERE 1=1';
        const params = [];
        if (status) {
            if (status === 'PENDING_UPI') {
                where += ' AND r.refund_status = "PENDING_UPI"';
            } else {
                where += ' AND r.status = ?';
                params.push(status);
            }
        }
        if (requestType && requestType !== 'ALL') { where += ' AND (r.request_type = ? OR r.return_type = ?)'; params.push(requestType, requestType); }

        const [rows] = await db.query(`
            SELECT r.*, 
                   COALESCE(r.request_type, r.return_type, 'RETURN') as request_type,
                   o.order_number,
                   COALESCE(u.full_name, 'Customer') as customer_name, 
                   IFNULL(u.mobile_number,'') as customer_phone,
                   COALESCE(m.business_name, '') as merchant_name,
                   COALESCE(p.name, oi.product_name, 'Product Item') as product_name,
                   COALESCE(da.full_name, '') as agent_name, 
                   IFNULL(da.phone_number, '') as agent_phone
            FROM order_returns r
            LEFT JOIN orders o ON r.order_id = o.id
            LEFT JOIN users u ON r.user_id = u.id
            LEFT JOIN merchants m ON r.merchant_id = m.id
            LEFT JOIN order_items oi ON r.order_item_id = oi.id
            LEFT JOIN seller_products sp ON oi.seller_product_id = sp.id
            LEFT JOIN products p ON sp.product_id = p.id
            LEFT JOIN delivery_agents da ON r.delivery_agent_id = da.id
            ${where}
            ORDER BY r.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, limitNum, offset]);

        const [[countRes]] = await db.query(
            `SELECT COUNT(*) as total FROM order_returns r ${where}`,
            params
        ).catch(() => [[{ total: rows.length }]]);

        res.json({ status: true, data: rows, total: countRes ? countRes.total : rows.length, page: pageNum });
    } catch (err) {
        console.error('[Admin Return] getAll error:', err);
        res.status(500).json({ status: false, message: 'Could not fetch return requests.' });
    }
};

// ─────────────────────────────────────────────────────────────
// ADMIN: PATCH /admin/returns/:id/assign-agent
// Assigns or Re-assigns a delivery agent for doorstep reverse pickup
// ─────────────────────────────────────────────────────────────
exports.adminAssignPickup = async (req, res) => {
    const { id } = req.params;
    const { deliveryAgentId, pickupDate, adminNotes } = req.body;

    if (!deliveryAgentId) {
        return res.status(400).json({ status: false, message: 'Please select a delivery agent.' });
    }

    try {
        await ensureReturnTableColumns();
        const [[ret]] = await db.query(`SELECT id, status, request_type, order_id, user_id, merchant_id, merchant_action FROM order_returns WHERE id = ?`, [id]);
        if (!ret) return res.status(404).json({ status: false, message: 'Return request not found.' });

        if (ret.merchant_id && ret.merchant_action !== 'ACCEPTED') {
            return res.status(400).json({
                status: false,
                message: `This product is sold by a Merchant and requires Merchant approval before assigning pickup. Current status: ${ret.merchant_action || 'PENDING'}.`
            });
        }

        const dateStr = pickupDate || new Date().toISOString().slice(0, 10);
        await db.query(`
            UPDATE order_returns 
            SET delivery_agent_id = ?,
                pickup_scheduled_date = ?,
                admin_notes = COALESCE(?, admin_notes),
                admin_action = 'APPROVED',
                status = 'PICKUP_ASSIGNED'
            WHERE id = ?
        `, [deliveryAgentId, dateStr, adminNotes || null, id]);

        // Emit realtime socket event if agent is connected
        try {
            const io = req.app.get('io');
            if (io) {
                io.emit(`agent_${deliveryAgentId}_new_pickup`, {
                    message: `New Reverse Pickup Assigned for ${dateStr}!`,
                    requestId: id,
                    orderId: ret.order_id
                });
                io.emit('pickup_assigned', {
                    deliveryAgentId,
                    message: `New Reverse Pickup Assigned for ${dateStr}!`,
                    requestId: id,
                    orderId: ret.order_id
                });
            }
        } catch (sErr) {}

        res.json({
            status: true,
            message: `Delivery Agent assigned successfully for doorstep pickup on ${dateStr}.`
        });
    } catch (err) {
        console.error('[Admin Return] assign error:', err);
        res.status(500).json({ status: false, message: 'Failed to assign delivery agent.' });
    }
};

// ─────────────────────────────────────────────────────────────
// ADMIN: PATCH /admin/returns/:id/process-upi-refund
// Admin enters the transaction UTR after paying customer via UPI/Bank
// ─────────────────────────────────────────────────────────────
exports.adminProcessUpiRefund = async (req, res) => {
    const { id } = req.params;
    const { utr, adminNotes } = req.body;

    if (!utr || !utr.trim()) {
        return res.status(400).json({ status: false, message: 'Transaction Reference / UTR is required.' });
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        await ensureReturnTableColumns();

        const [[ret]] = await conn.query(`SELECT * FROM order_returns WHERE id = ?`, [id]);
        if (!ret) {
            await conn.rollback();
            return res.status(404).json({ status: false, message: 'Return request not found.' });
        }

        // Deduct returned BV from user
        const [[itemBvRow]] = await conn.query("SELECT total_bv_earned FROM order_items WHERE id = ?", [ret.order_item_id]);
        if (itemBvRow && itemBvRow.total_bv_earned > 0) {
            const returnedBv = parseFloat(itemBvRow.total_bv_earned);
            await conn.query(`
                UPDATE users SET 
                    aggregate_personal_bv = GREATEST(0, aggregate_personal_bv - ?),
                    total_bv_self = GREATEST(0, total_bv_self - ?)
                WHERE id = ?
            `, [returnedBv, returnedBv, ret.user_id]).catch(() => {});
        }

        // Claw back merchant wallet if applicable
        if (ret.merchant_id) {
            const platformFee = ret.refund_amount * 0.10;
            const netAmount   = ret.refund_amount - platformFee;
            await conn.query(`
                UPDATE merchant_wallet
                SET pending_amount   = GREATEST(0, pending_amount - ?),
                    available_amount = GREATEST(0, available_amount - ?),
                    total_earned     = GREATEST(0, total_earned - ?)
                WHERE merchant_id = ?
            `, [netAmount, netAmount, netAmount, ret.merchant_id]).catch(() => {});

            await conn.query(`
                UPDATE merchant_transactions SET status = 'REFUNDED'
                WHERE order_id = ? AND merchant_id = ?
            `, [ret.order_id, ret.merchant_id]).catch(() => {});
        }

        const noteAppend = (ret.admin_notes ? ret.admin_notes + ' | ' : '') + `UPI UTR: ${utr.trim()}` + (adminNotes ? ` (${adminNotes})` : '');
        await conn.query(`
            UPDATE order_returns
            SET refund_utr = ?,
                refund_status = 'COMPLETED',
                status = 'REFUNDED',
                admin_notes = ?
            WHERE id = ?
        `, [utr.trim(), noteAppend, id]);

        await conn.commit();
        res.json({
            status: true,
            message: `UPI Refund marked complete with UTR: ${utr.trim()}`
        });
    } catch (err) {
        await conn.rollback();
        console.error('[Admin Return] process UPI refund error:', err);
        res.status(500).json({ status: false, message: 'Failed to process UPI refund.' });
    } finally {
        conn.release();
    }
};

// ─────────────────────────────────────────────────────────────
// HELPER: Creates a ₹0 linked replacement child order
// ─────────────────────────────────────────────────────────────
async function createReplacementChildOrder(returnReq, conn) {
    try {
        const [[origOrder]] = await conn.query(`SELECT * FROM orders WHERE id = ?`, [returnReq.order_id]);
        const [[origItem]] = await conn.query(`SELECT * FROM order_items WHERE id = ?`, [returnReq.order_item_id]);
        await conn.query(`ALTER TABLE orders MODIFY COLUMN order_number VARCHAR(100);`).catch(() => {});

        // Keep repOrderNum compact (<= 20 characters) e.g. R-FMMZHG-975
        const rawNum = String(origOrder.order_number || returnReq.order_id || 'ORD');
        const cleanSuffix = rawNum.replace(/[^A-Za-z0-9]/g, '').slice(-8);
        const repOrderNum = `R-${cleanSuffix}-${Math.floor(100 + Math.random() * 900)}`.slice(0, 20);
        const agentToAssign = returnReq.delivery_agent_id || origOrder.delivery_agent_id || null;

        const [insOrder] = await conn.query(`
            INSERT INTO orders (
                user_id, shipping_address_id, order_number, subtotal, delivery_fee, 
                total_amount, total_bv_earned, payment_method, payment_status, order_status, 
                delivery_agent_id
            ) VALUES (?, ?, ?, 0.00, 0.00, 0.00, 0.00, 'REPLACEMENT', 'COMPLETED', 'CONFIRMED', ?)
        `, [
            origOrder.user_id, origOrder.shipping_address_id, repOrderNum, agentToAssign
        ]);

        const repOrderId = insOrder.insertId;

        const repQty = Math.max(1, parseInt(returnReq.return_quantity || 1));

        let snapshotStr = '{}';
        if (origItem.attributes_snapshot) {
            snapshotStr = typeof origItem.attributes_snapshot === 'object'
                ? JSON.stringify(origItem.attributes_snapshot)
                : String(origItem.attributes_snapshot);
        }

        await conn.query(`
            INSERT INTO order_items (
                order_id, product_id, seller_product_id, product_name, 
                attributes_snapshot, quantity, price_per_unit, purchase_price, gst_percentage, 
                total_price, bv_earned_per_unit, total_bv_earned
            ) VALUES (?, ?, ?, ?, ?, ?, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00)
        `, [
            repOrderId, origItem.product_id, origItem.seller_product_id, `[Replacement] ${origItem.product_name}`,
            snapshotStr, repQty
        ]);

        // Deduct replacement product stock
        if (origItem.seller_product_id) {
            if (returnReq.variant_attribute_id) {
                await conn.query(`
                    UPDATE seller_product_variants 
                    SET stock_quantity = GREATEST(0, stock_quantity - ?) 
                    WHERE id = ?
                `, [repQty, returnReq.variant_attribute_id]).catch(() => {});
            }
            await conn.query(`
                UPDATE seller_products 
                SET quantity = GREATEST(0, quantity - ?) 
                WHERE id = ?
            `, [repQty, origItem.seller_product_id]).catch(() => {});
        }
        if (origItem.product_id) {
            await conn.query(`
                UPDATE products 
                SET stock_quantity = GREATEST(0, stock_quantity - ?) 
                WHERE id = ?
            `, [repQty, origItem.product_id]).catch(() => {});
        }

        return repOrderId;
    } catch (err) {
        console.error('[createReplacementChildOrder] error:', err);
        return null;
    }
}
exports.createReplacementChildOrder = createReplacementChildOrder;

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
            const reqTypeStr = (ret.request_type || ret.return_type || 'RETURN').toUpperCase();
            if (reqTypeStr === 'RETURN') {
                if (ret.refund_method === 'UPI') {
                    refundStatus = 'PENDING_UPI';
                    newStatus    = 'PICKED_UP';
                } else {
                    // Fetch order and product info for clear passbook description
                    const [[orderInfo]] = await conn.query(
                        `SELECT o.order_number, oi.product_name 
                         FROM orders o 
                         LEFT JOIN order_items oi ON oi.id = ? 
                         WHERE o.id = ?`,
                        [ret.order_item_id, ret.order_id]
                    ).catch(() => [[null]]);

                    const orderNum = orderInfo?.order_number || ret.order_id;
                    const prodName = orderInfo?.product_name || 'Item';
                    const retQty = ret.return_quantity || 1;
                    const refundRemarks = `Refund for Order #${orderNum} (${prodName}${retQty > 1 ? ' x ' + retQty : ''})`;

                    // Initiate refund to customer wallet
                    await conn.query(`
                        INSERT INTO user_wallet_transactions
                          (user_id, txn_type, amount, source, reference_id, remarks, created_at)
                        VALUES (?, 'credit', ?, 'return_refund', ?, ?, NOW())
                    `, [ret.user_id, ret.refund_amount, id, refundRemarks]).catch(async () => {
                        await conn.query(`
                            INSERT INTO user_wallet_transactions
                              (user_id, amount, transaction_type, remarks, created_at)
                            VALUES (?, ?, 'CREDIT', ?, NOW())
                        `, [ret.user_id, ret.refund_amount, refundRemarks]).catch(() => {});
                    });

                    await conn.query(`
                        UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?
                    `, [ret.refund_amount, ret.user_id]);

                    const [[itemBvRow]] = await conn.query("SELECT total_bv_earned FROM order_items WHERE id = ?", [ret.order_item_id]);
                    if (itemBvRow && itemBvRow.total_bv_earned > 0) {
                        const returnedBv = parseFloat(itemBvRow.total_bv_earned);
                        await conn.query(`
                            UPDATE users SET 
                                aggregate_personal_bv = GREATEST(0, aggregate_personal_bv - ?),
                                total_bv_self = GREATEST(0, total_bv_self - ?)
                            WHERE id = ?
                        `, [returnedBv, returnedBv, ret.user_id]);
                    }

                    if (ret.merchant_id) {
                        const platformFee = ret.refund_amount * 0.10;
                        const netAmount   = ret.refund_amount - platformFee;
                        await conn.query(`
                            UPDATE merchant_wallet
                            SET pending_amount   = GREATEST(0, pending_amount - ?),
                                available_amount = GREATEST(0, available_amount - ?),
                                total_earned     = GREATEST(0, total_earned - ?)
                            WHERE merchant_id = ?
                        `, [netAmount, netAmount, netAmount, ret.merchant_id]).catch(() => {});

                        await conn.query(`
                            UPDATE merchant_transactions SET status = 'REFUNDED'
                            WHERE order_id = ? AND merchant_id = ?
                        `, [ret.order_id, ret.merchant_id]).catch(() => {});
                    }

                    refundStatus = 'COMPLETED';
                    newStatus    = 'REFUNDED';
                }
            } else {
                newStatus = 'REPLACEMENT_INITIATED';
                refundStatus = 'NOT_INITIATED';
            }
        }

        await conn.query(`ALTER TABLE order_returns MODIFY COLUMN status VARCHAR(50) DEFAULT 'PENDING';`).catch(() => {});
        await conn.query(`ALTER TABLE order_returns MODIFY COLUMN admin_action VARCHAR(50) DEFAULT 'PENDING';`).catch(() => {});
        await conn.query(`ALTER TABLE order_returns MODIFY COLUMN refund_status VARCHAR(50) DEFAULT 'NOT_INITIATED';`).catch(() => {});

        try {
            await conn.query(`
                UPDATE order_returns
                SET admin_action = ?, admin_notes = ?, status = ?, refund_status = ?
                WHERE id = ?
            `, [action, admin_notes || null, newStatus, refundStatus, id]);
        } catch (updateErr) {
            console.warn("Primary status update failed, executing safe fallback update:", updateErr.message);
            await conn.query(`
                UPDATE order_returns
                SET admin_action = ?, admin_notes = ?, status = ?, refund_status = ?
                WHERE id = ?
            `, [action, admin_notes || null, action === 'APPROVED' ? 'APPROVED' : 'REJECTED', refundStatus, id]);
        }

        await conn.commit();
        res.json({
            status: true,
            message: action === 'APPROVED'
                ? `${ret.request_type === 'RETURN' ? (ret.refund_method === 'UPI' ? 'Approved! Marked for UPI refund.' : 'Refund of ₹' + ret.refund_amount + ' credited to customer wallet.') : 'Replacement initiated.'}`
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

// ─────────────────────────────────────────────────────────────
// ADMIN / MERCHANT: POST /returns/:id/receive-at-hub
// Confirms defective item physically handed over at Hub / Store
// ─────────────────────────────────────────────────────────────
exports.receiveItemAtHub = async (req, res) => {
    const { id } = req.params;
    const { notes, qc_status, restock } = req.body;
    try {
        await ensureReturnTableColumns();
        const [[ret]] = await db.query(`SELECT * FROM order_returns WHERE id = ?`, [id]);
        if (!ret) return res.status(404).json({ status: false, message: 'Return record not found.' });

        const userRole = (req.user?.role || (req.user?.merchant_id ? 'merchant' : 'admin')).toLowerCase();
        const isMerchant = userRole.includes('merchant');
        const receivedByType = isMerchant ? 'MERCHANT' : 'ADMIN';
        const receivedById = req.user?.id || req.user?.merchant_id || null;
        const newStatus = 'RECEIVED_AT_HUB';

        const finalQcStatus = (qc_status || 'PASSED').toUpperCase();
        const qcRemarks = notes || (finalQcStatus === 'PASSED' ? 'Physical QC passed at store.' : 'Physical QC issue reported at store.');

        await db.query(`
            UPDATE order_returns 
            SET status = ?,
                received_at_hub_at = NOW(),
                received_by_type = ?,
                received_by_id = ?,
                hub_notes = COALESCE(?, hub_notes),
                qc_status = ?,
                qc_remarks = ?
            WHERE id = ?
        `, [newStatus, receivedByType, receivedById, qcRemarks, finalQcStatus, qcRemarks, id]);

        // Auto restock to inventory if QC Passed and restock requested
        let restockedMsg = '';
        if (finalQcStatus === 'PASSED' && restock && ret.order_item_id) {
            const [[oi]] = await db.query(`SELECT seller_product_id, quantity FROM order_items WHERE id = ?`, [ret.order_item_id]).catch(() => [[]]);
            const returnQty = ret.return_quantity || 1;
            if (oi && oi.seller_product_id) {
                await db.query(`UPDATE seller_products SET stock_quantity = stock_quantity + ? WHERE id = ?`, [returnQty, oi.seller_product_id]).catch(() => {});
                restockedMsg = ` and ${returnQty} unit(s) restocked to inventory`;
            }
        }

        res.json({
            status: true,
            message: `Item received with QC ${finalQcStatus}${restockedMsg}!`,
            statusNow: newStatus
        });
    } catch (err) {
        console.error('[Return] receiveItemAtHub error:', err);
        res.status(500).json({ status: false, message: 'Could not mark item as received at hub.' });
    }
};

// ─────────────────────────────────────────────────────────────
// MERCHANT / ADMIN: POST /returns/:id/dispatch-replacement
// Dispatches replacement unit via Local Delivery Agent OR Courier / Shiprocket
// ─────────────────────────────────────────────────────────────
exports.dispatchReplacementUnit = async (req, res) => {
    const { id } = req.params;
    const { mode, delivery_agent_id, replacement_awb_code, replacement_courier_name, notes } = req.body;
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        await ensureReturnTableColumns();

        const [[ret]] = await conn.query(`SELECT * FROM order_returns WHERE id = ? FOR UPDATE`, [id]);
        if (!ret) {
            await conn.rollback();
            return res.status(404).json({ status: false, message: 'Request not found.' });
        }

        // Ensure child replacement order exists
        let repOrderId = ret.replacement_order_id;
        if (!repOrderId) {
            repOrderId = await createReplacementChildOrder(ret, conn);
            if (repOrderId) {
                await conn.query(`UPDATE order_returns SET replacement_order_id = ? WHERE id = ?`, [repOrderId, id]);
            } else {
                await conn.rollback();
                return res.status(500).json({ status: false, message: 'Could not generate replacement order. Please try again.' });
            }
        }

        const isLocal = (mode === 'LOCAL' || (!mode && delivery_agent_id));

        if (isLocal && delivery_agent_id) {
            // Assign local delivery boy to child order
            if (repOrderId) {
                await conn.query(`
                    UPDATE orders 
                    SET delivery_agent_id = ?, 
                        order_status = 'CONFIRMED'
                    WHERE id = ?
                `, [delivery_agent_id, repOrderId]);
            }

            await conn.query(`
                UPDATE order_returns 
                SET status = 'REPLACEMENT_DISPATCHED',
                    delivery_agent_id = ?,
                    admin_notes = COALESCE(?, admin_notes)
                WHERE id = ?
            `, [delivery_agent_id, notes || 'Replacement unit assigned to Delivery Partner', id]);

            await conn.commit();
            return res.json({ 
                status: true, 
                message: 'Replacement unit successfully assigned to Delivery Agent! It will now appear in their Active Deliveries.' 
            });
        } else {
            // Pan India Courier / Shiprocket
            if (repOrderId && replacement_awb_code) {
                await conn.query(`
                    UPDATE orders 
                    SET tracking_number = ?, 
                        order_status = 'SHIPPED_SHIPROCKET'
                    WHERE id = ?
                `, [replacement_awb_code, repOrderId]).catch(() => {});
            }

            await conn.query(`
                UPDATE order_returns 
                SET status = 'REPLACEMENT_DISPATCHED',
                    replacement_awb_code = ?,
                    replacement_courier_name = ?,
                    admin_notes = COALESCE(?, admin_notes)
                WHERE id = ?
            `, [replacement_awb_code || null, replacement_courier_name || 'Express Courier / Shiprocket', notes || null, id]);

            await conn.commit();
            return res.json({ 
                status: true, 
                message: 'Replacement unit dispatched via Courier! Customer tracking details updated.' 
            });
        }
    } catch (err) {
        await conn.rollback();
        console.error('[Return] dispatchReplacementUnit error:', err);
        res.status(500).json({ status: false, message: 'Could not dispatch replacement unit.' });
    } finally {
        conn.release();
    }
};

// ─────────────────────────────────────────────────────────────
// PUBLIC WEBHOOK: POST /returns/shiprocket-webhook
// ─────────────────────────────────────────────────────────────
exports.handleShiprocketWebhook = async (req, res) => {
    try {
        await ensureReturnTableColumns();
        const { current_status, awb, order_id } = req.body || {};
        console.log('[Shiprocket Return Webhook Received]', { current_status, awb, order_id });

        if (!awb && !order_id) return res.status(200).send('OK');

        const statusUpper = (current_status || '').toUpperCase();
        let newReturnStatus = null;

        if (statusUpper.includes('PICKED UP') || statusUpper.includes('OUT FOR PICKUP')) {
            newReturnStatus = 'REVERSE_PICKED_UP';
        } else if (statusUpper.includes('DELIVERED TO MERCHANT') || statusUpper.includes('RETURN DELIVERED')) {
            newReturnStatus = 'MERCHANT_ACCEPTED';
        } else if (statusUpper.includes('QC FAILED') || statusUpper.includes('REJECTED')) {
            newReturnStatus = 'QC_FAILED';
        } else if (statusUpper.includes('DISPATCHED') || statusUpper.includes('IN TRANSIT')) {
            newReturnStatus = 'REPLACEMENT_DISPATCHED';
        }

        if (newReturnStatus) {
            await db.query(`
                UPDATE order_returns
                SET status = ?
                WHERE reverse_awb_code = ? OR replacement_awb_code = ? OR order_id = ?
            `, [newReturnStatus, awb, awb, order_id]);
        }

        res.status(200).json({ status: true, message: 'Webhook processed successfully.' });
    } catch (err) {
        console.error('[Shiprocket Return Webhook Error]', err);
        res.status(200).send('OK'); // Always return 200 OK to Shiprocket
    }
};
