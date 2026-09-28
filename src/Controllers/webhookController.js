// src/Controllers/webhookController.js
const db = require('../../db');
const commissionService = require('../Services/commissionService');

exports.handlePaymentSuccess = async (req, res) => {
    // IMPORTANT: Verify the webhook signature from your payment gateway here.
    // This is a placeholder for that logic.
    const isSignatureValid = true; 
    if (!isSignatureValid) {
        return res.status(400).send('Invalid signature');
    }

    // Assuming the order ID is in the payload notes from when you created the payment
    const orderId = req.body.payload.payment.entity.notes.order_id;
    if (!orderId) {
        return res.status(400).send('Order ID missing from webhook payload.');
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [orders] = await connection.query('SELECT payment_status FROM orders WHERE id = ? FOR UPDATE', [orderId]);
        if (!orders.length || orders[0].payment_status === 'COMPLETED') {
            await connection.commit();
            return res.status(200).send('Order already processed or not found.');
        }

        await connection.query("UPDATE orders SET payment_status = 'COMPLETED', order_status = 'CONFIRMED' WHERE id = ?", [orderId]);
        
        await connection.commit();

        // Trigger MLM commission processing asynchronously
        commissionService.triggerCommissionProcessing(orderId);

        res.status(200).send('Webhook processed successfully.');

    } catch (error) {
        await connection.rollback();
        console.error(`Webhook processing failed for order ${orderId}:`, error);
        res.status(500).send('Internal Server Error');
    } finally {
        if (connection) connection.release();
    }
};

/**
 * Shiprocket Tracking Webhook Handler
 * Called automatically by Shiprocket when courier status updates (In Transit, Out For Delivery, Delivered)
 */
exports.handleShiprocketWebhook = async (req, res) => {
    try {
        console.log('[Shiprocket Webhook] Received update:', JSON.stringify(req.body));

        const awb = req.body.awb || req.body.awb_code || req.body.tracking_number;
        const rawStatus = String(req.body.current_status || req.body.shipment_status || req.body.status || '').toUpperCase();
        const orderIdStr = req.body.order_id || req.body.channel_order_id;
        const courierName = req.body.courier_name || '';

        if (!awb && !orderIdStr) {
            return res.status(400).json({ status: false, message: 'Missing awb or order_id in webhook payload' });
        }

        // Map Shiprocket status string to Earn24 item status
        let targetItemStatus = 'SHIPPED';
        let isDelivered = false;
        let isPickedUp = false;

        if (rawStatus.includes('DELIVERED') && !rawStatus.includes('RTO')) {
            targetItemStatus = 'DELIVERED';
            isDelivered = true;
        } else if (rawStatus.includes('OUT FOR DELIVERY') || rawStatus.includes('OUT_FOR_DELIVERY')) {
            targetItemStatus = 'OUT_FOR_DELIVERY';
        } else if (rawStatus.includes('TRANSIT') || rawStatus.includes('SHIPPED')) {
            targetItemStatus = 'IN_TRANSIT';
        } else if (rawStatus.includes('PICK') || rawStatus.includes('REACHED AT PICKUP')) {
            targetItemStatus = 'PICKED_UP';
            isPickedUp = true;
        } else if (rawStatus.includes('CANCEL')) {
            targetItemStatus = 'CANCELLED';
        } else if (rawStatus.includes('RTO')) {
            targetItemStatus = 'RTO';
        }

        // 1. Update order_items matching this AWB
        if (awb) {
            await db.query(
                `UPDATE order_items 
                 SET item_status = ?,
                     delivered_at = IF(? = 1, COALESCE(delivered_at, NOW()), delivered_at),
                     picked_up_at = IF(? = 1, COALESCE(picked_up_at, NOW()), picked_up_at)
                 WHERE tracking_number = ?`,
                [targetItemStatus, isDelivered ? 1 : 0, isPickedUp ? 1 : 0, awb]
            ).catch(err => console.error('[Shiprocket Webhook] order_items update error:', err.message));

            // 2. Check if parent order needs status update
            const [matchedItems] = await db.query(
                `SELECT order_id FROM order_items WHERE tracking_number = ? LIMIT 1`,
                [awb]
            ).catch(() => [[]]);

            if (matchedItems && matchedItems.length > 0) {
                const parentOrderId = matchedItems[0].order_id;

                if (isDelivered) {
                    const [allItems] = await db.query(
                        `SELECT item_status FROM order_items WHERE order_id = ?`,
                        [parentOrderId]
                    ).catch(() => [[]]);

                    const allDone = allItems.length > 0 && allItems.every(i => i.item_status === 'DELIVERED' || i.item_status === 'CANCELLED');
                    if (allDone) {
                        await db.query(
                            `UPDATE orders 
                             SET order_status = 'DELIVERED', 
                                 delivered_at = COALESCE(delivered_at, NOW()) 
                             WHERE id = ?`,
                            [parentOrderId]
                        ).catch(err => console.error('[Shiprocket Webhook] orders delivery update error:', err.message));

                        console.log(`[Shiprocket Webhook] ✅ Parent Order #${parentOrderId} completely marked as DELIVERED!`);
                    }
                } else if (isPickedUp) {
                    await db.query(
                        `UPDATE orders SET order_status = 'SHIPPED_SHIPROCKET' WHERE id = ? AND order_status IN ('PENDING', 'CONFIRMED', 'PROCESSING')`,
                        [parentOrderId]
                    ).catch(() => {});
                }
            }
        }

        res.status(200).json({ status: true, message: 'Shiprocket tracking webhook processed successfully' });
    } catch (error) {
        console.error('[Shiprocket Webhook Fatal Error]:', error);
        res.status(500).json({ status: false, error: error.message });
    }
};