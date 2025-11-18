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