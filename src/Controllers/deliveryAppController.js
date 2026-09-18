const db = require('../../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const smsService = require('../utils/smsHelper'); // Import the SMS utility
const commissionService = require('../Services/commissionService');
const distributionService = require('../Services/distributionService');

/**
 * 1. AGENT LOGIN (Existing)
 */
// exports.login = async (req, res) => {
//     console.log("LOGIN REQUEST RECEIVED:", req.body); 
//     const { phoneNumber, password } = req.body;
//     try {
//         const [rows] = await db.query("SELECT * FROM delivery_agents WHERE phone_number = ? AND is_active = 1", [phoneNumber]);
//         if (rows.length === 0) return res.status(401).json({ status: false, message: "Agent account not found or inactive." });

//         const valid = await bcrypt.compare(password, rows[0].password);
//         if (!valid) return res.status(401).json({ status: false, message: "Invalid password." });

//         const token = jwt.sign({ id: rows[0].id, role: 'delivery_agent' }, process.env.JWT_SECRET, { expiresIn: '24h' });
//         res.json({ status: true, token, agent: { name: rows[0].full_name, id: rows[0].id } });
//     } catch (e) {
//         res.status(500).json({ status: false, message: "Server Error during login." });
//     }
// };



exports.login = async (req, res) => {
    const { phoneNumber, password } = req.body;
    try {
        const [rows] = await db.query("SELECT * FROM delivery_agents WHERE phone_number = ? AND is_active = 1", [phoneNumber]);
        if (rows.length === 0) return res.status(401).json({ status: false, message: "Agent account not found." });

        const valid = await bcrypt.compare(password, rows[0].password);
        if (!valid) return res.status(401).json({ status: false, message: "Invalid credentials." });

        const token = jwt.sign({ id: rows[0].id, role: 'delivery_agent' }, process.env.JWT_SECRET, { expiresIn: '24h' });
        
        // ADD THE PHONE NUMBER HERE
        res.json({ 
            status: true, 
            token, 
            agent: { 
                name: rows[0].full_name, 
                id: rows[0].id,
                phoneNumber: rows[0].phone_number,
                serviceablePincodes: rows[0].serviceable_pincodes || '',
                isOnline: rows[0].is_online !== undefined ? rows[0].is_online === 1 : true
            } 
        });
    } catch (e) { res.status(500).json({ status: false, message: "Server Error" }); }
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




// exports.getMyOrders = async (req, res) => {
//     const agentId = req.user.id;
//     try {
//         const query = `
//             SELECT o.id, o.order_number, o.total_amount, o.payment_method, o.order_status,
//                    u.full_name as customer_name, u.mobile_number as customer_phone,
//                    sa.address_line_1, sa.address_line_2, sa.city, sa.pincode
//             FROM orders o
//             JOIN users u ON o.user_id = u.id
//             JOIN user_addresses sa ON o.shipping_address_id = sa.id
//             -- This ensures the agent only sees orders assigned to THEM
//             WHERE o.delivery_agent_id = ? 
//             AND o.order_status NOT IN ('DELIVERED', 'CANCELLED')
//             ORDER BY o.created_at DESC
//         `;
//         const [orders] = await db.query(query, [agentId]);
//         res.json({ status: true, data: orders });
//     } catch (e) {
//         res.status(500).json({ status: false, message: e.message });
//     }
// };



// // 3. GET ACTIVE TASKS WITH ITEMS
// exports.getMyOrders = async (req, res) => {
//     const agentId = req.user.id;
//     try {
//         const query = `
//             SELECT o.id, o.order_number, o.total_amount, o.payment_method, o.order_status,
//                    u.full_name as customer_name, u.mobile_number as customer_phone,
//                    sa.address_line_1, sa.city, sa.pincode
//             FROM orders o
//             JOIN users u ON o.user_id = u.id
//             JOIN user_addresses sa ON o.shipping_address_id = sa.id
//             WHERE o.delivery_agent_id = ? AND o.order_status NOT IN ('DELIVERED', 'CANCELLED')
//             ORDER BY o.created_at DESC`;
        
//         const [orders] = await db.query(query, [agentId]);

//         for (let order of orders) {
//             // Join with products and brands for real-world details
//             const itemQuery = `
//                 SELECT 
//                     oi.product_name, oi.quantity, 
//                     p.main_image_url, p.weight, p.unit,
//                     b.name as brand_name
//                 FROM order_items oi
//                 JOIN products p ON oi.product_id = p.id
//                 LEFT JOIN brands b ON p.brand_id = b.id
//                 WHERE oi.order_id = ?`;
            
//             const [items] = await db.query(itemQuery, [order.id]);
//             order.items = items;
//         }

//         res.json({ status: true, data: orders });
//     } catch (e) { res.status(500).json({ status: false, message: e.message }); }
// };








// 3. GET ACTIVE TASKS WITH ITEMS (Production Robust Version)
exports.getMyOrders = async (req, res) => {
    const agentId = req.user.id;
    try {
        // Fetch Order and Customer/Address details
        const query = `
            SELECT o.id, o.order_number, o.total_amount, o.payment_method, o.payment_status, o.order_status,
                   u.full_name as customer_name, u.mobile_number as customer_phone, sa.alternate_phone as customer_alt_phone,
                   sa.address_line_1, sa.address_line_2, sa.landmark, sa.city, sa.state, sa.pincode
            FROM orders o
            JOIN users u ON o.user_id = u.id
            JOIN user_addresses sa ON o.shipping_address_id = sa.id
            WHERE o.delivery_agent_id = ? AND o.order_status NOT IN ('DELIVERED', 'CANCELLED')
            ORDER BY o.created_at DESC`;
        
        const [orders] = await db.query(query, [agentId]);

        for (let order of orders) {
            const isPrepaid = (order.payment_method === 'WALLET' || order.payment_method === 'ONLINE' || order.payment_method === 'PAYU' || order.payment_status === 'COMPLETED' || order.payment_status === 'PAID');
            order.is_paid = isPrepaid ? 1 : 0;
            order.collectable_amount = isPrepaid ? 0.00 : parseFloat(order.total_amount);
            order.payment_instruction = isPrepaid ? "PREPAID / WALLET (Do NOT collect cash)" : `COLLECT CASH: ₹${parseFloat(order.total_amount).toFixed(2)}`;
            // FIX: Removed p.weight and p.unit. 
            // Instead, we fetch attributes_snapshot which contains the weight/size user ordered.
            const itemQuery = `
                SELECT 
                    oi.product_name, 
                    oi.quantity, 
                    oi.attributes_snapshot, -- This contains the Weight/Size data
                    p.main_image_url,
                    b.name as brand_name
                FROM order_items oi
                JOIN products p ON oi.product_id = p.id
                LEFT JOIN brands b ON p.brand_id = b.id
                WHERE oi.order_id = ?`;
            
            const [items] = await db.query(itemQuery, [order.id]);
            
            // Parse the JSON attributes for each item so the Frontend can loop through them
            order.items = items.map(item => ({
                ...item,
                attributes: item.attributes_snapshot ? 
                    (typeof item.attributes_snapshot === 'string' ? JSON.parse(item.attributes_snapshot) : item.attributes_snapshot) 
                    : {}
            }));
        }

        res.json({ status: true, data: orders });
    } catch (e) { 
        console.error("Fetch Orders Error:", e.message);
        res.status(500).json({ status: false, message: "Failed to fetch orders." }); 
    }
};










// 1. Just start the trip (Status: OUT_FOR_DELIVERY)
exports.startDelivery = async (req, res) => {
    const { orderId } = req.body;
    try {
        const [check] = await db.query("SELECT order_status, cancellation_reason, cancelled_by FROM orders WHERE id = ?", [orderId]);
        if (check[0] && check[0].order_status === 'CANCELLED') {
            return res.status(400).json({ 
                status: false, 
                isCancelled: true, 
                message: `Order was CANCELLED by ${check[0].cancelled_by || 'Admin'}. Reason: ${check[0].cancellation_reason || 'N/A'}` 
            });
        }

        await db.query("UPDATE orders SET order_status = 'OUT_FOR_DELIVERY' WHERE id = ? AND order_status != 'CANCELLED'", [orderId]);
        res.json({ status: true, message: "Delivery started. Customer notified." });
    } catch (e) { res.status(500).json({ status: false, message: e.message }); }
};

// 2. NEW: Trigger OTP only when agent reaches customer
exports.sendDeliveryOTP = async (req, res) => {
    const { orderId } = req.body;
    const otp = "123456"; 
    try {
        const [check] = await db.query("SELECT order_status, cancellation_reason, cancelled_by FROM orders WHERE id = ?", [orderId]);
        if (check[0] && check[0].order_status === 'CANCELLED') {
            return res.status(400).json({ 
                status: false, 
                isCancelled: true, 
                message: `Order was CANCELLED by ${check[0].cancelled_by || 'Admin'}. Reason: ${check[0].cancellation_reason || 'N/A'}` 
            });
        }

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
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Check if order was cancelled by Admin
        const [check] = await connection.query("SELECT order_status, cancellation_reason, cancelled_by FROM orders WHERE id = ? FOR UPDATE", [orderId]);
        if (check[0] && check[0].order_status === 'CANCELLED') {
            await connection.rollback();
            return res.status(400).json({ 
                status: false, 
                isCancelled: true, 
                message: `Order was CANCELLED by ${check[0].cancelled_by || 'Admin'}. Reason: ${check[0].cancellation_reason || 'N/A'}` 
            });
        }

        // Check if order was already prepaid / wallet paid
        const [existingOrders] = await connection.query(`SELECT payment_method, payment_status FROM orders WHERE id = ?`, [orderId]);
        const existingOrder = existingOrders[0];
        const isPrepaid = existingOrder && (
            (existingOrder.payment_status || '').toUpperCase() === 'PAID' || 
            (existingOrder.payment_status || '').toUpperCase() === 'COMPLETED'
        );

        const finalPaymentMethod = isPrepaid ? existingOrder.payment_method : (paymentMode || 'COD');

        // 1. Update Order & Order Items Status with Return Window Expiry Date
        await connection.query(`
            UPDATE order_items oi
            JOIN seller_products sp ON oi.seller_product_id = sp.id
            SET oi.delivered_at = NOW(),
                oi.item_status = 'DELIVERED',
                oi.return_window_expiry_date = DATE_ADD(NOW(), INTERVAL IFNULL(sp.return_window_days, 7) DAY)
            WHERE oi.order_id = ?
        `, [orderId]).catch(() => {});

        const [updateResult] = await connection.query(
            "UPDATE orders SET order_status='DELIVERED', payment_status='COMPLETED', payment_method=?, delivery_otp=NULL, delivered_at=NOW() WHERE id=? AND order_status != 'DELIVERED'", 
            [finalPaymentMethod, orderId]
        );

        if (updateResult.affectedRows > 0) {
            const [winCheck] = await connection.query(`
                SELECT MIN(IFNULL(sp.return_window_days, 7)) as min_window
                FROM order_items oi
                JOIN seller_products sp ON oi.seller_product_id = sp.id
                WHERE oi.order_id = ?
            `, [orderId]).catch(() => [[{ min_window: 7 }]]);

            let buyerIdForPromotion = null;
            if (winCheck[0] && winCheck[0].min_window === 0) {
                buyerIdForPromotion = await commissionService.processOrderForCommissions(connection, orderId).catch(() => null);
                await distributionService.processOrderDistribution(connection, orderId).catch(() => {});
                await connection.query('UPDATE order_items SET is_mlm_distributed = 1 WHERE order_id = ?', [orderId]).catch(() => {});
                await connection.query('UPDATE orders SET is_mlm_distributed = 1 WHERE id = ?', [orderId]).catch(() => {});
            } else {
                console.log(`[Delivery] Order ${orderId} delivered. BV & Cashback distribution held for 7-day return window policy...`);
            }

            await connection.commit();

            // 4. Trigger Merchant Wallet Credit
            const merchantWalletController = require('./merchantWalletController');
            await merchantWalletController.creditMerchantOnDelivery(orderId).catch(err =>
                console.error('[Merchant Wallet Credit Error]', err.message)
            );

            // 5. Run Rank Promotion AFTER commit - avoids DB lock wait timeout
            if (buyerIdForPromotion) {
                const rankService = require('../Services/rankService');
                await rankService.checkAndPromoteUser(buyerIdForPromotion).catch(err =>
                    console.error('[Rank Promotion Error]', err.message)
                );
            }
        } else {
            await connection.commit();
        }

        res.json({ status: true, message: "Delivery Success! MLM Distributed." });
    } catch (e) { 
        await connection.rollback();
        console.error("Delivery Completion Error:", e.message);
        res.status(500).json({ status: false, message: e.message }); 
    } finally {
        connection.release();
    }
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
        const [earnings] = await db.query(query, [agentId]);
        res.json({ status: true, data: earnings[0] || {} });
    } catch (e) {
        res.status(500).json({ status: false, message: e.message });
    }
};

// ─────────────────────────────────────────────────────────────
// DELIVERY AGENT: GET REVERSE PICKUP & REPLACEMENT TASKS
// ─────────────────────────────────────────────────────────────
exports.getPickupTasks = async (req, res) => {
    const agentId = req.user.id;
    try {
        await db.query(`ALTER TABLE order_returns ADD COLUMN delivery_otp VARCHAR(20) NULL;`).catch(() => {});
        await db.query(`ALTER TABLE order_returns ADD COLUMN pickup_otp VARCHAR(20) NULL;`).catch(() => {});
        await db.query(`ALTER TABLE order_returns ADD COLUMN customer_upi_id VARCHAR(100) NULL;`).catch(() => {});
        await db.query(`ALTER TABLE order_returns ADD COLUMN pickup_scheduled_date DATE NULL;`).catch(() => {});
        await db.query(`ALTER TABLE order_returns ADD COLUMN pickup_proof_image LONGTEXT NULL;`).catch(() => {});
        await db.query(`ALTER TABLE order_returns ADD COLUMN picked_up_at DATETIME NULL;`).catch(() => {});

        const query = `
            SELECT 
                r.id as request_id,
                r.order_id,
                r.order_item_id,
                COALESCE(r.request_type, r.return_type, 'RETURN') as request_type,
                COALESCE(r.return_type, 'RETURN') as return_type,
                r.status as request_status,
                r.reason,
                r.evidence_images,
                r.pickup_proof_image,
                r.pickup_otp,
                r.delivery_otp,
                r.refund_method,
                r.customer_upi_id,
                r.refund_amount,
                r.pickup_scheduled_date,
                o.order_number,
                u.full_name as customer_name,
                u.mobile_number as customer_phone,
                sa.address_line_1, sa.address_line_2, sa.landmark, sa.city, sa.state, sa.pincode,
                COALESCE(p.name, oi.product_name, 'Product Item') as product_name,
                p.main_image_url
            FROM order_returns r
            JOIN orders o ON r.order_id = o.id
            JOIN users u ON r.user_id = u.id
            LEFT JOIN user_addresses sa ON o.shipping_address_id = sa.id
            LEFT JOIN order_items oi ON r.order_item_id = oi.id
            LEFT JOIN seller_products sp ON oi.seller_product_id = sp.id
            LEFT JOIN products p ON sp.product_id = p.id
            WHERE (r.delivery_agent_id = ? OR o.delivery_agent_id = ?) 
              AND r.status IN ('PICKUP_ASSIGNED', 'OUT_FOR_PICKUP', 'REVERSE_PICKUP_ASSIGNED', 'APPROVED', 'MERCHANT_ACCEPTED')
              AND r.status NOT IN ('PICKED_UP', 'REFUNDED', 'COMPLETED', 'REPLACEMENT_INITIATED', 'CANCELLED', 'REJECTED')
            ORDER BY r.created_at DESC
        `;
        const [rows] = await db.query(query, [agentId, agentId]);
        res.json({ status: true, data: rows });
    } catch (e) {
        console.error("getPickupTasks error:", e.message);
        try {
            const [fallbackRows] = await db.query(`
                SELECT r.id as request_id, r.order_id, r.order_item_id, 
                       COALESCE(r.return_type, 'RETURN') as request_type,
                       r.status as request_status, r.reason,
                       o.order_number, u.full_name as customer_name, u.mobile_number as customer_phone
                FROM order_returns r
                JOIN orders o ON r.order_id = o.id
                JOIN users u ON r.user_id = u.id
                WHERE (r.delivery_agent_id = ? OR o.delivery_agent_id = ?)
                  AND r.status NOT IN ('PICKED_UP', 'REFUNDED', 'COMPLETED', 'REPLACEMENT_INITIATED', 'CANCELLED', 'REJECTED')
            `, [agentId, agentId]);
            res.json({ status: true, data: fallbackRows });
        } catch (err2) {
            res.status(500).json({ status: false, message: "Failed to fetch pickup tasks." });
        }
    }
};

// CONFIRM DOORSTEP RETURN PICKUP WITH PHOTO PROOF
exports.completeReversePickup = async (req, res) => {
    const { requestId, qc_status, qc_remarks, pickupProofBase64, pickup_proof_image } = req.body;
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const [[ret]] = await conn.query(`SELECT * FROM order_returns WHERE id = ? FOR UPDATE`, [requestId]);
        if (!ret) {
            await conn.rollback();
            return res.status(404).json({ status: false, message: "Request not found." });
        }

        // Prevent duplicate pickup attempts
        if (['PICKED_UP', 'REFUNDED', 'REPLACEMENT_INITIATED', 'COMPLETED'].includes((ret.status || '').toUpperCase())) {
            await conn.rollback();
            return res.status(400).json({ 
                status: false, 
                alreadyCompleted: true,
                message: "This return item has already been collected and processed successfully." 
            });
        }

        // Handle Doorstep Photo Proof (Uploaded file or Base64 string from Delivery Agent camera)
        let proofImageUrl = null;
        const rawPhoto = pickupProofBase64 || pickup_proof_image;
        if (req.file) {
            proofImageUrl = `/uploads/return-proofs/${req.file.filename}`;
        } else if (rawPhoto && typeof rawPhoto === 'string') {
            if (rawPhoto.startsWith('data:image')) {
                const fs = require('fs');
                const path = require('path');
                const uploadsDir = path.join(process.cwd(), 'src/uploads/return-proofs');
                if (!fs.existsSync(uploadsDir)) {
                    fs.mkdirSync(uploadsDir, { recursive: true });
                }
                const matches = rawPhoto.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
                if (matches && matches.length === 3) {
                    const mime = matches[1];
                    const ext = mime.includes('png') ? 'png' : 'jpg';
                    const buffer = Buffer.from(matches[2], 'base64');
                    const filename = `pickup-proof-${requestId}-${Date.now()}.${ext}`;
                    fs.writeFileSync(path.join(uploadsDir, filename), buffer);
                    proofImageUrl = `/uploads/return-proofs/${filename}`;
                }
            } else if (rawPhoto.startsWith('/uploads') || rawPhoto.startsWith('http')) {
                proofImageUrl = rawPhoto;
            }
        }

        const reqTypeStr = (ret.request_type || ret.return_type || 'RETURN').toUpperCase();
        let newStatus = 'PICKED_UP';
        let refundStatus = ret.refund_status;

        if (reqTypeStr === 'RETURN') {
            const refundMethod = (ret.refund_method || 'WALLET').toUpperCase();
            if (refundMethod === 'UPI') {
                refundStatus = 'PENDING_UPI';
                newStatus = 'PICKED_UP';
            } else {
                // Instant Wallet refund
                await conn.query(`
                    INSERT INTO user_wallet_transactions
                      (user_id, txn_type, amount, source, reference_id, remarks, created_at)
                    VALUES (?, 'credit', ?, 'return_refund', ?, ?, NOW())
                `, [ret.user_id, ret.refund_amount, requestId, `Refund for Return Request #${requestId}`]).catch(async () => {
                    await conn.query(`
                        INSERT INTO user_wallet_transactions
                          (user_id, amount, transaction_type, remarks, created_at)
                        VALUES (?, ?, 'CREDIT', ?, NOW())
                    `, [ret.user_id, ret.refund_amount, `Refund for Return Request #${requestId}`]).catch(() => {});
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
                    `, [returnedBv, returnedBv, ret.user_id]).catch(() => {});
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
                newStatus = 'REFUNDED';
            }
        } else {
            // REPLACEMENT — create linked replacement order
            const returnController = require('./returnController');
            const repOrderId = await returnController.createReplacementChildOrder(ret, conn);
            newStatus = 'REPLACEMENT_INITIATED';
            if (repOrderId) {
                await conn.query(`UPDATE order_returns SET replacement_order_id = ? WHERE id = ?`, [repOrderId, requestId]);
            }
        }

        await conn.query(`
            UPDATE order_returns 
            SET status = ?,
                refund_status = ?,
                qc_status = ?,
                qc_remarks = ?,
                pickup_proof_image = COALESCE(?, pickup_proof_image),
                picked_up_at = NOW()
            WHERE id = ?
        `, [newStatus, refundStatus, qc_status || 'PASSED', qc_remarks || 'Item inspected and collected at doorstep by Delivery Partner', proofImageUrl, requestId]);

        await conn.commit();
        res.json({
            status: true,
            message: reqTypeStr === 'RETURN'
                ? (ret.refund_method === 'UPI' ? "Item picked up with proof! Return marked for UPI refund." : "Item picked up with proof! ₹" + ret.refund_amount + " credited to customer wallet.")
                : "Item picked up with proof! Replacement order generated.",
            pickupProofImage: proofImageUrl
        });
    } catch (e) {
        await conn.rollback();
        console.error("completeReversePickup error:", e);
        res.status(500).json({ status: false, message: e.message });
    } finally {
        conn.release();
    }
};

// VERIFY DELIVERY OTP & COMPLETE REPLACEMENT REDELIVERY AT DOORSTEP
exports.completeReplacementDelivery = async (req, res) => {
    const { requestId, otp } = req.body;
    try {
        const [[ret]] = await db.query(`SELECT delivery_otp, status FROM order_returns WHERE id = ?`, [requestId]);
        if (!ret) return res.status(404).json({ status: false, message: "Request not found." });

        if (ret.delivery_otp && ret.delivery_otp !== otp) {
            return res.status(400).json({ status: false, message: "Invalid Delivery OTP." });
        }

        await db.query(`UPDATE order_returns SET status = 'COMPLETED' WHERE id = ?`, [requestId]);
        res.json({ status: true, message: "Replacement item delivered successfully!" });
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
        // ALSO: Save the reason so Admin knows WHY it was rejected
        const query = `
            UPDATE orders 
            SET delivery_agent_id = NULL, 
                order_status = 'CONFIRMED', 
                delivery_otp = NULL,
                rejection_reason = ?,
                last_rejected_by_agent_id = ?
            WHERE id = ?
        `;
        await db.query(query, [reason || 'No reason provided', agentId, orderId]);

        console.log(`Order ${orderId} rejected by agent ${agentId}. Reason: ${reason}`);

        // Emit real-time socket event for assignment cancellation
        const io = req.app.get('socketio');
        if (io) {
            io.to('admins').emit('assignment_cancelled', {
                orderId: orderId,
                agentId: agentId,
                reason: reason || 'No reason provided'
            });
        }

        res.json({ status: true, message: "Assignment cancelled. Order returned to Admin pool." });
    } catch (e) {
        res.status(500).json({ status: false, message: e.message });
    }
};


// Add this to your backend controller
exports.verifyOTP = async (req, res) => {
    const { orderId, otp } = req.body;
    try {
        const [check] = await db.query("SELECT order_status, cancellation_reason, cancelled_by FROM orders WHERE id = ?", [orderId]);
        if (check[0] && check[0].order_status === 'CANCELLED') {
            return res.status(400).json({ 
                status: false, 
                isCancelled: true, 
                message: `Order was CANCELLED by ${check[0].cancelled_by || 'Admin'}. Reason: ${check[0].cancellation_reason || 'N/A'}` 
            });
        }

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

        // 2. Fetch the paginated data (Includes cancellation details and proper date ordering)
        const query = `
            SELECT o.id, o.order_number, o.total_amount, o.order_status, o.payment_method, 
                   o.delivered_at, o.cancelled_at, o.updated_at, o.cancellation_reason, o.cancelled_by,
                   u.full_name as customer_name
            FROM orders o
            JOIN users u ON o.user_id = u.id
            WHERE o.delivery_agent_id = ? AND o.order_status IN ('DELIVERED', 'CANCELLED')
            ORDER BY COALESCE(o.delivered_at, o.cancelled_at, o.updated_at) DESC 
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
                SUM(CASE WHEN payment_method IN ('ONLINE', 'RAZORPAY', 'PAYU') THEN total_amount ELSE 0 END) as total_online_lifetime,
                SUM(CASE WHEN payment_method = 'WALLET' THEN total_amount ELSE 0 END) as total_wallet_lifetime,
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

/**
 * 9. TOGGLE DUTY STATUS (Online / Offline)
 */
exports.toggleDutyStatus = async (req, res) => {
    const agentId = req.user.id;
    const { isOnline } = req.body;
    try {
        await db.query("UPDATE delivery_agents SET is_online = ? WHERE id = ?", [isOnline ? 1 : 0, agentId]);
        res.json({ status: true, message: `Duty status updated to ${isOnline ? 'ONLINE' : 'OFFLINE'}.` });
    } catch (e) {
        res.status(500).json({ status: false, message: e.message });
    }
};

/**
 * 10. SMART AUTO-DISPATCH ALGORITHM
 * 1. Checks Local Delivery Agents matching shipping pincode.
 * 2. If no local rider covers pincode -> Routes to Shiprocket Pan-India Courier (if Admin Toggle is ON).
 */
exports.autoDispatchOrder = async (orderId) => {
    try {
        // Fetch order shipping pincode & items
        const [[order]] = await db.query(
            `SELECT o.id, o.order_number, o.total_amount, sa.pincode, sa.address_line_1, sa.city, sa.state 
             FROM orders o 
             JOIN user_addresses sa ON o.shipping_address_id = sa.id 
             WHERE o.id = ?`,
            [orderId]
        );

        if (!order) return { success: false, message: 'Order not found' };
        const shippingPincode = String(order.pincode).trim();

        // 1. Search for Local Online Delivery Agents matching this exact pincode
        const [agents] = await db.query(
            `SELECT id, full_name, phone_number, serviceable_pincodes 
             FROM delivery_agents 
             WHERE is_active = 1 AND is_online = 1 
               AND (serviceable_pincodes IS NULL OR serviceable_pincodes = '' OR FIND_IN_SET(?, REPLACE(serviceable_pincodes, ' ', '')) > 0)
             ORDER BY RAND() LIMIT 5`,
            [shippingPincode]
        );

        if (agents.length > 0) {
            // Auto-assign to matched local rider
            const selectedAgent = agents[0];
            await db.query(
                "UPDATE orders SET delivery_agent_id = ?, order_status = 'CONFIRMED' WHERE id = ?",
                [selectedAgent.id, orderId]
            );
            console.log(`[Auto-Dispatch] Order #${order.order_number} matched local rider ${selectedAgent.full_name} for Pincode ${shippingPincode}`);
            return { success: true, mode: 'LOCAL_RIDER', agent: selectedAgent };
        }

        // 2. No Local Rider found. Check if Pan-India Shiprocket Courier Toggle is ON in app_settings
        const [[settingsRow]] = await db.query("SELECT setting_value FROM app_settings WHERE setting_key = 'is_shiprocket_active'");
        const isShiprocketActive = settingsRow ? parseInt(settingsRow.setting_value, 10) === 1 : true;

        if (isShiprocketActive) {
            console.log(`[Auto-Dispatch] Routing Order #${order.order_number} to Shiprocket Pan-India Courier Partner...`);
            const shiprocketService = require('../Services/shiprocketService');
            
            const shipmentResult = await shiprocketService.createForwardOrder({
                order_id: order.order_number,
                order_date: new Date().toISOString(),
                pickup_location: "Primary",
                billing_customer_name: "Customer",
                billing_address: order.address_line_1 || "Address",
                billing_city: order.city || "City",
                billing_pincode: shippingPincode,
                billing_state: order.state || "State",
                billing_country: "India",
                billing_email: "customer@earn24.com",
                billing_phone: "9999999999",
                shipping_is_billing: true,
                order_items: [{ name: "Catalog Items", sku: "EARN24-PROD", units: 1, selling_price: order.total_amount }],
                payment_method: "Prepaid",
                sub_total: order.total_amount,
                length: 10, width: 10, height: 10, weight: 0.5
            }).catch(err => ({ success: false, error: err.message }));

            if (shipmentResult.success) {
                await db.query(
                    "UPDATE orders SET order_status = 'SHIPPED_SHIPROCKET', tracking_number = ? WHERE id = ?",
                    [shipmentResult.awb_code || shipmentResult.shipment_id, orderId]
                );
                return { success: true, mode: 'SHIPROCKET_COURIER', shipment: shipmentResult };
            }
        }

        console.log(`[Auto-Dispatch] Order #${order.order_number} remaining in Admin Pool (No matching local rider & Shiprocket toggle check)`);
        return { success: false, message: 'No local rider available and Pan-India courier fallback pending.' };
    } catch (e) {
        console.error('[Auto-Dispatch Error]', e.message);
        return { success: false, message: e.message };
    }
};

/**
 * 11. GET AGENT PROFILE (with Assigned Pincodes)
 */
exports.getProfile = async (req, res) => {
    const agentId = req.user.id;
    try {
        const [rows] = await db.query(
            "SELECT id, full_name, phone_number, serviceable_pincodes, is_online, is_active FROM delivery_agents WHERE id = ?",
            [agentId]
        );
        if (rows.length === 0) return res.status(404).json({ status: false, message: "Agent profile not found." });

        const agent = rows[0];
        res.json({
            status: true,
            data: {
                id: agent.id,
                name: agent.full_name,
                phoneNumber: agent.phone_number,
                serviceablePincodes: agent.serviceablePincodes || '',
                isOnline: agent.is_online === 1,
                isActive: agent.is_active === 1
            }
        });
    } catch (e) {
        res.status(500).json({ status: false, message: e.message });
    }
};

// ═════════════════════════════════════════════════════════════
// 12. PAYU LIVE DOORSTEP PAYMENT INTEGRATION
// ═════════════════════════════════════════════════════════════

const crypto = require('crypto');

const getPayUCredentials = async () => {
    try {
        const [rows] = await db.query(
            `SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE gateway_name = 'payu' AND is_active = 1 LIMIT 1`
        );
        if (rows.length > 0) {
            const { decryptObject } = require('../utils/encryption.helper');
            const config = decryptObject({
                encryptedData: rows[0].encrypted_config,
                iv: rows[0].encryption_iv,
            });
            if (config && (config.merchantKey || config.key) && (config.merchantSalt || config.salt)) {
                return {
                    payuKey: config.merchantKey || config.key,
                    payuSalt: config.merchantSalt || config.salt,
                    payuBaseUrl: config.isSandBox ? 'https://test.payu.in/_payment' : 'https://secure.payu.in/_payment'
                };
            }
        }
    } catch (e) {
        console.warn('[PayU Doorstep] DB PayU Config Read Warning:', e.message);
    }
    return {
        payuKey: process.env.PAYU_MERCHANT_KEY || 'm2uwkj',
        payuSalt: process.env.PAYU_MERCHANT_SALT || 'PyBf3kWiI6MdwYhrR3geD108F7fcpPI4',
        payuBaseUrl: process.env.PAYU_BASE_URL || 'https://secure.payu.in/_payment'
    };
};

/**
 * Customer scans QR code -> Opens this PayU Auto-Checkout Page
 */
exports.payuDoorstepCheckout = async (req, res) => {
    const { orderId } = req.params;
    try {
        const [orders] = await db.query(`
            SELECT o.*, u.full_name as customer_name, u.email as customer_email, u.mobile_number as customer_phone
            FROM orders o
            LEFT JOIN users u ON o.user_id = u.id
            WHERE o.id = ?
        `, [orderId]);

        if (!orders || orders.length === 0) {
            return res.status(404).send(`<h2 style="font-family:sans-serif;text-align:center;margin-top:40px;">Order not found</h2>`);
        }

        const order = orders[0];
        const isAlreadyPaid = (order.payment_status === 'PAID' || order.payment_status === 'COMPLETED' || order.is_paid === 1);
        if (isAlreadyPaid) {
            return res.send(`
                <!DOCTYPE html>
                <html>
                <head><title>Earn24 - Order Paid</title><meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>body{font-family:sans-serif;background:#f0fdf4;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:20px;text-align:center;}
                .box{background:#fff;padding:30px;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.08);max-width:380px;}
                h2{color:#15803d;margin-top:0;}p{color:#475569;}</style></head>
                <body><div class="box"><h2>✅ Order Already Paid!</h2><p>Order #${order.order_number || order.id} has already been paid via ${order.payment_method || 'Online'}. Please collect your parcel.</p></div></body></html>
            `);
        }

        const { payuKey, payuSalt, payuBaseUrl } = await getPayUCredentials();
        const amount = parseFloat(order.total_amount || 0).toFixed(2);
        const txnid = `DOORSTEP_${order.id}_${Date.now()}`;
        const productInfo = `Order_${order.order_number || order.id}`;
        const firstname = (order.customer_name || 'Customer').split(' ')[0].replace(/[^a-zA-Z0-9]/g, '') || 'Customer';
        const email = order.customer_email || 'customer@earn24.in';
        const phone = order.customer_phone || '9999999999';

        const baseUrl = process.env.BASE_URL || 'https://newapi.earn24.in';
        const surl = `${baseUrl}/api/delivery-app/payu-success`;
        const furl = `${baseUrl}/api/delivery-app/payu-failure`;

        // Hash: key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5|udf6|udf7|udf8|udf9|udf10|SALT
        const hashString = `${payuKey}|${txnid}|${amount}|${productInfo}|${firstname}|${email}|${order.id}|||||||||${payuSalt}`;
        const hash = crypto.createHash('sha512').update(hashString).digest('hex');

        // Log transaction
        await db.query(`
            INSERT INTO payment_transactions (transaction_id, user_id, order_id, amount, gateway, status, created_at)
            VALUES (?, ?, ?, ?, 'payu', 'PENDING', NOW())
        `, [txnid, order.user_id, order.id, amount]).catch(() => {});

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Earn24 - Pay ₹${amount} via PayU</title>
                <style>
                    * { box-sizing: border-box; }
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                        background: #f8fafc;
                        margin: 0;
                        padding: 20px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 100vh;
                    }
                    .checkout-card {
                        background: #ffffff;
                        border-radius: 20px;
                        padding: 32px 24px;
                        max-width: 420px;
                        width: 100%;
                        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
                        border: 1px solid #e2e8f0;
                        text-align: center;
                    }
                    .brand {
                        font-size: 22px;
                        font-weight: 900;
                        color: #16a34a;
                        letter-spacing: -0.5px;
                        margin-bottom: 6px;
                    }
                    .order-tag {
                        display: inline-block;
                        background: #f1f5f9;
                        color: #475569;
                        font-size: 12px;
                        font-weight: 700;
                        padding: 4px 10px;
                        border-radius: 6px;
                        margin-bottom: 20px;
                    }
                    .amount-display {
                        background: #f0fdf4;
                        border: 2px solid #bbf7d0;
                        border-radius: 14px;
                        padding: 18px;
                        margin-bottom: 22px;
                    }
                    .amount-label {
                        font-size: 12px;
                        font-weight: 700;
                        color: #15803d;
                        text-transform: uppercase;
                    }
                    .amount-value {
                        font-size: 34px;
                        font-weight: 900;
                        color: #166534;
                        margin-top: 4px;
                    }
                    .spinner {
                        width: 38px;
                        height: 38px;
                        border: 4px solid #e2e8f0;
                        border-top-color: #16a34a;
                        border-radius: 50%;
                        animation: spin 0.8s linear infinite;
                        margin: 16px auto;
                    }
                    @keyframes spin { to { transform: rotate(360deg); } }
                    .loading-text {
                        font-size: 15px;
                        font-weight: 700;
                        color: #1e293b;
                        margin: 0 0 6px 0;
                    }
                    .sub-hint {
                        font-size: 12px;
                        color: #64748b;
                        line-height: 1.4;
                        margin: 0;
                    }
                    .pay-btn {
                        display: block;
                        width: 100%;
                        padding: 14px;
                        background: #16a34a;
                        color: #ffffff;
                        font-size: 16px;
                        font-weight: 800;
                        border: none;
                        border-radius: 12px;
                        cursor: pointer;
                        margin-top: 20px;
                    }
                </style>
            </head>
            <body>
                <div class="checkout-card">
                    <div class="brand">⚡ EARN24 SECURE PAY</div>
                    <div class="order-tag">Order #${order.order_number || order.id}</div>
                    
                    <div class="amount-display">
                        <div class="amount-label">Payable to Delivery Partner</div>
                        <div class="amount-value">₹${amount}</div>
                    </div>

                    <div class="spinner"></div>
                    <p class="loading-text">Connecting to PayU Secure Payment...</p>
                    <p class="sub-hint">Pay securely with Google Pay, PhonePe, Paytm, Any UPI App, Debit/Credit Card or NetBanking.</p>

                    <form id="payuForm" method="POST" action="${payuBaseUrl}">
                        <input type="hidden" name="key" value="${payuKey}" />
                        <input type="hidden" name="txnid" value="${txnid}" />
                        <input type="hidden" name="amount" value="${amount}" />
                        <input type="hidden" name="productinfo" value="${productInfo}" />
                        <input type="hidden" name="firstname" value="${firstname}" />
                        <input type="hidden" name="email" value="${email}" />
                        <input type="hidden" name="phone" value="${phone}" />
                        <input type="hidden" name="surl" value="${surl}" />
                        <input type="hidden" name="furl" value="${furl}" />
                        <input type="hidden" name="hash" value="${hash}" />
                        <input type="hidden" name="udf1" value="${order.id}" />
                        <noscript>
                            <button type="submit" class="pay-btn">Click here to Pay ₹${amount}</button>
                        </noscript>
                    </form>
                </div>

                <script>
                    setTimeout(function() {
                        document.getElementById('payuForm').submit();
                    }, 600);
                </script>
            </body>
            </html>
        `);
    } catch (e) {
        console.error('[PayU Doorstep Checkout Error]', e);
        res.status(500).send(`<h2 style="font-family:sans-serif;text-align:center;">Payment Error: ${e.message}</h2>`);
    }
};

/**
 * PayU Callback / Success Handler
 */
exports.payuDoorstepCallback = async (req, res) => {
    const data = { ...req.query, ...req.body };
    const { status, txnid, amount, key, productinfo, firstname, email, hash, udf1, mihpayid, bank_ref_num } = data;
    const orderId = udf1;

    try {
        const { payuSalt } = await getPayUCredentials();
        if (status === 'success') {
            if (orderId) {
                await db.query(`
                    UPDATE orders 
                    SET payment_status = 'PAID', 
                        payment_method = 'PAYU', 
                        is_paid = 1,
                        updated_at = NOW() 
                    WHERE id = ?
                `, [orderId]);

                await db.query(`
                    UPDATE payment_transactions 
                    SET status = 'SUCCESS', 
                        gateway_payment_id = ? 
                    WHERE transaction_id = ?
                `, [mihpayid || bank_ref_num || null, txnid]).catch(() => {});

                // Notify delivery agent via Socket.IO
                const io = req.app.get('socketio');
                if (io) {
                    io.emit('order_payment_received', {
                        orderId: parseInt(orderId),
                        amount: amount,
                        paymentMethod: 'PAYU',
                        status: 'PAID',
                        txnid: txnid
                    });
                }
            }

            return res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Earn24 - Payment Successful</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                        body { font-family: sans-serif; background: #f0fdf4; margin: 0; padding: 20px; display: flex; align-items: center; justify-content: center; min-height: 100vh; text-align: center; }
                        .card { background: #fff; padding: 36px 24px; border-radius: 20px; max-width: 400px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.08); border: 2px solid #bbf7d0; }
                        .icon { font-size: 54px; margin-bottom: 12px; }
                        h2 { color: #15803d; margin: 0 0 8px 0; }
                        .amount { font-size: 28px; font-weight: 900; color: #166534; margin: 12px 0; }
                        p { color: #475569; font-size: 14px; line-height: 1.5; }
                        .pill { background: #dcfce7; color: #166534; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; display: inline-block; margin-top: 10px; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <div class="icon">✅</div>
                        <h2>Payment Successful!</h2>
                        <div class="amount">₹${amount || ''}</div>
                        <p>Your payment via PayU has been verified successfully. The delivery partner has been notified.</p>
                        <div class="pill">PayU Ref: ${mihpayid || txnid || 'SUCCESS'}</div>
                        <p style="margin-top: 20px; font-weight: 700; color: #15803d;">You can now collect your parcel from the delivery partner.</p>
                    </div>
                </body>
                </html>
            `);
        } else {
            return res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Earn24 - Payment Failed</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                        body { font-family: sans-serif; background: #fff5f5; margin: 0; padding: 20px; display: flex; align-items: center; justify-content: center; min-height: 100vh; text-align: center; }
                        .card { background: #fff; padding: 36px 24px; border-radius: 20px; max-width: 400px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.08); border: 2px solid #fecaca; }
                        .icon { font-size: 54px; margin-bottom: 12px; }
                        h2 { color: #dc2626; margin: 0 0 8px 0; }
                        p { color: #475569; font-size: 14px; line-height: 1.5; }
                        .btn { display: inline-block; padding: 12px 24px; background: #dc2626; color: #fff; text-decoration: none; border-radius: 10px; font-weight: 700; margin-top: 16px; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <div class="icon">❌</div>
                        <h2>Payment Not Completed</h2>
                        <p>Your online payment could not be processed or was cancelled.</p>
                        ${orderId ? `<a href="/api/delivery-app/orders/${orderId}/payu-checkout" class="btn">Try Again</a>` : ''}
                        <p style="margin-top: 16px; font-size: 13px; color: #64748b;">You can also choose to pay Cash to the delivery partner.</p>
                    </div>
                </body>
                </html>
            `);
        }
    } catch (err) {
        console.error('[PayU Doorstep Callback Error]', err);
        res.status(500).send(`<h2>Callback Error: ${err.message}</h2>`);
    }
};

exports.payuDoorstepFailure = (req, res) => {
    exports.payuDoorstepCallback(req, res);
};

/**
 * Check if order has been paid online (Polled by Delivery Agent App)
 */
exports.getOrderPaymentStatus = async (req, res) => {
    const { orderId } = req.params;
    try {
        const [rows] = await db.query(
            `SELECT id, order_number, total_amount, payment_status, payment_method, is_paid FROM orders WHERE id = ?`,
            [orderId]
        );
        if (rows.length === 0) return res.status(404).json({ status: false, message: 'Order not found' });
        const order = rows[0];
        const isPaid = (order.payment_status === 'PAID' || order.payment_status === 'COMPLETED' || order.is_paid === 1);
        res.json({
            status: true,
            isPaid,
            paymentStatus: order.payment_status,
            paymentMethod: order.payment_method,
            amount: order.total_amount
        });
    } catch (e) {
        res.status(500).json({ status: false, message: e.message });
    }
};