require('dotenv').config();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const axios = require('axios');
const moment = require('moment-timezone');
const db = require("../../db"); // Ensure this path matches your DB config
const { encryptObject, decryptObject } = require('../utils/encryption.helper');

// --- 1. ADMIN: SAVE/ADD GATEWAY ---
exports.savePaymentGateway = async (req, res) => {
    try {
        let { gateway_name, is_active, config } = req.body; 
        // Config example for Razorpay: { key_id: "...", secret: "..." }
        // Config example for PhonePe: { merchantId: "...", secret: "...", version: "1" }

        if (is_active === undefined) is_active = 0;

        // Encrypt the credentials before saving
        const { encryptedData, iv } = encryptObject(config);

        await db.query(
            `INSERT INTO payment_gateway_settings (gateway_name, is_active, encrypted_config, encryption_iv)
             VALUES (?, ?, ?, ?)`,
            [gateway_name.toLowerCase(), is_active, encryptedData, iv]
        );

        res.status(200).json({ status: true, message: "Payment gateway saved successfully" });
    } catch (error) {
        console.error("Error saving payment gateway:", error);
        res.status(500).json({ status: false, message: "Internal server error" });
    }
};

// --- 2. ADMIN: GET ALL GATEWAYS (Secure) ---
exports.getAllGateways = async (req, res) => {
    try {
        const [rows] = await db.query(`SELECT id, gateway_name, is_active FROM payment_gateway_settings`);
        res.status(200).json({ status: true, gateways: rows });
    } catch (error) {
        console.error("Error fetching gateways:", error);
        res.status(500).json({ status: false, message: "Internal server error" });
    }
};

// --- 3. ADMIN: ACTIVATE GATEWAY (Switch Logic) ---
exports.activateGateway = async (req, res) => {
    try {
        const { id } = req.params;
        // 1. Deactivate all
        await db.query('UPDATE payment_gateway_settings SET is_active = false');
        // 2. Activate selected
        const [result] = await db.query('UPDATE payment_gateway_settings SET is_active = true WHERE id = ?', [id]);

        if (result.affectedRows === 0) return res.status(404).json({ status: false, message: "Gateway not found." });

        res.status(200).json({ status: true, message: "Gateway activated successfully." });
    } catch (error) {
        console.error("Error activating gateway:", error);
        res.status(500).json({ status: false, message: "Internal server error" });
    }
};

// --- 4. PUBLIC: CREATE ORDER (Dynamic based on Active Gateway) ---
exports.createOrder = async (req, res) => {
    try {
        // E-Commerce Context: We expect userId and the Total Amount to be passed (or calculated)
        const { userId, name, email, mobile, amount } = req.body; 

        if (!userId || !amount || !name || !email || !mobile) {
            return res.status(400).json({ status: false, message: "Missing required details." });
        }

        // 1. Fetch the currently ACTIVE gateway
        const [rows] = await db.query(
            'SELECT gateway_name, encrypted_config, encryption_iv FROM payment_gateway_settings WHERE is_active = 1 LIMIT 1'
        );

        if (rows.length === 0) {
            return res.status(503).json({ status: false, message: "No active payment gateway is configured." });
        }

        const activeGateway = rows[0];
        const decryptedConfig = decryptObject({
            encryptedData: activeGateway.encrypted_config,
            iv: activeGateway.encryption_iv,
        });

        let responsePayload;

        // 2. Switch logic based on provider
        switch (activeGateway.gateway_name.toLowerCase()) {
            case "razorpay":
                const razorpay = new Razorpay({
                    key_id: decryptedConfig.key_id,
                    key_secret: decryptedConfig.secret,
                });
                const order = await razorpay.orders.create({
                    amount: amount * 100, // Razorpay takes paise
                    currency: "INR",
                    receipt: `receipt_${Date.now()}`,
                });
                responsePayload = { gateway: "razorpay", key_id: decryptedConfig.key_id, order };
                break;

            case "phonepe":
                const { merchantId, secret, version } = decryptedConfig;
                const transactionId = `TXN${Date.now()}`;
                
                // Redirect URL for frontend
                // CHANGE THIS URL to your actual frontend domain
                const redirectUrl = `https://your-website.com/payment-status?id=${transactionId}`; 

                const payload = {
                    merchantId: merchantId,
                    merchantTransactionId: transactionId,
                    merchantUserId: `USER${userId}`,
                    amount: amount * 100,
                    redirectUrl: redirectUrl,
                    redirectMode: "POST",
                    paymentInstrument: { type: "PAY_PAGE" }
                };

                const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
                const xVerify = crypto.createHash('sha256')
                    .update(base64Payload + '/pg/v1/pay' + secret)
                    .digest('hex') + '###' + version;

                const phonePeRes = await axios.post(
                    "https://api.phonepe.com/apis/hermes/pg/v1/pay", // Use https://api-preprod.phonepe.com/apis/pg-sandbox for testing
                    { request: base64Payload },
                    { headers: { 'Content-Type': 'application/json', 'X-VERIFY': xVerify } }
                );

                responsePayload = {
                    gateway: "phonepe",
                    redirectUrl: phonePeRes.data.data.instrumentResponse.redirectInfo.url,
                    transactionId: transactionId
                };
                
                // Save Initial Transaction State to DB
                await db.query('INSERT INTO payment_transactions (transaction_id, user_id, amount, gateway, status) VALUES (?, ?, ?, ?, ?)', 
                [transactionId, userId, amount, 'phonepe', 'PENDING']);
                break;

            default:
                return res.status(500).json({ status: false, message: "Active gateway not supported." });
        }

        return res.status(200).json({ status: true, ...responsePayload });

    } catch (err) {
        console.error("Payment Init Error:", err);
        return res.status(500).json({ status: false, message: "Payment initiation failed" });
    }
};

// --- 5. PUBLIC: VERIFY PAYMENT (Razorpay Specific) ---
exports.verifyPayment = async (req, res) => {
    try {
        const { gateway_name, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        if (gateway_name === 'razorpay') {
            const [rows] = await db.query('SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE gateway_name = ?', ['razorpay']);
            const config = decryptObject({ encryptedData: rows[0].encrypted_config, iv: rows[0].encryption_iv });

            const hmac = crypto.createHmac('sha256', config.secret);
            hmac.update(razorpay_order_id + "|" + razorpay_payment_id);
            const generated_signature = hmac.digest('hex');

            if (generated_signature === razorpay_signature) {
                // TODO: Update Order Status in Database to 'Success'
                // TODO: Trigger MLM Commission Distribution Here
                return res.status(200).json({ status: true, message: "Payment Verified" });
            } else {
                return res.status(400).json({ status: false, message: "Invalid Signature" });
            }
        }
    } catch (error) {
        console.error("Verification Error:", error);
        res.status(500).json({ status: false, message: "Verification failed" });
    }
};

// --- 6. PUBLIC: CHECK STATUS (PhonePe Specific) ---
exports.checkPhonePeStatus = async (req, res) => {
    try {
        const { transactionId } = req.params;
        
        // Fetch config
        const [rows] = await db.query('SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE gateway_name = ?', ['phonepe']);
        const config = decryptObject({ encryptedData: rows[0].encrypted_config, iv: rows[0].encryption_iv });
        
        const xVerify = crypto.createHash('sha256')
            .update(`/pg/v1/status/${config.merchantId}/${transactionId}` + config.secret)
            .digest('hex') + '###' + config.version;

        const response = await axios.get(
            `https://api.phonepe.com/apis/hermes/pg/v1/status/${config.merchantId}/${transactionId}`,
            { headers: { 'Content-Type': 'application/json', 'X-VERIFY': xVerify, 'X-MERCHANT-ID': config.merchantId } }
        );

        if (response.data.code === 'PAYMENT_SUCCESS') {
            // TODO: Update Database
            // TODO: Trigger MLM Logic
            return res.status(200).json({ status: true, message: "Payment Success" });
        } else {
            return res.status(400).json({ status: false, message: "Payment Pending or Failed" });
        }

    } catch (error) {
        console.error("PhonePe Status Error:", error);
        res.status(500).json({ status: false, message: "Check failed" });
    }
};