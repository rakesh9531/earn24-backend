const db = require('../../db');
const moment = require('moment-timezone');

/**
 * Fetches orders for the admin panel, filterable by status.
 * Primarily used to get 'CONFIRMED' orders that need to be processed.
 */
exports.getOrdersByStatus = async (req, res) => {
    const status = req.query.status || 'ALL';
    
    try {
        let whereClause = "";
        let params = [];

        if (status === 'CONFIRMED') {
            whereClause = "WHERE o.order_status IN ('CONFIRMED', 'PLACED', 'SHIPPED', 'OUT_FOR_DELIVERY')";
        } else if (status === 'ALL') {
            // Process New Orders should only include active processing orders needing Admin assignment:
            // 1. Must contain Admin / Non-merchant products (merchant-only orders are processed by their respective merchants)
            // 2. Must not be already picked up by rider (o.pickup_status != 'PICKED_UP')
            // 3. Must not be already dispatched via courier
            // 4. Must not be completed or cancelled
            whereClause = `WHERE o.order_status NOT IN ('PENDING', 'PENDING_PAYMENT', 'DELIVERED', 'CANCELLED', 'OUT_FOR_DELIVERY')
                           AND (o.pickup_status IS NULL OR o.pickup_status != 'PICKED_UP')
                           AND NOT (o.dispatch_mode = 'SHIPROCKET_COURIER' AND o.tracking_number IS NOT NULL)
                           AND EXISTS (
                               SELECT 1 FROM order_items oi 
                               LEFT JOIN seller_products sp ON oi.seller_product_id = sp.id 
                               LEFT JOIN sellers s ON sp.seller_id = s.id 
                               WHERE oi.order_id = o.id 
                               AND (sp.id IS NULL OR s.sellerable_type != 'Merchant' OR s.sellerable_id IS NULL)
                           )`;
        } else {
            whereClause = "WHERE o.order_status = ?";
            params = [status];
        }

        const [cols] = await db.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'"
        ).catch(() => [[]]);
        const colSet = new Set((cols || []).map(c => c.COLUMN_NAME));

        const trackingCol = colSet.has('tracking_number') ? 'o.tracking_number' : 'NULL as tracking_number';
        const courierCol = colSet.has('courier_name') ? 'o.courier_name' : 'NULL as courier_name';
        const dispatchCol = colSet.has('dispatch_mode') ? 'o.dispatch_mode' : "'LOCAL_RIDER' as dispatch_mode";

        const query = `
            SELECT o.id, o.order_number, o.total_amount, o.order_status, o.created_at, o.payment_method, o.payment_status,
                   o.assignment_status, o.pickup_otp, o.pickup_status,
                   ${trackingCol}, ${courierCol}, ${dispatchCol},
                   u.full_name as customer_name, u.mobile_number as customer_phone,
                   o.delivery_agent_id, o.rejection_reason, o.last_rejected_by_agent_id,
                   da.full_name as rejected_by_agent_name,
                   curr_da.full_name as assigned_agent_name, curr_da.phone_number as assigned_agent_phone
            FROM orders o
            LEFT JOIN users u ON o.user_id = u.id
            LEFT JOIN delivery_agents da ON o.last_rejected_by_agent_id = da.id
            LEFT JOIN delivery_agents curr_da ON o.delivery_agent_id = curr_da.id
            ${whereClause}
            ORDER BY o.created_at DESC
        `;
        const [orders] = await db.query(query, params);

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
        const [orderRows] = await db.query('SELECT order_status, payment_method, payment_status FROM orders WHERE id = ?', [orderId]);
        if (orderRows.length === 0) {
            return res.status(404).json({ status: false, message: "Order not found." });
        }
        if (['DELIVERED', 'CANCELLED', 'PENDING', 'PENDING_PAYMENT'].includes(orderRows[0].order_status)) {
            return res.status(409).json({ status: false, message: `Cannot assign order with status '${orderRows[0].order_status}'.` });
        }

        // Strict Check: Block assigning orders with unconfirmed online payment
        const payMethod = (orderRows[0].payment_method || '').toUpperCase();
        const payStatus = (orderRows[0].payment_status || '').toUpperCase();
        const isOnline = ['ONLINE', 'PAYU', 'RAZORPAY', 'WALLET'].includes(payMethod);
        const isPaid = ['PAID', 'COMPLETED', 'SUCCESS'].includes(payStatus);

        if (isOnline && !isPaid) {
            return res.status(400).json({ 
                status: false, 
                message: `Payment is ${orderRows[0].payment_status || 'PENDING'}. Cannot assign delivery agent until online payment is confirmed.` 
            });
        }

        // Generate a 4-digit secure Pickup OTP for Warehouse / Store handover
        const masterPickupOtp = Math.floor(1000 + Math.random() * 9000).toString();

        // Check if order items are from multiple sellers / merchants
        const [distinctSellers] = await db.query(`
            SELECT DISTINCT sp.seller_id, s.sellerable_type, s.sellerable_id
            FROM order_items oi
            JOIN seller_products sp ON oi.seller_product_id = sp.id
            LEFT JOIN sellers s ON sp.seller_id = s.id
            WHERE oi.order_id = ?
        `, [orderId]).catch(() => [[]]);

        if (distinctSellers && distinctSellers.length > 1) {
            // Multi-seller / multi-location order: Assign unique 4-digit OTP per distinct seller location
            for (let idx = 0; idx < distinctSellers.length; idx++) {
                const s = distinctSellers[idx];
                const sellerOtp = idx === 0 ? masterPickupOtp : Math.floor(1000 + Math.random() * 9000).toString();
                await db.query(`
                    UPDATE order_items oi
                    JOIN seller_products sp ON oi.seller_product_id = sp.id
                    SET oi.pickup_otp = ?, oi.pickup_status = 'PENDING'
                    WHERE oi.order_id = ? AND sp.seller_id = ?
                `, [sellerOtp, orderId, s.seller_id]).catch(() => {});
            }
        } else {
            // Single location / Central Warehouse order
            await db.query(`
                UPDATE order_items 
                SET pickup_otp = ?, pickup_status = 'PENDING' 
                WHERE order_id = ?
            `, [masterPickupOtp, orderId]).catch(() => {});
        }

        // Update the order status and assign the delivery agent with PENDING_ACCEPTANCE
        const query = `
            UPDATE orders 
            SET order_status = 'SHIPPED', 
                delivery_agent_id = ?, 
                assignment_status = 'PENDING_ACCEPTANCE',
                pickup_otp = ?,
                pickup_status = 'PENDING',
                rejection_reason = NULL,
                assigned_at = NOW()
            WHERE id = ?
        `;
        const [result] = await db.query(query, [deliveryAgentId, masterPickupOtp, orderId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: false, message: 'Order not found.' });
        }

        // Emit real-time socket events for order assignment
        const io = req.app.get('socketio');
        if (io) {
            io.to(`agent_${deliveryAgentId}`).emit('order_assigned', {
                orderId: orderId,
                orderNumber: orderRows[0].order_number,
                deliveryAgentId,
                pickupOtp: masterPickupOtp,
                message: "A new order has been assigned to you. Please accept or reject."
            });
            io.to('admins').emit('order_status_updated', {
                orderId: orderId,
                status: 'SHIPPED',
                assignmentStatus: 'PENDING_ACCEPTANCE',
                pickupStatus: 'PENDING',
                deliveryAgentId
            });
        }

        res.status(200).json({ 
            status: true, 
            message: "Order assigned to delivery agent successfully. Waiting for agent acceptance and pickup verification.",
            pickupOtp: masterPickupOtp 
        });

    } catch (error) {
        console.error("Error assigning order for delivery:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};

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

        const realOrderId = orderRows[0].id;
        const realOrderNum = orderRows[0].order_number;
        
        // 2. Fetch all line items for this order with Attributes, Brand, Pickup Status, and Seller details
        const itemsQuery = `
            SELECT 
                oi.id as order_item_id,
                oi.product_name, 
                oi.quantity, 
                oi.price_per_unit, 
                oi.total_price,
                oi.bv_earned_per_unit,
                oi.total_bv_earned,
                oi.item_status,
                oi.attributes_snapshot,
                IFNULL(oi.pickup_otp, o.pickup_otp) as pickup_otp,
                IFNULL(oi.pickup_status, 'PENDING') as pickup_status,
                oi.picked_up_at,
                p.main_image_url,
                b.name as brand_name,
                sp.seller_id,
                s.sellerable_type,
                CASE 
                    WHEN s.sellerable_type = 'Merchant' AND m.business_name IS NOT NULL THEN m.business_name 
                    ELSE 'Central Warehouse / Earn24 Hub' 
                END as pickup_location_name,
                CASE 
                    WHEN s.sellerable_type = 'Merchant' AND m.business_address IS NOT NULL THEN m.business_address 
                    ELSE 'Earn24 Central Hub / Warehouse' 
                END as pickup_address,
                CASE 
                    WHEN s.sellerable_type = 'Merchant' AND m.phone_number IS NOT NULL THEN m.phone_number 
                    ELSE 'Warehouse Manager' 
                END as pickup_contact_phone
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            JOIN products p ON oi.product_id = p.id
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN seller_products sp ON oi.seller_product_id = sp.id
            LEFT JOIN sellers s ON sp.seller_id = s.id
            LEFT JOIN merchants m ON (s.sellerable_type = 'Merchant' AND s.sellerable_id = m.id)
            WHERE oi.order_id = ?
        `;
        const [itemRows] = await db.query(itemsQuery, [realOrderId]);

        // 3. Process the items to parse JSON attributes & variant image
        const processedItems = itemRows.map(item => {
            let attributes = {};
            if (item.attributes_snapshot) {
                try {
                    attributes = typeof item.attributes_snapshot === 'string' ? JSON.parse(item.attributes_snapshot) : item.attributes_snapshot;
                } catch (e) {}
            }
            const variantImg = attributes['Variant Image'] || item.main_image_url;
            return {
                ...item,
                main_image_url: variantImg,
                image_url: variantImg,
                attributes: attributes
            };
        });

        // 4. Fetch Return / Replacement info linked to this order
        const [returnRows] = await db.query(`
            SELECT r.*, 
                   COALESCE(da.full_name, '') as return_agent_name, 
                   IFNULL(da.phone_number, '') as return_agent_phone 
            FROM order_returns r 
            LEFT JOIN delivery_agents da ON r.delivery_agent_id = da.id 
            WHERE r.order_id = ?
            ORDER BY r.id DESC
        `, [realOrderId]).catch(() => [[]]);

        let returnDetails = null;
        if (returnRows && returnRows.length > 0) {
            const rawRet = returnRows[0];
            let evidenceImages = [];
            if (rawRet.evidence_images) {
                try {
                    evidenceImages = typeof rawRet.evidence_images === 'string' ? JSON.parse(rawRet.evidence_images) : rawRet.evidence_images;
                    if (typeof evidenceImages === 'string') {
                        try { evidenceImages = JSON.parse(evidenceImages); } catch(e) {}
                    }
                } catch(e) {
                    evidenceImages = rawRet.evidence_images ? [rawRet.evidence_images] : [];
                }
            } else if (rawRet.images_json) {
                try {
                    evidenceImages = typeof rawRet.images_json === 'string' ? JSON.parse(rawRet.images_json) : rawRet.images_json;
                    if (typeof evidenceImages === 'string') {
                        try { evidenceImages = JSON.parse(evidenceImages); } catch(e) {}
                    }
                } catch(e) {
                    evidenceImages = [];
                }
            }
            const cleanEvidence = (Array.isArray(evidenceImages) ? evidenceImages : (evidenceImages ? [evidenceImages] : []))
                .map(img => typeof img === 'string' ? img.replace(/^["']|["']$/g, '').trim() : img)
                .filter(Boolean);

            let returnedItem = null;
            if (rawRet.order_item_id) {
                returnedItem = processedItems.find(it => it.order_item_id == rawRet.order_item_id) || null;
            }
            if (!returnedItem && processedItems.length > 0) {
                returnedItem = processedItems[0];
            }

            let childOrder = null;
            if (rawRet.replacement_order_id) {
                const [childRows] = await db.query(
                    `SELECT id, order_number, order_status, created_at FROM orders WHERE id = ? OR order_number = ? LIMIT 1`,
                    [rawRet.replacement_order_id, rawRet.replacement_order_id]
                ).catch(() => [[]]);
                if (childRows && childRows.length > 0) {
                    childOrder = childRows[0];
                }
            }

            returnDetails = {
                ...rawRet,
                returned_item: returnedItem,
                child_order: childOrder,
                evidence_images: cleanEvidence
            };
        }

        // 5. If this is a child replacement order (starts with R-), find the original parent order
        let parentOrder = null;
        if (realOrderNum.startsWith('R-') || orderRows[0].payment_method === 'REPLACEMENT') {
            const [parentRows] = await db.query(`
                SELECT o.id, o.order_number, o.created_at, o.total_amount, o.order_status,
                       r.id as return_id, r.reason as replacement_reason, r.status as return_status, r.created_at as return_date
                FROM order_returns r
                JOIN orders o ON r.order_id = o.id
                WHERE r.replacement_order_id = ? OR r.replacement_order_id = ?
                LIMIT 1
            `, [realOrderId, realOrderNum]).catch(() => [[]]);

            if (parentRows && parentRows.length > 0) {
                parentOrder = parentRows[0];
            }
        }

        // 6. Combine results into a single rich object
        const orderDetails = {
            ...orderRows[0], 
            items: processedItems,
            return_request: returnDetails,
            parent_order: parentOrder,
            unlock_date: orderRows[0].delivered_at ? moment(orderRows[0].delivered_at).add(7, 'days').format('YYYY-MM-DD') : null
        };
        
        res.status(200).json({ status: true, data: orderDetails });

    } catch (error) {
        console.error("Error fetching admin order details:", error);
        res.status(500).json({ status: false, message: 'An internal server error occurred.' });
    }
};

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
        if (connection) await connection.rollback();
        console.error("Settlement Error:", e);
        res.status(500).json({ status: false, message: "Internal server error during settlement." });
    } finally {
        if (connection) connection.release();
    }
};

exports.verifySettlement = async (req, res) => {
    const { orderId } = req.body;
    const adminId = req.user.id;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [orderRows] = await connection.query(
            "SELECT total_amount, delivery_amount_collected, delivery_agent_id, order_number, payment_method, delivery_payment_mode FROM orders WHERE id = ? FOR UPDATE",
            [orderId]
        );

        if (!orderRows[0]) {
            await connection.rollback();
            return res.status(404).json({ status: false, message: "Order not found." });
        }

        const order = orderRows[0];
        const settleAmount = parseFloat(order.delivery_amount_collected || order.total_amount || 0);

        await connection.query(
            "UPDATE orders SET is_cash_settled = 1, cash_settled_at = NOW(), settled_by_admin_id = ? WHERE id = ?",
            [adminId, orderId]
        );

        const mode = order.delivery_payment_mode || order.payment_method || 'COD';
        await connection.query(
            "INSERT INTO admin_settlement_logs (admin_id, agent_id, order_id, amount_received, remarks) VALUES (?, ?, ?, ?, ?)",
            [adminId, order.delivery_agent_id, orderId, settleAmount, `Settlement verified (${mode}) for Order ${order.order_number}`]
        ).catch(() => {});

        await connection.commit();
        res.json({ status: true, message: `₹${settleAmount} verified and settled successfully for Order ${order.order_number}!` });
    } catch (e) {
        if (connection) await connection.rollback();
        console.error("verifySettlement error:", e);
        res.status(500).json({ status: false, message: e.message });
    } finally {
        if (connection) connection.release();
    }
};

exports.getAllOrdersHistory = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = (req.query.search || '').trim();
    const status = (req.query.status || 'ALL').toUpperCase();
    const offset = (page - 1) * limit;
    const searchPattern = `%${search}%`;
    const merchantId = req.query.merchant_id || req.query.merchantId;
    const sortBy = req.query.sort_by || 'DATE_DESC';

    try {
        let whereClauses = [];
        let params = [];

        if (search) {
            whereClauses.push(`(o.order_number LIKE ? OR u.full_name LIKE ? OR u.mobile_number LIKE ? OR da.full_name LIKE ?)`);
            params.push(searchPattern, searchPattern, searchPattern, searchPattern);
        }

        if (merchantId && merchantId !== 'ALL') {
            if (merchantId === 'ADMIN') {
                whereClauses.push(`EXISTS (
                    SELECT 1 FROM order_items oi 
                    LEFT JOIN seller_products sp ON oi.seller_product_id = sp.id 
                    LEFT JOIN sellers s ON sp.seller_id = s.id 
                    WHERE oi.order_id = o.id 
                    AND (sp.id IS NULL OR s.sellerable_type != 'Merchant' OR s.sellerable_id IS NULL)
                )`);
            } else {
                whereClauses.push(`EXISTS (
                    SELECT 1 FROM order_items oi 
                    JOIN seller_products sp ON oi.seller_product_id = sp.id 
                    JOIN sellers s ON sp.seller_id = s.id 
                    WHERE oi.order_id = o.id 
                    AND s.sellerable_type = 'Merchant' 
                    AND s.sellerable_id = ?
                )`);
                params.push(merchantId);
            }
        }

        if (status === 'RETURNS') {
            whereClauses.push(`(ret.id IS NOT NULL AND ret.status NOT IN ('CLOSED', 'REJECTED'))`);
        } else if (status === 'REPLACEMENTS') {
            whereClauses.push(`(o.order_number LIKE 'R-%' OR ret.request_type = 'REPLACEMENT')`);
        } else if (status === 'PENDING') {
            whereClauses.push(`o.order_status IN ('PENDING', 'PENDING_PAYMENT', 'CONFIRMED')`);
        } else if (status === 'SHIPPED') {
            whereClauses.push(`o.order_status IN ('SHIPPED', 'OUT_FOR_DELIVERY')`);
        } else if (status !== 'ALL') {
            whereClauses.push(`o.order_status = ?`);
            params.push(status);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        let orderSql = 'ORDER BY o.created_at DESC';
        if (sortBy === 'DATE_ASC') {
            orderSql = 'ORDER BY o.created_at ASC';
        } else if (sortBy === 'AMOUNT_HIGH') {
            orderSql = 'ORDER BY o.total_amount DESC';
        } else if (sortBy === 'AMOUNT_LOW') {
            orderSql = 'ORDER BY o.total_amount ASC';
        } else if (sortBy === 'MERCHANT_ASC') {
            orderSql = 'ORDER BY merchant_names ASC, o.created_at DESC';
        } else if (sortBy === 'MERCHANT_DESC') {
            orderSql = 'ORDER BY merchant_names DESC, o.created_at DESC';
        }

        const query = `
            SELECT o.*, 
                   u.full_name as customer_name, u.mobile_number as customer_phone,
                   da.full_name as agent_name, da.phone_number as agent_phone,
                   ret.id as return_id, ret.status as return_status, ret.request_type as return_type,
                   ret.refund_amount as return_refund_amount, ret.refund_status as return_refund_status,
                   (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count,
                   (SELECT product_name FROM order_items WHERE order_id = o.id LIMIT 1) as first_item_name,
                   (SELECT p.main_image_url FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = o.id LIMIT 1) as first_item_image,
                   (SELECT attributes_snapshot FROM order_items WHERE order_id = o.id LIMIT 1) as first_item_attributes,
                   (
                       SELECT GROUP_CONCAT(DISTINCT COALESCE(m.business_name, s.display_name, 'Earn24 Admin') SEPARATOR ', ')
                       FROM order_items oi
                       LEFT JOIN seller_products sp ON oi.seller_product_id = sp.id
                       LEFT JOIN sellers s ON sp.seller_id = s.id
                       LEFT JOIN merchants m ON (s.sellerable_type = 'Merchant' AND s.sellerable_id = m.id)
                       WHERE oi.order_id = o.id
                   ) as merchant_names
            FROM orders o
            JOIN users u ON o.user_id = u.id
            LEFT JOIN delivery_agents da ON o.delivery_agent_id = da.id
            LEFT JOIN order_returns ret ON ret.id = (
                SELECT r2.id FROM order_returns r2 
                WHERE r2.order_id = o.id 
                ORDER BY r2.id DESC LIMIT 1
            )
            ${whereSql}
            ${orderSql}
            LIMIT ? OFFSET ?`;

        const queryParams = [...params, limit, offset];
        const [rows] = await db.query(query, queryParams);

        const countQuery = `
            SELECT COUNT(*) as total 
            FROM orders o 
            JOIN users u ON o.user_id = u.id 
            LEFT JOIN delivery_agents da ON o.delivery_agent_id = da.id
            LEFT JOIN order_returns ret ON ret.id = (
                SELECT r2.id FROM order_returns r2 
                WHERE r2.order_id = o.id 
                ORDER BY r2.id DESC LIMIT 1
            )
            ${whereSql}
        `;
        const [countRows] = await db.query(countQuery, params);

        const processedRows = rows.map(r => {
            let img = r.first_item_image;
            if (r.first_item_attributes) {
                try {
                    const snap = typeof r.first_item_attributes === 'string' ? JSON.parse(r.first_item_attributes) : r.first_item_attributes;
                    if (snap && snap['Variant Image']) {
                        img = snap['Variant Image'];
                    }
                } catch(e) {}
            }
            return {
                ...r,
                display_image_url: img
            };
        });

        res.status(200).json({
            status: true,
            data: processedRows,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(countRows[0].total / limit) || 1,
                totalRecords: countRows[0].total
            }
        });
    } catch (e) {
        console.error('[getAllOrdersHistory Error]', e);
        res.status(500).json({ status: false, message: e.message });
    }
};

/**
 * GET /api/admin/orders/merchants-filter-list
 * Lightweight list of active merchants for the dropdown filter in Order History
 */
exports.getMerchantsFilterList = async (req, res) => {
    try {
        const [rows] = await db.query(
            "SELECT id, business_name FROM merchants WHERE is_approved = 1 ORDER BY business_name ASC"
        ).catch(async () => {
            return await db.query("SELECT id, business_name FROM merchants ORDER BY business_name ASC");
        });
        res.status(200).json({ status: true, data: rows });
    } catch (e) {
        res.status(500).json({ status: false, message: e.message });
    }
};

exports.getPendingSettlements = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const offset = (page - 1) * limit;
    const searchPattern = `%${search}%`;

    try {
        const query = `
            SELECT o.id, o.order_number, o.total_amount, o.delivered_at,
                   o.payment_method, o.delivery_payment_mode, o.delivery_amount_collected,
                   o.is_settlement_requested, o.settlement_requested_at,
                   u.full_name as customer_name,
                   da.full_name as agent_name, da.phone_number as agent_phone
            FROM orders o
            JOIN users u ON o.user_id = u.id
            JOIN delivery_agents da ON o.delivery_agent_id = da.id
            WHERE (o.is_cash_settled = 0 OR o.is_cash_settled IS NULL)
            AND o.order_status = 'DELIVERED'
            AND (o.payment_method = 'COD' OR o.delivery_payment_mode IN ('COD', 'CASH', 'ONLINE') OR o.delivery_amount_collected > 0)
            AND (o.order_number LIKE ? OR da.full_name LIKE ? OR da.phone_number LIKE ?)
            ORDER BY o.is_settlement_requested DESC, o.delivered_at DESC
            LIMIT ? OFFSET ?`;

        const [rows] = await db.query(query, [searchPattern, searchPattern, searchPattern, limit, offset]);

        const [countRows] = await db.query(`
            SELECT COUNT(*) as total FROM orders o 
            JOIN delivery_agents da ON o.delivery_agent_id = da.id
            WHERE (o.is_cash_settled = 0 OR o.is_cash_settled IS NULL)
            AND o.order_status = 'DELIVERED'
            AND (o.payment_method = 'COD' OR o.delivery_payment_mode IN ('COD', 'CASH', 'ONLINE') OR o.delivery_amount_collected > 0)
            AND (o.order_number LIKE ? OR da.full_name LIKE ? OR da.phone_number LIKE ?)`, 
            [searchPattern, searchPattern, searchPattern]);

        res.status(200).json({ 
            status: true, 
            data: rows,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(countRows[0].total / limit),
                totalRecords: countRows[0].total
            }
        });
    } catch (e) {
        console.error("Pending Settlement Error:", e);
        res.status(500).json({ status: false, message: e.message });
    }
};

// --- GET SETTLEMENT HISTORY LOGS (Professional Version) ---
exports.getSettlementHistory = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const offset = (page - 1) * limit;
    const searchPattern = `%${search}%`;

    try {
        // 1. Fetch Logs with search and pagination
        const logQuery = `
            SELECT 
                sl.amount_received as amount_settled, 
                sl.settled_at, 
                o.order_number, 
                da.full_name as agent_name
            FROM admin_settlement_logs sl
            JOIN orders o ON sl.order_id = o.id
            JOIN delivery_agents da ON sl.agent_id = da.id
            WHERE (o.order_number LIKE ? OR da.full_name LIKE ?)
            ORDER BY sl.settled_at DESC
            LIMIT ? OFFSET ?
        `;
        const [logs] = await db.query(logQuery, [searchPattern, searchPattern, limit, offset]);

        // 2. Fetch Summary Stats (Total Collected vs Current Pending)
        const statsQuery = `
            SELECT 
                (SELECT IFNULL(SUM(amount_received), 0) FROM admin_settlement_logs) as totalCollected,
                (SELECT IFNULL(SUM(total_amount), 0) FROM orders 
                 WHERE payment_method = 'COD' AND order_status = 'DELIVERED' AND is_cash_settled = 0) as totalPending
        `;
        const [stats] = await db.query(statsQuery);

        // 2.1 Fetch Agent-wise Pending Breakdown
        const agentWiseQuery = `
            SELECT 
                da.id as agent_id, 
                da.full_name as agent_name, 
                da.phone_number as agent_phone,
                IFNULL(SUM(o.total_amount), 0) as pending_amount,
                COUNT(o.id) as pending_orders_count
            FROM orders o
            JOIN delivery_agents da ON o.delivery_agent_id = da.id
            WHERE o.payment_method = 'COD' 
            AND o.order_status = 'DELIVERED' 
            AND o.is_cash_settled = 0
            GROUP BY da.id
            ORDER BY pending_amount DESC
        `;
        const [agentWisePending] = await db.query(agentWiseQuery);

        // 3. Fetch count for pagination
        const [countRows] = await db.query(`
            SELECT COUNT(*) as total 
            FROM admin_settlement_logs sl
            JOIN orders o ON sl.order_id = o.id
            JOIN delivery_agents da ON sl.agent_id = da.id
            WHERE (o.order_number LIKE ? OR da.full_name LIKE ?)`, 
            [searchPattern, searchPattern]);

        res.status(200).json({ 
            status: true, 
            data: logs,
            summary: {
                ...stats[0],
                agentWisePending: agentWisePending
            },
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(countRows[0].total / limit),
                totalRecords: countRows[0].total
            }
        });
    } catch (e) {
        console.error("Settlement History Error:", e);
        res.status(500).json({ status: false, message: "Server error fetching settlement history." });
    }
};

exports.cancelAdminOrder = async (req, res) => {
    const { orderId } = req.params;
    const { reason } = req.body;

    if (!reason) {
        return res.status(400).json({ status: false, message: "Cancellation reason is required." });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Fetch Order and Lock
        const [orders] = await connection.query(
            "SELECT * FROM orders WHERE id = ? FOR UPDATE",
            [orderId]
        );

        if (orders.length === 0) {
            await connection.rollback();
            return res.status(404).json({ status: false, message: "Order not found." });
        }

        const order = orders[0];

        // 2. Validate current status: Admin cannot cancel if already delivered or already cancelled
        if (order.order_status === 'DELIVERED') {
            await connection.rollback();
            return res.status(400).json({ status: false, message: "Delivered orders cannot be cancelled." });
        }
        if (order.order_status === 'CANCELLED') {
            await connection.rollback();
            return res.status(400).json({ status: false, message: "Order is already cancelled." });
        }

        // 3. Restock inventory
        const [items] = await connection.query(
            "SELECT seller_product_id, quantity FROM order_items WHERE order_id = ?",
            [orderId]
        );

        for (const item of items) {
            await connection.query(
                "UPDATE seller_products SET quantity = quantity + ? WHERE id = ?",
                [item.quantity, item.seller_product_id]
            );
        }

        // 4. Wallet Refund if payment was completed or payment method was WALLET
        let refundProcessed = false;
        if (order.payment_status === 'COMPLETED' || order.payment_method === 'WALLET') {
            const [wallets] = await connection.query(
                "SELECT balance FROM user_wallets WHERE user_id = ? FOR UPDATE",
                [order.user_id]
            );
            if (wallets.length === 0) {
                await connection.query("INSERT INTO user_wallets (user_id, balance) VALUES (?, ?)", [order.user_id, order.total_amount]);
            } else {
                await connection.query(
                    "UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?",
                    [order.total_amount, order.user_id]
                );
            }

            // Insert into transaction history
            await connection.query(
                `INSERT INTO user_wallet_transactions 
                 (user_id, txn_type, amount, source, reference_id, remarks) 
                 VALUES (?, 'credit', ?, 'refund', ?, ?)`,
                [order.user_id, order.total_amount, order.order_number, `Admin Refund for cancelled order: ${reason}`]
            );
            refundProcessed = true;
        }

        // 5. Update order details
        await connection.query(
            `UPDATE orders 
             SET order_status = 'CANCELLED', 
                 payment_status = ?, 
                 cancellation_reason = ?, 
                 cancelled_by = 'ADMIN', 
                 cancelled_at = NOW() 
             WHERE id = ?`,
            [refundProcessed ? 'REFUNDED' : 'FAILED', reason, orderId]
        );

        await connection.commit();

        // 6. Emit real-time socket events for order cancellation
        const io = req.app.get('socketio');
        if (io) {
            if (order.delivery_agent_id) {
                io.to(`agent_${order.delivery_agent_id}`).emit('order_cancelled', {
                    orderId: orderId,
                    orderNumber: order.order_number,
                    reason: reason,
                    message: `Order #${order.order_number} was CANCELLED by Admin.`
                });
            }
            io.to('admins').emit('order_status_updated', {
                orderId: orderId,
                status: 'CANCELLED'
            });
        }

        res.status(200).json({ status: true, message: "Order cancelled successfully.", data: { orderId, refundProcessed } });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Admin Order Cancellation Error:", error);
        res.status(500).json({ status: false, message: "Failed to cancel order: " + error.message });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * Verify Warehouse / Store Pickup Handshake OTP
 * Admin or Warehouse Manager enters the 4-digit OTP shown on Rider's app to confirm parcel handover.
 */
exports.verifyPickupOtp = async (req, res) => {
    const { orderId } = req.params;
    const { otp, sellerId, orderItemId } = req.body;

    if (!otp) {
        return res.status(400).json({ status: false, message: "Pickup OTP is required." });
    }

    try {
        const [orderRows] = await db.query(
            "SELECT id, order_number, order_status, delivery_agent_id, pickup_otp, pickup_status FROM orders WHERE id = ?",
            [orderId]
        );
        if (orderRows.length === 0) {
            return res.status(404).json({ status: false, message: "Order not found." });
        }
        const order = orderRows[0];

        // Fetch items for this order
        const [itemRows] = await db.query(
            `SELECT oi.id, oi.seller_product_id, oi.pickup_otp, oi.pickup_status, sp.seller_id
             FROM order_items oi
             LEFT JOIN seller_products sp ON oi.seller_product_id = sp.id
             WHERE oi.order_id = ?`,
            [orderId]
        );

        const enteredOtp = otp.toString().trim();
        const masterOtp = (order.pickup_otp || '').toString().trim();

        // Check if master OTP matches or any item/seller OTP matches
        const isMasterMatched = (masterOtp !== '' && masterOtp === enteredOtp);
        const matchingItems = itemRows.filter(i => (i.pickup_otp || '').toString().trim() === enteredOtp);

        if (!isMasterMatched && matchingItems.length === 0) {
            return res.status(400).json({
                status: false,
                message: "Invalid Pickup OTP! The entered code does not match this order's warehouse pickup OTP."
            });
        }

        // Mark matching items or all items as PICKED_UP
        if (isMasterMatched) {
            await db.query(
                "UPDATE order_items SET pickup_status = 'PICKED_UP', picked_up_at = NOW() WHERE order_id = ?",
                [orderId]
            );
        } else {
            const matchedIds = matchingItems.map(i => i.id);
            await db.query(
                "UPDATE order_items SET pickup_status = 'PICKED_UP', picked_up_at = NOW() WHERE id IN (?)",
                [matchedIds]
            );
        }

        // Check if any items are still pending pickup
        const [remaining] = await db.query(
            "SELECT COUNT(*) as count FROM order_items WHERE order_id = ? AND IFNULL(pickup_status, 'PENDING') != 'PICKED_UP'",
            [orderId]
        );
        const allPickedUp = (remaining[0]?.count || 0) === 0;

        if (allPickedUp) {
            await db.query(
                "UPDATE orders SET pickup_status = 'PICKED_UP', picked_up_at = NOW(), order_status = 'SHIPPED' WHERE id = ?",
                [orderId]
            );
        } else {
            await db.query(
                "UPDATE orders SET picked_up_at = COALESCE(picked_up_at, NOW()) WHERE id = ?",
                [orderId]
            );
        }

        // Emit real-time notification to rider and admins
        const io = req.app.get('socketio');
        if (io) {
            if (order.delivery_agent_id) {
                io.to(`agent_${order.delivery_agent_id}`).emit('order_pickup_verified', {
                    orderId: order.id,
                    orderNumber: order.order_number,
                    allPickedUp,
                    message: allPickedUp
                        ? `Warehouse Pickup Verified! All items collected for Order #${order.order_number}. You can now start the delivery trip.`
                        : `Pickup location items verified for Order #${order.order_number}.`
                });
            }
            io.to('admins').emit('order_pickup_verified', {
                orderId: order.id,
                orderNumber: order.order_number,
                allPickedUp
            });
        }

        res.status(200).json({
            status: true,
            allPickedUp,
            message: allPickedUp
                ? "Pickup handshake verified successfully! All items handed over to delivery agent."
                : "Location items verified successfully. Some items pending from another pickup location."
        });
    } catch (error) {
        console.error("Error verifying pickup OTP:", error);
        res.status(500).json({ status: false, message: "An error occurred during pickup verification: " + error.message });
    }
};

/**
 * POST /api/admin/orders/:orderId/dispatch-shiprocket
 * Admin dispatches order / central hub items via Shiprocket courier
 */
exports.dispatchAdminOrderShiprocket = async (req, res) => {
    const { orderId } = req.params;
    const { pickupLocation: customPickupLocation } = req.body || {};

    try {
        const [orderRows] = await db.query(`
            SELECT o.*, u.full_name as customer_name, u.mobile_number as customer_phone,
                   ua.address_line_1, ua.address_line_2, ua.city, ua.state, ua.pincode
            FROM orders o
            JOIN users u ON o.user_id = u.id
            LEFT JOIN user_addresses ua ON o.shipping_address_id = ua.id
            WHERE o.id = ?
        `, [orderId]);

        if (orderRows.length === 0) {
            return res.status(404).json({ status: false, message: "Order not found." });
        }
        const order = orderRows[0];

        if (['DELIVERED', 'CANCELLED', 'RETURNED'].includes((order.order_status || '').toUpperCase())) {
            return res.status(400).json({ status: false, message: `Cannot dispatch order with status '${order.order_status}'.` });
        }

        // Strict Check: Block assigning orders with unconfirmed online payment
        const payMethod = (order.payment_method || '').toUpperCase();
        const payStatus = (order.payment_status || '').toUpperCase();
        const isOnline = ['ONLINE', 'PAYU', 'RAZORPAY', 'WALLET'].includes(payMethod);
        const isPaid = ['PAID', 'COMPLETED', 'SUCCESS'].includes(payStatus);

        if (isOnline && !isPaid) {
            return res.status(400).json({ 
                status: false, 
                message: `Payment is ${order.payment_status || 'PENDING'}. Cannot dispatch courier until online payment is confirmed.` 
            });
        }

        // Fetch order items belonging to Admin / Central Hub, or all items not yet dispatched
        const [items] = await db.query(`
            SELECT oi.id, oi.product_id, oi.product_name, oi.quantity, oi.price_per_unit, oi.total_price,
                   s.sellerable_type, s.sellerable_id
            FROM order_items oi
            LEFT JOIN seller_products sp ON oi.seller_product_id = sp.id
            LEFT JOIN sellers s ON sp.seller_id = s.id
            WHERE oi.order_id = ?
        `, [orderId]);

        if (items.length === 0) {
            return res.status(400).json({ status: false, message: "No items found in this order." });
        }

        // Filter items that Admin is dispatching (Central hub / Admin products, or all non-dispatched items)
        const adminItems = items.filter(it => it.sellerable_type !== 'Merchant' || !it.sellerable_id);
        const itemsToDispatch = adminItems.length > 0 ? adminItems : items;

        const pickupLocation = customPickupLocation 
            ? String(customPickupLocation).trim().substring(0, 36) 
            : (process.env.SHIPROCKET_PICKUP_LOCATION || "Primary");

        const groupTotal = itemsToDispatch.reduce((sum, it) => sum + parseFloat(it.total_price || (it.price_per_unit * it.quantity) || 0), 0);
        const isPrepaid = isOnline || order.payment_status === 'COMPLETED' || order.payment_status === 'PAID';

        const shiprocketItems = itemsToDispatch.map(it => ({
            name: it.product_name || "Catalog Product",
            sku: `PROD-${it.product_id}`,
            units: it.quantity || 1,
            selling_price: parseFloat(it.price_per_unit || 0)
        }));

        const subOrderId = order.order_number;

        let shipmentResult;
        try {
            const shiprocketService = require('../Services/shiprocketService');
            shipmentResult = await shiprocketService.createForwardOrder({
                order_id: subOrderId,
                order_date: new Date(),
                pickup_location: pickupLocation,
                billing_customer_name: order.customer_name || "Customer",
                billing_address: order.address_line_1 || "Address",
                billing_city: order.city || "City",
                billing_pincode: order.pincode || "828207",
                billing_state: order.state || "State",
                billing_country: "India",
                billing_email: "support@earn24.in",
                billing_phone: order.customer_phone || "9999999999",
                shipping_is_billing: true,
                order_items: shiprocketItems,
                payment_method: isPrepaid ? "Prepaid" : "COD",
                sub_total: groupTotal > 0 ? groupTotal : parseFloat(order.total_amount || 0),
                length: 10, breadth: 10, height: 10, weight: 0.5
            });
        } catch (srErr) {
            return res.status(400).json({ status: false, message: `Shiprocket Error: ${srErr.message}` });
        }

        const awb = shipmentResult?.awb_code || shipmentResult?.shipment_id || `AWB-${Date.now()}`;
        const courierName = shipmentResult?.courier_name || 'Shiprocket Express';
        const itemIds = itemsToDispatch.map(i => i.id);

        await db.query(`
            UPDATE order_items 
            SET tracking_number = ?, 
                courier_name = ?, 
                dispatch_mode = 'SHIPROCKET_COURIER', 
                item_status = 'SHIPPED' 
            WHERE id IN (?)
        `, [awb, courierName, itemIds]);

        await db.query(`
            UPDATE orders 
            SET order_status = 'SHIPPED', 
                dispatch_mode = 'SHIPROCKET_COURIER',
                delivery_agent_id = NULL,
                tracking_number = IFNULL(tracking_number, ?),
                courier_name = IFNULL(courier_name, ?)
            WHERE id = ?
        `, [awb, courierName, orderId]);

        return res.status(200).json({
            status: true,
            message: `Order successfully dispatched to Shiprocket! Tracking AWB: ${awb}`,
            tracking_number: awb,
            courier_name: courierName,
            shipment_id: shipmentResult?.shipment_id
        });

    } catch (error) {
        console.error("dispatchAdminOrderShiprocket Error:", error);
        return res.status(500).json({ status: false, message: "Could not dispatch order via Shiprocket: " + error.message });
    }
};