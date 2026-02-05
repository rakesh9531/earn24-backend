// require("dotenv").config();
// const Razorpay = require("razorpay");
// const crypto = require("crypto");
// const axios = require("axios");
// const moment = require("moment-timezone");
// const db = require("../../db"); // Ensure this path matches your DB config
// const { encryptObject, decryptObject } = require("../utils/encryption.helper");

// // --- 1. ADMIN: SAVE/ADD GATEWAY ---
// exports.savePaymentGateway = async (req, res) => {
//   try {
//     let { gateway_name, is_active, config } = req.body;
//     // Config example for Razorpay: { key_id: "...", secret: "..." }
//     // Config example for PhonePe: { merchantId: "...", secret: "...", version: "1" }

//     if (is_active === undefined) is_active = 0;

//     // Encrypt the credentials before saving
//     const { encryptedData, iv } = encryptObject(config);

//     await db.query(
//       `INSERT INTO payment_gateway_settings (gateway_name, is_active, encrypted_config, encryption_iv)
//              VALUES (?, ?, ?, ?)`,
//       [gateway_name.toLowerCase(), is_active, encryptedData, iv]
//     );

//     res
//       .status(200)
//       .json({ status: true, message: "Payment gateway saved successfully" });
//   } catch (error) {
//     console.error("Error saving payment gateway:", error);
//     res.status(500).json({ status: false, message: "Internal server error" });
//   }
// };

// // --- 2. ADMIN: GET ALL GATEWAYS (Secure) ---
// exports.getAllGateways = async (req, res) => {
//   try {
//     const [rows] = await db.query(
//       `SELECT id, gateway_name, is_active FROM payment_gateway_settings`
//     );
//     res.status(200).json({ status: true, gateways: rows });
//   } catch (error) {
//     console.error("Error fetching gateways:", error);
//     res.status(500).json({ status: false, message: "Internal server error" });
//   }
// };

// // --- 3. ADMIN: ACTIVATE GATEWAY (Switch Logic) ---
// exports.activateGateway = async (req, res) => {
//   try {
//     const { id } = req.params;
//     // 1. Deactivate all
//     await db.query("UPDATE payment_gateway_settings SET is_active = false");
//     // 2. Activate selected
//     const [result] = await db.query(
//       "UPDATE payment_gateway_settings SET is_active = true WHERE id = ?",
//       [id]
//     );

//     if (result.affectedRows === 0)
//       return res
//         .status(404)
//         .json({ status: false, message: "Gateway not found." });

//     res
//       .status(200)
//       .json({ status: true, message: "Gateway activated successfully." });
//   } catch (error) {
//     console.error("Error activating gateway:", error);
//     res.status(500).json({ status: false, message: "Internal server error" });
//   }
// };




// // --- [NEW] ADMIN: GET SINGLE GATEWAY CONFIG (Decrypted) ---
// exports.getGatewayConfig = async (req, res) => {
//   try {
//     const { id } = req.params;
    
//     const [rows] = await db.query(
//       `SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE id = ?`,
//       [id]
//     );

//     if (rows.length === 0) {
//       return res.status(404).json({ status: false, message: "Gateway not found" });
//     }

//     // Decrypt the config before sending to frontend (Only for Admin)
//     const decryptedConfig = decryptObject({
//       encryptedData: rows[0].encrypted_config,
//       iv: rows[0].encryption_iv,
//     });

//     res.status(200).json({ status: true, config: decryptedConfig });
//   } catch (error) {
//     console.error("Error fetching gateway config:", error);
//     res.status(500).json({ status: false, message: "Internal server error" });
//   }
// };

// // --- [NEW] ADMIN: UPDATE GATEWAY ---
// exports.updateGateway = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { gateway_name, config } = req.body;

//     // Encrypt new config
//     const { encryptedData, iv } = encryptObject(config);

//     await db.query(
//       `UPDATE payment_gateway_settings 
//        SET gateway_name = ?, encrypted_config = ?, encryption_iv = ? 
//        WHERE id = ?`,
//       [gateway_name.toLowerCase(), encryptedData, iv, id]
//     );

//     res.status(200).json({ status: true, message: "Gateway updated successfully" });
//   } catch (error) {
//     console.error("Error updating gateway:", error);
//     res.status(500).json({ status: false, message: "Internal server error" });
//   }
// };










// // --- 4. PUBLIC: CREATE ORDER (Dynamic based on Active Gateway) ---
// exports.createOrder = async (req, res) => {
//   try {
//     // E-Commerce Context: We expect userId and the Total Amount to be passed (or calculated)
//     const { userId, name, email, mobile, amount } = req.body;

//     if (!userId || !amount || !name || !email || !mobile) {
//       return res
//         .status(400)
//         .json({ status: false, message: "Missing required details." });
//     }

//     // 1. Fetch the currently ACTIVE gateway
//     const [rows] = await db.query(
//       "SELECT gateway_name, encrypted_config, encryption_iv FROM payment_gateway_settings WHERE is_active = 1 LIMIT 1"
//     );

//     if (rows.length === 0) {
//       return res.status(503).json({
//         status: false,
//         message: "No active payment gateway is configured.",
//       });
//     }

//     const activeGateway = rows[0];
//     const decryptedConfig = decryptObject({
//       encryptedData: activeGateway.encrypted_config,
//       iv: activeGateway.encryption_iv,
//     });

//     let responsePayload;

//     // 2. Switch logic based on provider
//     switch (activeGateway.gateway_name.toLowerCase()) {
//       case "payu":
//         const { merchantKey, merchantSalt, isSandbox } = decryptedConfig;
//         const txnid = `TXN${Date.now()}`;
//         const productinfo = "Order_Payment";

//         // Hash sequence: key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt
//         const hashString = `${merchantKey}|${txnid}|${amount}|${productinfo}|${name}|${email}|||||||||||${merchantSalt}`;
//         const hash = crypto
//           .createHash("sha512")
//           .update(hashString)
//           .digest("hex");

//         responsePayload = {
//           gateway: "payu",
//           payu_url: isSandbox
//             ? "https://test.payu.in/_payment"
//             : "https://secure.payu.in/_payment",
//           params: {
//             key: merchantKey,
//             txnid: txnid,
//             amount: amount,
//             productinfo: productinfo,
//             firstname: name,
//             email: email,
//             phone: mobile,
//             hash: hash,
//             surl: `https://newapi.earn24.in/api/payment/verify-payment`, // Your backend URL
//             furl: `https://newapi.earn24.in/api/payment/verify-payment`, // Your backend URL
//           },
//         };

//         // Log transaction
//         await db.query(
//           "INSERT INTO payment_transactions (transaction_id, user_id, amount, gateway, status) VALUES (?, ?, ?, ?, ?)",
//           [txnid, userId, amount, "payu", "PENDING"]
//         );
//         break;

//       case "razorpay":
//         const razorpay = new Razorpay({
//           key_id: decryptedConfig.key_id,
//           key_secret: decryptedConfig.secret,
//         });
//         const order = await razorpay.orders.create({
//           amount: amount * 100, // Razorpay takes paise
//           currency: "INR",
//           receipt: `receipt_${Date.now()}`,
//         });
//         responsePayload = {
//           gateway: "razorpay",
//           key_id: decryptedConfig.key_id,
//           order,
//         };
//         break;

//       case "phonepe":
//         const { merchantId, secret, version } = decryptedConfig;
//         const transactionId = `TXN${Date.now()}`;

//         // Redirect URL for frontend
//         // CHANGE THIS URL to your actual frontend domain
//         const redirectUrl = `https://your-website.com/payment-status?id=${transactionId}`;

//         const payload = {
//           merchantId: merchantId,
//           merchantTransactionId: transactionId,
//           merchantUserId: `USER${userId}`,
//           amount: amount * 100,
//           redirectUrl: redirectUrl,
//           redirectMode: "POST",
//           paymentInstrument: { type: "PAY_PAGE" },
//         };

//         const base64Payload = Buffer.from(JSON.stringify(payload)).toString(
//           "base64"
//         );
//         const xVerify =
//           crypto
//             .createHash("sha256")
//             .update(base64Payload + "/pg/v1/pay" + secret)
//             .digest("hex") +
//           "###" +
//           version;

//         const phonePeRes = await axios.post(
//           "https://api.phonepe.com/apis/hermes/pg/v1/pay", // Use https://api-preprod.phonepe.com/apis/pg-sandbox for testing
//           { request: base64Payload },
//           {
//             headers: {
//               "Content-Type": "application/json",
//               "X-VERIFY": xVerify,
//             },
//           }
//         );

//         responsePayload = {
//           gateway: "phonepe",
//           redirectUrl: phonePeRes.data.data.instrumentResponse.redirectInfo.url,
//           transactionId: transactionId,
//         };

//         // Save Initial Transaction State to DB
//         await db.query(
//           "INSERT INTO payment_transactions (transaction_id, user_id, amount, gateway, status) VALUES (?, ?, ?, ?, ?)",
//           [transactionId, userId, amount, "phonepe", "PENDING"]
//         );
//         break;

//       default:
//         return res
//           .status(500)
//           .json({ status: false, message: "Active gateway not supported." });
//     }

//     return res.status(200).json({ status: true, ...responsePayload });
//   } catch (err) {
//     console.error("Payment Init Error:", err);
//     return res
//       .status(500)
//       .json({ status: false, message: "Payment initiation failed" });
//   }
// };

// // --- 5. PUBLIC: VERIFY PAYMENT (Razorpay Specific) ---
// exports.verifyPayment = async (req, res) => {
//   try {
//     // 1. PayU Check (PayU sends data in req.body directly)
//     if (req.body.hash && req.body.mihpayid) {
//       const {
//         status,
//         txnid,
//         amount,
//         firstname,
//         email,
//         hash,
//         key,
//         productinfo,
//       } = req.body;

//       const [rows] = await db.query(
//         "SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE gateway_name = ?",
//         ["payu"]
//       );
//       const config = decryptObject({
//         encryptedData: rows[0].encrypted_config,
//         iv: rows[0].encryption_iv,
//       });

//       // Reverse Hash: sha512(salt|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
//       const reverseHashString = `${config.merchantSalt}|${status}|||||||||||${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
//       const generatedHash = crypto
//         .createHash("sha512")
//         .update(reverseHashString)
//         .digest("hex");

//       if (generatedHash === hash && status === "success") {
//         await db.query(
//           'UPDATE payment_transactions SET status = "SUCCESS" WHERE transaction_id = ?',
//           [txnid]
//         );
//         // For Mobile App: Redirect to a Success Screen or send HTML
//         return res.send(
//           "<h1>Payment Successful</h1><p>You can close this window.</p>"
//         );
//       } else {
//         await db.query(
//           'UPDATE payment_transactions SET status = "FAILED" WHERE transaction_id = ?',
//           [txnid]
//         );
//         return res.send("<h1>Payment Failed</h1>");
//       }
//     }

//     const {
//       gateway_name,
//       razorpay_order_id,
//       razorpay_payment_id,
//       razorpay_signature,
//     } = req.body;

//     if (gateway_name === "razorpay") {
//       const [rows] = await db.query(
//         "SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE gateway_name = ?",
//         ["razorpay"]
//       );
//       const config = decryptObject({
//         encryptedData: rows[0].encrypted_config,
//         iv: rows[0].encryption_iv,
//       });

//       const hmac = crypto.createHmac("sha256", config.secret);
//       hmac.update(razorpay_order_id + "|" + razorpay_payment_id);
//       const generated_signature = hmac.digest("hex");

//       if (generated_signature === razorpay_signature) {
//         // TODO: Update Order Status in Database to 'Success'
//         // TODO: Trigger MLM Commission Distribution Here
//         return res
//           .status(200)
//           .json({ status: true, message: "Payment Verified" });
//       } else {
//         return res
//           .status(400)
//           .json({ status: false, message: "Invalid Signature" });
//       }
//     }
//   } catch (error) {
//     console.error("Verification Error:", error);
//     res.status(500).json({ status: false, message: "Verification failed" });
//   }
// };

// // --- 6. PUBLIC: CHECK STATUS (PhonePe Specific) ---
// exports.checkPhonePeStatus = async (req, res) => {
//   try {
//     const { transactionId } = req.params;

//     // Fetch config
//     const [rows] = await db.query(
//       "SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE gateway_name = ?",
//       ["phonepe"]
//     );
//     const config = decryptObject({
//       encryptedData: rows[0].encrypted_config,
//       iv: rows[0].encryption_iv,
//     });

//     const xVerify =
//       crypto
//         .createHash("sha256")
//         .update(
//           `/pg/v1/status/${config.merchantId}/${transactionId}` + config.secret
//         )
//         .digest("hex") +
//       "###" +
//       config.version;

//     const response = await axios.get(
//       `https://api.phonepe.com/apis/hermes/pg/v1/status/${config.merchantId}/${transactionId}`,
//       {
//         headers: {
//           "Content-Type": "application/json",
//           "X-VERIFY": xVerify,
//           "X-MERCHANT-ID": config.merchantId,
//         },
//       }
//     );

//     if (response.data.code === "PAYMENT_SUCCESS") {
//       // TODO: Update Database
//       // TODO: Trigger MLM Logic
//       return res.status(200).json({ status: true, message: "Payment Success" });
//     } else {
//       return res
//         .status(400)
//         .json({ status: false, message: "Payment Pending or Failed" });
//     }
//   } catch (error) {
//     console.error("PhonePe Status Error:", error);
//     res.status(500).json({ status: false, message: "Check failed" });
//   }
// };





// // --- 7. SERVER-TO-SERVER: PAYU WEBHOOK ---
// exports.payuWebhook = async (req, res) => {
//   try {
//     const {
//       status,      // 'success' or 'failure'
//       txnid,       // Your Transaction ID
//       amount,
//       firstname,
//       email,
//       hash,        // The hash sent by PayU
//       key,
//       productinfo,
//       mihpayid     // PayU's internal ID
//     } = req.body;

//     console.log("PayU Webhook Received:", txnid, status);

//     // 1. Get Secret Keys from DB
//     const [rows] = await db.query(
//       "SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE gateway_name = ?",
//       ["payu"]
//     );
    
//     if (rows.length === 0) return res.status(200).send("OK"); // Gateway not active

//     const config = decryptObject({
//       encryptedData: rows[0].encrypted_config,
//       iv: rows[0].encryption_iv,
//     });

//     // 2. Verify Hash (Security Check)
//     // Formula: sha512(SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
//     const reverseHashString = `${config.merchantSalt}|${status}|||||||||||${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
//     const generatedHash = crypto.createHash("sha512").update(reverseHashString).digest("hex");

//     if (generatedHash !== hash) {
//       console.error("Webhook Hash Mismatch! Possible Fraud.");
//       return res.status(400).send("Invalid Hash");
//     }

//     // 3. Update Database
//     if (status === "success") {
//       await db.query(
//         'UPDATE payment_transactions SET status = "SUCCESS", gateway_payment_id = ? WHERE transaction_id = ?',
//         [mihpayid, txnid]
//       );
//       // OPTIONAL: Update Order Status here if you link transactions to orders
//     } else {
//       await db.query(
//         'UPDATE payment_transactions SET status = "FAILED" WHERE transaction_id = ?',
//         [txnid]
//       );
//     }

//     // 4. Always respond 200 OK to PayU
//     return res.status(200).send("OK");

//   } catch (error) {
//     console.error("Webhook Error:", error);
//     // Even on error, sending 200 prevents PayU from retrying indefinitely if it's a code bug
//     return res.status(200).send("Error");
//   }
// };



















require("dotenv").config();
const Razorpay = require("razorpay");
const crypto = require("crypto");
const axios = require("axios");
const db = require("../../db");
const { encryptObject, decryptObject } = require("../utils/encryption.helper");

// ==============================================================================
// === ADMIN ROUTES: GATEWAY CONFIGURATION
// ==============================================================================

// 1. SAVE NEW GATEWAY
exports.savePaymentGateway = async (req, res) => {
  try {
    let { gateway_name, is_active, config } = req.body;
    if (is_active === undefined) is_active = 0;

    const { encryptedData, iv } = encryptObject(config);

    await db.query(
      `INSERT INTO payment_gateway_settings (gateway_name, is_active, encrypted_config, encryption_iv) VALUES (?, ?, ?, ?)`,
      [gateway_name.toLowerCase(), is_active, encryptedData, iv]
    );

    res.status(200).json({ status: true, message: "Payment gateway saved successfully" });
  } catch (error) {
    console.error("Save Gateway Error:", error);
    res.status(500).json({ status: false, message: "Internal server error" });
  }
};

// 2. GET ALL GATEWAYS (List)
exports.getAllGateways = async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT id, gateway_name, is_active FROM payment_gateway_settings`);
    res.status(200).json({ status: true, gateways: rows });
  } catch (error) {
    res.status(500).json({ status: false, message: "Internal server error" });
  }
};

// 3. GET SINGLE CONFIG (Decrypted - For Edit)
exports.getGatewayConfig = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(`SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE id = ?`, [id]);

    if (rows.length === 0) return res.status(404).json({ status: false, message: "Gateway not found" });

    const config = decryptObject({
      encryptedData: rows[0].encrypted_config,
      iv: rows[0].encryption_iv,
    });

    res.status(200).json({ status: true, config });
  } catch (error) {
    res.status(500).json({ status: false, message: "Internal server error", error:error.message });
  }
};

// 4. UPDATE GATEWAY
exports.updateGateway = async (req, res) => {
  try {
    const { id } = req.params;
    const { gateway_name, config } = req.body;
    const { encryptedData, iv } = encryptObject(config);

    await db.query(
      `UPDATE payment_gateway_settings SET gateway_name=?, encrypted_config=?, encryption_iv=? WHERE id=?`,
      [gateway_name.toLowerCase(), encryptedData, iv, id]
    );

    res.status(200).json({ status: true, message: "Gateway updated successfully" });
  } catch (error) {
    res.status(500).json({ status: false, message: "Internal server error", error:error.message });
  }
};

// 5. ACTIVATE GATEWAY
exports.activateGateway = async (req, res) => {
  try {
    const { id } = req.params;
    await db.query("UPDATE payment_gateway_settings SET is_active = false");
    const [result] = await db.query("UPDATE payment_gateway_settings SET is_active = true WHERE id = ?", [id]);

    if (result.affectedRows === 0) return res.status(404).json({ status: false, message: "Gateway not found" });

    res.status(200).json({ status: true, message: "Gateway activated successfully." });
  } catch (error) {
    res.status(500).json({ status: false, message: "Internal server error", error:error.message });
  }
};

// ==============================================================================
// === PUBLIC ROUTES: PAYMENT PROCESSING
// ==============================================================================

// // 6. CREATE ORDER & INITIATE PAYMENT
// exports.createOrder = async (req, res) => {
//   try {
//     // IMPORTANT: 'orderId' comes from the order previously created in the 'orders' table
//     const { userId, name, email, mobile, amount, orderId } = req.body;

//     if (!userId || !amount || !orderId) {
//       return res.status(400).json({ status: false, message: "Missing Order Details (userId, amount, orderId required)." });
//     }

//     // 1. Fetch Active Gateway
//     const [rows] = await db.query(
//       "SELECT gateway_name, encrypted_config, encryption_iv FROM payment_gateway_settings WHERE is_active = 1 LIMIT 1"
//     );

//     if (rows.length === 0) {
//       return res.status(503).json({ status: false, message: "No active payment gateway configured." });
//     }

//     const activeGateway = rows[0];
//     const decryptedConfig = decryptObject({
//       encryptedData: activeGateway.encrypted_config,
//       iv: activeGateway.encryption_iv,
//     });

//     let responsePayload;
//     let transactionId = `TXN${Date.now()}`; // Unique Transaction ID

//     // 2. Generate Gateway Specific Payload
//     switch (activeGateway.gateway_name.toLowerCase()) {
      
//       // --- PAYU ---
//       case "payu":
//         const { merchantKey, merchantSalt, isSandbox } = decryptedConfig;
//         const productinfo = "Order_Payment";
        
//         // PayU Hash: key|txnid|amount|productinfo|firstname|email|||||||||||salt
//         const hashString = `${merchantKey}|${transactionId}|${amount}|${productinfo}|${name}|${email}|||||||||||${merchantSalt}`;
//         const hash = crypto.createHash("sha512").update(hashString).digest("hex");

//         responsePayload = {
//           gateway: "payu",
//           payu_url: isSandbox ? "https://test.payu.in/_payment" : "https://secure.payu.in/_payment",
//           params: {
//             key: merchantKey,
//             txnid: transactionId,
//             amount: amount,
//             productinfo: productinfo,
//             firstname: name,
//             email: email,
//             phone: mobile,
//             hash: hash,
//             surl: `${process.env.BASE_URL || 'http://localhost:3000'}/api/payment/verify-payment`, // Success URL
//             furl: `${process.env.BASE_URL || 'http://localhost:3000'}/api/payment/verify-payment`, // Failure URL
//           },
//         };
//         break;

//       // --- RAZORPAY ---
//       case "razorpay":
//         const razorpay = new Razorpay({
//           key_id: decryptedConfig.key_id,
//           key_secret: decryptedConfig.secret,
//         });
//         const rzOrder = await razorpay.orders.create({
//           amount: amount * 100, // Paise
//           currency: "INR",
//           receipt: `receipt_${orderId}`,
//         });
//         // Use Razorpay Order ID as our Transaction ID
//         transactionId = rzOrder.id; 
//         responsePayload = {
//           gateway: "razorpay",
//           key_id: decryptedConfig.key_id,
//           order: rzOrder,
//         };
//         break;

//       // --- PHONEPE ---
//       case "phonepe":
//         const { merchantId, secret, version } = decryptedConfig;
//         const redirectUrl = `https://newapi.earn24.in/api/payment/status/${transactionId}`; // Verify endpoint

//         const payload = {
//           merchantId: merchantId,
//           merchantTransactionId: transactionId,
//           merchantUserId: `USER${userId}`,
//           amount: amount * 100,
//           redirectUrl: redirectUrl,
//           redirectMode: "POST",
//           paymentInstrument: { type: "PAY_PAGE" },
//         };

//         const base64Payload = Buffer.from(JSON.stringify(payload)).toString("base64");
//         const xVerify = crypto.createHash("sha256").update(base64Payload + "/pg/v1/pay" + secret).digest("hex") + "###" + version;

//         const phonePeRes = await axios.post(
//           "https://api.phonepe.com/apis/hermes/pg/v1/pay",
//           { request: base64Payload },
//           { headers: { "Content-Type": "application/json", "X-VERIFY": xVerify } }
//         );

//         responsePayload = {
//           gateway: "phonepe",
//           redirectUrl: phonePeRes.data.data.instrumentResponse.redirectInfo.url,
//           transactionId: transactionId,
//         };
//         break;

//       default:
//         return res.status(500).json({ status: false, message: "Gateway not supported." });
//     }

//     // 3. Save Transaction & Link to Order ID
//     await db.query(
//       `INSERT INTO payment_transactions (transaction_id, user_id, order_id, amount, gateway, status) 
//        VALUES (?, ?, ?, ?, ?, ?)`,
//       [transactionId, userId, orderId, amount, activeGateway.gateway_name, "PENDING"]
//     );

//     return res.status(200).json({ status: true, ...responsePayload });

//   } catch (err) {
//     console.error("Payment Init Error:", err);
//     return res.status(500).json({ status: false, message: "Payment initiation failed", error:err.message });
//   }
// };






// // 6. CREATE ORDER & INITIATE PAYMENT test final
// exports.createOrder = async (req, res) => {
//   try {
//     const { userId, name, email, mobile, amount, orderId } = req.body;

//     // 1. Validation
//     if (!userId || !amount || !orderId) {
//       return res.status(400).json({ status: false, message: "Missing Order Details." });
//     }

//     // 2. Fetch Active Gateway
//     const [rows] = await db.query(
//       "SELECT gateway_name, encrypted_config, encryption_iv FROM payment_gateway_settings WHERE is_active = 1 LIMIT 1"
//     );

//     if (rows.length === 0) {
//       return res.status(503).json({ status: false, message: "No active payment gateway configured." });
//     }

//     const activeGateway = rows[0];
//     // Normalize name to lowercase and trim spaces to prevent matching errors
//     const gatewayName = activeGateway.gateway_name.toLowerCase().trim();

//     const decryptedConfig = decryptObject({
//       encryptedData: activeGateway.encrypted_config,
//       iv: activeGateway.encryption_iv,
//     });

//     let responsePayload = {
//         // ✅ SAFETY: Ensure gateway is always in the response, regardless of switch case
//         gateway: gatewayName 
//     };
    
//     let transactionId = `TXN${Date.now()}`;

//     // 3. Generate Gateway Specific Payload
//     switch (gatewayName) {
      
//       // --- PAYU ---
//       case "payu":
//         const { merchantKey, merchantSalt, isSandbox } = decryptedConfig;
//         const productinfo = "Order_Payment";
        
//         // PayU Hash sequence
//         const hashString = `${merchantKey}|${transactionId}|${amount}|${productinfo}|${name}|${email}|||||||||||${merchantSalt}`;
//         const hash = crypto.createHash("sha512").update(hashString).digest("hex");

//         responsePayload = {
//           ...responsePayload, // Keep the gateway key
//           payu_url: isSandbox ? "https://test.payu.in/_payment" : "https://secure.payu.in/_payment",
//           params: {
//             key: merchantKey,
//             txnid: transactionId,
//             amount: amount,
//             productinfo: productinfo,
//             firstname: name,
//             email: email,
//             phone: mobile,
//             hash: hash,
//             // Ensure these URLs point to your LIVE server or Tunneled URL (ngrok) for testing
//             surl: `${process.env.BASE_URL || 'http://localhost:3000'}/api/payment/verify-payment`, 
//             furl: `${process.env.BASE_URL || 'http://localhost:3000'}/api/payment/verify-payment`,
//           },
//         };
//         break;

//       // --- RAZORPAY ---
//       case "razorpay":
//         const razorpay = new Razorpay({
//           key_id: decryptedConfig.key_id,
//           key_secret: decryptedConfig.secret,
//         });
//         const rzOrder = await razorpay.orders.create({
//           amount: amount * 100, // Paise
//           currency: "INR",
//           receipt: `receipt_${orderId}`,
//         });
//         transactionId = rzOrder.id; 
//         responsePayload = {
//           ...responsePayload,
//           key_id: decryptedConfig.key_id,
//           order: rzOrder,
//         };
//         break;

//       // --- PHONEPE ---
//       case "phonepe":
//         const { merchantId, secret, version } = decryptedConfig;
//         const redirectUrl = `https://newapi.earn24.in/api/payment/status/${transactionId}`;

//         const payload = {
//           merchantId: merchantId,
//           merchantTransactionId: transactionId,
//           merchantUserId: `USER${userId}`,
//           amount: amount * 100,
//           redirectUrl: redirectUrl,
//           redirectMode: "POST",
//           paymentInstrument: { type: "PAY_PAGE" },
//         };

//         const base64Payload = Buffer.from(JSON.stringify(payload)).toString("base64");
//         const xVerify = crypto.createHash("sha256").update(base64Payload + "/pg/v1/pay" + secret).digest("hex") + "###" + version;

//         const phonePeRes = await axios.post(
//           "https://api.phonepe.com/apis/hermes/pg/v1/pay",
//           { request: base64Payload },
//           { headers: { "Content-Type": "application/json", "X-VERIFY": xVerify } }
//         );

//         responsePayload = {
//           ...responsePayload,
//           redirectUrl: phonePeRes.data.data.instrumentResponse.redirectInfo.url,
//           transactionId: transactionId,
//         };
//         break;

//       default:
//         return res.status(500).json({ status: false, message: `Gateway '${gatewayName}' not supported.` });
//     }

//     // 4. Save Transaction
//     await db.query(
//       `INSERT INTO payment_transactions (transaction_id, user_id, order_id, amount, gateway, status) 
//        VALUES (?, ?, ?, ?, ?, ?)`,
//       [transactionId, userId, orderId, amount, gatewayName, "PENDING"]
//     );

//     return res.status(200).json({ status: true, ...responsePayload });

//   } catch (err) {
//     console.error("Payment Init Error:", err);
//     return res.status(500).json({ status: false, message: "Payment initiation failed", error: err.message });
//   }
// };









// ------------------------------------ Working-----------------------------------------------------------------------------


// Working without attribute

// exports.createOrder = async (req, res) => {
//   try {
//     const { userId, name, email, mobile, amount, orderId } = req.body;

//     console.log("payment controller create order")

//     // 1. Validation
//     if (!userId || !amount || !orderId) {
//       return res.status(400).json({ status: false, message: "Missing Order Details." });
//     }

//     // 2. Fetch Active Gateway
//     const [rows] = await db.query(
//       "SELECT gateway_name, encrypted_config, encryption_iv FROM payment_gateway_settings WHERE is_active = 1 LIMIT 1"
//     );

//     if (rows.length === 0) {
//       return res.status(503).json({ status: false, message: "No active payment gateway configured." });
//     }

//     const activeGateway = rows[0];
//     const gatewayName = activeGateway.gateway_name.toLowerCase().trim();

//     const decryptedConfig = decryptObject({
//       encryptedData: activeGateway.encrypted_config,
//       iv: activeGateway.encryption_iv,
//     });

//     let responsePayload = {
//         gateway: gatewayName 
//     };
    
//     // Ensure Transaction ID is unique and string
//     let transactionId = `TXN${Date.now()}`;

//     // 3. Generate Gateway Specific Payload
//     switch (gatewayName) {
      
//       // --- PAYU ---
//       case "payu":
//         const { merchantKey, merchantSalt, isSandbox } = decryptedConfig;
//         const productinfo = "Order_Payment";
        
//         // --- FIX 1: Robust First Name Logic ---
//         // Ensure name is never undefined. Split to get just the first name (PayU standard)
//         const rawName = name || "Customer";
//         const firstname = rawName.trim().split(" ")[0]; 

//         // --- FIX 2: Consistent Amount String ---
//         // Ensure amount is a string to avoid float precision issues in hash
//         const amountStr = amount.toString();

//         // PayU Hash sequence: key|txnid|amount|productinfo|firstname|email|...|salt
//         const hashString = `${merchantKey}|${transactionId}|${amountStr}|${productinfo}|${firstname}|${email}|||||||||||${merchantSalt}`;
//         const hash = crypto.createHash("sha512").update(hashString).digest("hex");

//         const baseUrl = process.env.BASE_URL || 'http://localhost:3000'; // Fallback only for local dev

//         responsePayload = {
//           ...responsePayload,
//           payu_url: isSandbox ? "https://test.payu.in/_payment" : "https://secure.payu.in/_payment",
//           params: {
//             key: merchantKey,
//             txnid: transactionId,
//             amount: amountStr, // Send same string as hashed
//             productinfo: productinfo,
//             firstname: firstname, // ✅ Using the safe variable
//             email: email,
//             phone: mobile,
//             hash: hash,
//             // SURL/FURL must be absolute URLs accessible from the internet
//             surl: `${baseUrl}/api/payment/verify-payment`, 
//             furl: `${baseUrl}/api/payment/verify-payment`,
//           },
//         };
//         break;

//       // --- RAZORPAY ---
//       case "razorpay":
//         // Make sure you require Razorpay at the top if using it
//         const Razorpay = require('razorpay'); 
//         const razorpay = new Razorpay({
//           key_id: decryptedConfig.key_id,
//           key_secret: decryptedConfig.secret,
//         });
//         const rzOrder = await razorpay.orders.create({
//           amount: Math.round(amount * 100), // Ensure Integer (Paise)
//           currency: "INR",
//           receipt: `receipt_${orderId}`,
//         });
//         transactionId = rzOrder.id; // Use Razorpay Order ID as txn ID
//         responsePayload = {
//           ...responsePayload,
//           key_id: decryptedConfig.key_id,
//           order: rzOrder,
//         };
//         break;

//       // --- PHONEPE ---
//       case "phonepe":
//         const { merchantId, secret, version } = decryptedConfig;
//         // Ensure this URL is live/public
//         const redirectUrl = `https://newapi.earn24.in/api/payment/status/${transactionId}`;

//         const phonePePayload = {
//           merchantId: merchantId,
//           merchantTransactionId: transactionId,
//           merchantUserId: `USER${userId}`,
//           amount: Math.round(amount * 100), // PhonePe expects Paise (Integer)
//           redirectUrl: redirectUrl,
//           redirectMode: "POST",
//           paymentInstrument: { type: "PAY_PAGE" },
//           mobileNumber: mobile // Good to include for PhonePe
//         };

//         const base64Payload = Buffer.from(JSON.stringify(phonePePayload)).toString("base64");
//         const xVerify = crypto.createHash("sha256").update(base64Payload + "/pg/v1/pay" + secret).digest("hex") + "###" + version;

//         // Determine URL based on Sandbox/Prod (You might store 'isSandbox' in DB for PhonePe too)
//         const phonePeUrl = "https://api.phonepe.com/apis/hermes/pg/v1/pay"; 

//         const phonePeRes = await axios.post(
//           phonePeUrl,
//           { request: base64Payload },
//           { headers: { "Content-Type": "application/json", "X-VERIFY": xVerify } }
//         );

//         if(phonePeRes.data && phonePeRes.data.success) {
//             responsePayload = {
//               ...responsePayload,
//               redirectUrl: phonePeRes.data.data.instrumentResponse.redirectInfo.url,
//               transactionId: transactionId,
//             };
//         } else {
//             throw new Error("PhonePe Init Failed");
//         }
//         break;

//       default:
//         return res.status(500).json({ status: false, message: `Gateway '${gatewayName}' not supported.` });
//     }

//     // 4. Save Transaction
//     await db.query(
//       `INSERT INTO payment_transactions (transaction_id, user_id, order_id, amount, gateway, status) 
//        VALUES (?, ?, ?, ?, ?, ?)`,
//       [transactionId, userId, orderId, amount, gatewayName, "PENDING"]
//     );

//     return res.status(200).json({ status: true, ...responsePayload });

//   } catch (err) {
//     console.error("Payment Init Error:", err);
//     return res.status(500).json({ status: false, message: "Payment initiation failed", error: err.message });
//   }
// };







// // 7. VERIFY PAYMENT (Handles Redirects from PayU / Calls from Razorpay)
// exports.verifyPayment = async (req, res) => {
//   try {
//     // ===========================
//     // === PAYU VERIFICATION ===
//     // ===========================
//     if (req.body.hash && req.body.mihpayid) {
//       const { status, txnid, amount, firstname, email, hash, key, productinfo, mihpayid } = req.body;

//       const [rows] = await db.query("SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE gateway_name = 'payu'");
//       const config = decryptObject({ encryptedData: rows[0].encrypted_config, iv: rows[0].encryption_iv });

//       // Verify Hash
//       const reverseHashString = `${config.merchantSalt}|${status}|||||||||||${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
//       const generatedHash = crypto.createHash("sha512").update(reverseHashString).digest("hex");

//       if (generatedHash === hash && status === "success") {
//         // 1. Update Transaction
//         await db.query('UPDATE payment_transactions SET status = "SUCCESS", gateway_payment_id = ? WHERE transaction_id = ?', [mihpayid, txnid]);
        
//         // 2. Update Order Status
//         const [txn] = await db.query("SELECT order_id FROM payment_transactions WHERE transaction_id = ?", [txnid]);
//         if(txn.length > 0) {
//             await db.query("UPDATE orders SET order_status = 'CONFIRMED', payment_status = 'COMPLETED' WHERE id = ?", [txn[0].order_id]);
//         }

//         return res.send("<h1>Payment Successful</h1><script>setTimeout(function(){ window.location.href='https://newapi.earn24.in/payment-success'; }, 1000);</script>");
//       } else {
//         await db.query('UPDATE payment_transactions SET status = "FAILED" WHERE transaction_id = ?', [txnid]);
//         return res.send("<h1>Payment Failed</h1><script>setTimeout(function(){ window.location.href='https://newapi.earn24.in/payment-failure'; }, 1000);</script>");
//       }
//     }

//     // ===========================
//     // === RAZORPAY VERIFICATION ===
//     // ===========================
//     const { gateway_name, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

//     if (gateway_name === "razorpay") {
//       const [rows] = await db.query("SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE gateway_name = 'razorpay'");
//       const config = decryptObject({ encryptedData: rows[0].encrypted_config, iv: rows[0].encryption_iv });

//       const hmac = crypto.createHmac("sha256", config.secret);
//       hmac.update(razorpay_order_id + "|" + razorpay_payment_id);
//       const generated_signature = hmac.digest("hex");

//       if (generated_signature === razorpay_signature) {
//         await db.query('UPDATE payment_transactions SET status = "SUCCESS", gateway_payment_id = ? WHERE transaction_id = ?', [razorpay_payment_id, razorpay_order_id]);
        
//         const [txn] = await db.query("SELECT order_id FROM payment_transactions WHERE transaction_id = ?", [razorpay_order_id]);
//         if(txn.length > 0) {
//             await db.query("UPDATE orders SET order_status = 'CONFIRMED', payment_status = 'COMPLETED' WHERE id = ?", [txn[0].order_id]);
//         }

//         return res.status(200).json({ status: true, message: "Payment Verified" });
//       } else {
//         return res.status(400).json({ status: false, message: "Invalid Signature" });
//       }
//     }

//   } catch (error) {
//     console.error("Verify Error:", error);
//     res.status(500).json({ status: false, message: "Verification failed" });
//   }
// };

// // 8. CHECK PHONEPE STATUS
// exports.checkPhonePeStatus = async (req, res) => {
//   try {
//     const { transactionId } = req.params;
//     const [rows] = await db.query("SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE gateway_name = 'phonepe'");
//     const config = decryptObject({ encryptedData: rows[0].encrypted_config, iv: rows[0].encryption_iv });

//     const xVerify = crypto.createHash("sha256").update(`/pg/v1/status/${config.merchantId}/${transactionId}` + config.secret).digest("hex") + "###" + config.version;

//     const response = await axios.get(`https://api.phonepe.com/apis/hermes/pg/v1/status/${config.merchantId}/${transactionId}`, {
//         headers: { "Content-Type": "application/json", "X-VERIFY": xVerify, "X-MERCHANT-ID": config.merchantId }
//     });

//     if (response.data.code === "PAYMENT_SUCCESS") {
//         await db.query('UPDATE payment_transactions SET status = "SUCCESS" WHERE transaction_id = ?', [transactionId]);
        
//         const [txn] = await db.query("SELECT order_id FROM payment_transactions WHERE transaction_id = ?", [transactionId]);
//         if(txn.length > 0) {
//             await db.query("UPDATE orders SET order_status = 'CONFIRMED', payment_status = 'COMPLETED' WHERE id = ?", [txn[0].order_id]);
//         }
//         return res.status(200).json({ status: true, message: "Payment Success" });
//     } else {
//         return res.status(400).json({ status: false, message: "Payment Pending or Failed" });
//     }
//   } catch (error) {
//     res.status(500).json({ status: false, message: "Check failed" });
//   }
// };

// // 9. WEBHOOK (For PayU)
// exports.payuWebhook = async (req, res) => {
//   try {
//     const { status, txnid, hash, mihpayid } = req.body;
    
//     // Logic similar to verifyPayment but responding with 200 OK text
//     if (status === "success") {
//        await db.query('UPDATE payment_transactions SET status = "SUCCESS", gateway_payment_id = ? WHERE transaction_id = ?', [mihpayid, txnid]);
//        const [txn] = await db.query("SELECT order_id FROM payment_transactions WHERE transaction_id = ?", [txnid]);
//        if(txn.length > 0) {
//            await db.query("UPDATE orders SET order_status = 'CONFIRMED', payment_status = 'COMPLETED' WHERE id = ?", [txn[0].order_id]);
//        }
//     } else {
//        await db.query('UPDATE payment_transactions SET status = "FAILED" WHERE transaction_id = ?', [txnid]);
//     }
//     return res.status(200).send("OK");
//   } catch (error) {
//     return res.status(200).send("Error");
//   }
// };











// ------------------------------------With Attribut testing--------------------------------------










// /**
//  * 1. INITIATE PAYMENT (createOrder)
//  * Fetches secure amount from DB and generates Gateway specific data
//  */
// exports.createOrder = async (req, res) => {
//     try {
//         const { userId, orderId, name, email, mobile } = req.body;

//         // 1. Fetch Secure Order Details (Anti-Tamper)
//         const [orderRows] = await db.query(
//             "SELECT total_amount, order_number FROM orders WHERE id = ? AND user_id = ?",
//             [orderId, userId]
//         );

//         if (orderRows.length === 0) {
//             return res.status(404).json({ status: false, message: "Order records not found." });
//         }

//         const dbAmount = parseFloat(orderRows[0].total_amount);
//         const orderNo = orderRows[0].order_number;

//         // 2. Fetch Active Payment Gateway
//         const [gwRows] = await db.query(
//             "SELECT gateway_name, encrypted_config, encryption_iv FROM payment_gateway_settings WHERE is_active = 1 LIMIT 1"
//         );

//         if (gwRows.length === 0) {
//             return res.status(503).json({ status: false, message: "Online payment is currently unavailable." });
//         }

//         const activeGateway = gwRows[0];
//         const gatewayName = activeGateway.gateway_name.toLowerCase().trim();
//         const config = decryptObject({
//             encryptedData: activeGateway.encrypted_config,
//             iv: activeGateway.encryption_iv,
//         });

//         let transactionId = `TXN${Date.now()}${userId}`;
//         let responsePayload = { gateway: gatewayName, transactionId, orderId };

//         // 3. Generate Config based on Gateway
//         switch (gatewayName) {
//             case "payu":
//                 const { merchantKey, merchantSalt, isSandbox } = config;
//                 const productinfo = `Payment_${orderNo}`;
//                 const firstname = (name || "Customer").trim().split(" ")[0];
//                 const amountStr = dbAmount.toFixed(2);

//                 const hashString = `${merchantKey}|${transactionId}|${amountStr}|${productinfo}|${firstname}|${email}|||||||||||${merchantSalt}`;
//                 const hash = crypto.createHash("sha512").update(hashString).digest("hex");
//                 const baseUrl = process.env.BASE_URL || 'https://newapi.earn24.in';

//                 responsePayload = {
//                     ...responsePayload,
//                     payu_url: isSandbox ? "https://test.payu.in/_payment" : "https://secure.payu.in/_payment",
//                     params: {
//                         key: merchantKey, txnid: transactionId, amount: amountStr,
//                         productinfo, firstname, email, phone: mobile, hash,
//                         surl: `${baseUrl}/api/payment/verify-payment`,
//                         furl: `${baseUrl}/api/payment/verify-payment`,
//                     },
//                 };
//                 break;

//             case "razorpay":
//                 const Razorpay = require('razorpay');
//                 const rz = new Razorpay({ key_id: config.key_id, key_secret: config.secret });
//                 const rzOrder = await rz.orders.create({
//                     amount: Math.round(dbAmount * 100),
//                     currency: "INR",
//                     receipt: orderNo,
//                 });
//                 transactionId = rzOrder.id;
//                 responsePayload = { ...responsePayload, key_id: config.key_id, order: rzOrder, transactionId };
//                 break;

//             case "phonepe":
//                 const phonePePayload = {
//                     merchantId: config.merchantId,
//                     merchantTransactionId: transactionId,
//                     merchantUserId: `UID${userId}`,
//                     amount: Math.round(dbAmount * 100),
//                     redirectUrl: `https://newapi.earn24.in/api/payment/status/${transactionId}`,
//                     redirectMode: "POST",
//                     paymentInstrument: { type: "PAY_PAGE" },
//                 };
//                 const base64 = Buffer.from(JSON.stringify(phonePePayload)).toString("base64");
//                 const xVerify = crypto.createHash("sha256").update(base64 + "/pg/v1/pay" + config.secret).digest("hex") + "###" + config.version;

//                 responsePayload = {
//                     ...responsePayload,
//                     redirectUrl: "https://api.phonepe.com/apis/hermes/pg/v1/pay",
//                     requestBody: { request: base64 },
//                     xVerify
//                 };
//                 break;

//             default:
//                 return res.status(500).json({ status: false, message: "Gateway error." });
//         }

//         // 4. Log Transaction
//         await db.query(
//             `INSERT INTO payment_transactions (transaction_id, user_id, order_id, amount, gateway, status) VALUES (?, ?, ?, ?, ?, ?)`,
//             [transactionId, userId, orderId, dbAmount, gatewayName, "PENDING"]
//         );

//         return res.status(200).json({ status: true, ...responsePayload });

//     } catch (err) {
//         console.error("Payment Init Error:", err);
//         return res.status(500).json({ status: false, message: "Failed to initiate payment." });
//     }
// };

// /**
//  * 2. VERIFY PAYMENT (verifyPayment)
//  * Handles PayU redirects and Razorpay signature verification
//  */
// exports.verifyPayment = async (req, res) => {
//     const connection = await db.getConnection();
//     try {
//         await connection.beginTransaction();

//         // --- A. PAYU LOGIC ---
//         if (req.body.hash && req.body.mihpayid) {
//             const { status, txnid, amount, firstname, email, hash, key, productinfo, mihpayid } = req.body;
//             const [rows] = await connection.query("SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE gateway_name = 'payu'");
//             const config = decryptObject({ encryptedData: rows[0].encrypted_config, iv: rows[0].encryption_iv });

//             const reverseHash = `${config.merchantSalt}|${status}|||||||||||${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
//             const generatedHash = crypto.createHash("sha512").update(reverseHash).digest("hex");

//             if (generatedHash === hash && status === "success") {
//                 const [txn] = await connection.query("SELECT order_id FROM payment_transactions WHERE transaction_id = ?", [txnid]);
//                 if (txn.length > 0) {
//                     await connection.query('UPDATE payment_transactions SET status = "SUCCESS", gateway_payment_id = ? WHERE transaction_id = ?', [mihpayid, txnid]);
//                     await connection.query("UPDATE orders SET order_status = 'CONFIRMED', payment_status = 'COMPLETED' WHERE id = ?", [txn[0].order_id]);
//                     await processOrderCommissions(connection, txn[0].order_id);
//                     await connection.commit();
//                     return res.send("<h1>Payment Success</h1><script>setTimeout(() => window.location.href='https://newapi.earn24.in/payment-success', 1000);</script>");
//                 }
//             }
//         }

//         // --- B. RAZORPAY LOGIC ---
//         const { gateway_name, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
//         if (gateway_name === "razorpay") {
//             const [rows] = await connection.query("SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE gateway_name = 'razorpay'");
//             const config = decryptObject({ encryptedData: rows[0].encrypted_config, iv: rows[0].encryption_iv });

//             const hmac = crypto.createHmac("sha256", config.secret).update(razorpay_order_id + "|" + razorpay_payment_id).digest("hex");
//             if (hmac === razorpay_signature) {
//                 const [txn] = await connection.query("SELECT order_id FROM payment_transactions WHERE transaction_id = ?", [razorpay_order_id]);
//                 if (txn.length > 0) {
//                     await connection.query('UPDATE payment_transactions SET status = "SUCCESS", gateway_payment_id = ? WHERE transaction_id = ?', [razorpay_payment_id, razorpay_order_id]);
//                     await connection.query("UPDATE orders SET order_status = 'CONFIRMED', payment_status = 'COMPLETED' WHERE id = ?", [txn[0].order_id]);
//                     await processOrderCommissions(connection, txn[0].order_id);
//                     await connection.commit();
//                     return res.status(200).json({ status: true, message: "Verified" });
//                 }
//             }
//         }
        
//         await connection.rollback();
//         return res.status(400).json({ status: false, message: "Verification failed" });
//     } catch (error) {
//         await connection.rollback();
//         res.status(500).json({ status: false, message: "Server error during verification" });
//     } finally { connection.release(); }
// };

// /**
//  * 3. CHECK PHONEPE (checkPhonePeStatus)
//  */
// exports.checkPhonePeStatus = async (req, res) => {
//     const { transactionId } = req.params;
//     const connection = await db.getConnection();
//     try {
//         const [rows] = await connection.query("SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE gateway_name = 'phonepe'");
//         const config = decryptObject({ encryptedData: rows[0].encrypted_config, iv: rows[0].encryption_iv });

//         const xVerify = crypto.createHash("sha256").update(`/pg/v1/status/${config.merchantId}/${transactionId}` + config.secret).digest("hex") + "###" + config.version;
//         const response = await axios.get(`https://api.phonepe.com/apis/hermes/pg/v1/status/${config.merchantId}/${transactionId}`, {
//             headers: { "Content-Type": "application/json", "X-VERIFY": xVerify, "X-MERCHANT-ID": config.merchantId }
//         });

//         if (response.data.code === "PAYMENT_SUCCESS") {
//             await connection.beginTransaction();
//             const [txn] = await connection.query("SELECT order_id FROM payment_transactions WHERE transaction_id = ?", [transactionId]);
//             if (txn.length > 0) {
//                 await connection.query('UPDATE payment_transactions SET status = "SUCCESS" WHERE transaction_id = ?', [transactionId]);
//                 await connection.query("UPDATE orders SET order_status = 'CONFIRMED', payment_status = 'COMPLETED' WHERE id = ?", [txn[0].order_id]);
//                 await processOrderCommissions(connection, txn[0].order_id);
//             }
//             await connection.commit();
//             return res.status(200).json({ status: true, message: "Success" });
//         }
//         return res.status(400).json({ status: false, message: "Payment not completed" });
//     } catch (error) {
//         await connection.rollback();
//         res.status(500).json({ status: false, message: "Check failed" });
//     } finally { connection.release(); }
// };







// /**
//  * 9. PAYU WEBHOOK (Production Robust)
//  * Handles server-to-server notifications from PayU
//  */
// exports.payuWebhook = async (req, res) => {
//     console.log("[Webhook] Received notification from PayU:", req.body.txnid);
    
//     const connection = await db.getConnection();
//     try {
//         const { status, txnid, hash, mihpayid, amount, email, firstname, productinfo, key } = req.body;

//         // 1. Fetch config to verify the authenticity of this webhook
//         const [rows] = await connection.query("SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE gateway_name = 'payu'");
//         const config = decryptObject({ encryptedData: rows[0].encrypted_config, iv: rows[0].encryption_iv });

//         // 2. Security: Verify the Reverse Hash provided by PayU
//         // Format: salt|status|||||||||||email|firstname|productinfo|amount|txnid|key
//         const reverseHashStr = `${config.merchantSalt}|${status}|||||||||||${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
//         const generatedHash = crypto.createHash("sha512").update(reverseHashStr).digest("hex");

//         if (generatedHash !== hash) {
//             console.error("[Webhook Error] Hash mismatch. Possible tampered request.");
//             return res.status(200).send("Hash Mismatch"); // Always send 200 to PayU to stop retries, but log error
//         }

//         // 3. Start Database Transaction
//         await connection.beginTransaction();

//         // 4. Find the internal transaction record
//         const [txn] = await connection.query("SELECT order_id, status FROM payment_transactions WHERE transaction_id = ?", [txnid]);

//         if (!txn[0]) {
//             console.error("[Webhook Error] Transaction ID not found in local DB.");
//             await connection.rollback();
//             return res.status(200).send("Transaction Not Found");
//         }

//         // If transaction is already processed (Success), skip to avoid double commission
//         if (txn[0].status === 'SUCCESS') {
//             await connection.rollback();
//             return res.status(200).send("OK - Already Processed");
//         }

//         if (status === "success") {
//             const orderId = txn[0].order_id;

//             // A. Update Transaction Table
//             await connection.query(
//                 'UPDATE payment_transactions SET status = "SUCCESS", gateway_payment_id = ? WHERE transaction_id = ?', 
//                 [mihpayid, txnid]
//             );

//             // B. Update Order Status
//             await connection.query(
//                 "UPDATE orders SET order_status = 'CONFIRMED', payment_status = 'COMPLETED' WHERE id = ?", 
//                 [orderId]
//             );

//             // C. DISTRIBUTE EARNINGS (MLM Logic)
//             // This calls the helper function defined in your main controller
//             await processOrderCommissions(connection, orderId);

//             console.log(`[Webhook Success] Order ${orderId} processed via Webhook.`);
//             await connection.commit();
//         } else {
//             // Log the failure
//             await connection.query('UPDATE payment_transactions SET status = "FAILED" WHERE transaction_id = ?', [txnid]);
//             console.warn(`[Webhook Warning] Payment failed for transaction: ${txnid}`);
//             await connection.commit();
//         }

//         // PayU expects a simple "OK" or "success" text response
//         return res.status(200).send("OK");

//     } catch (error) {
//         if (connection) await connection.rollback();
//         console.error("[Webhook Critical Error]:", error);
//         // We still send 200 so PayU doesn't spam your server with retries for a logic error
//         return res.status(200).send("Error"); 
//     } finally {
//         if (connection) connection.release();
//     }
// };












// /**
//  * MLM COMMISSION HELPERS
//  */
// async function processOrderCommissions(connection, orderId) {
//     const [orderRows] = await connection.query("SELECT o.user_id, u.sponsor_id FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = ?", [orderId]);
//     const [settingsRows] = await connection.query("SELECT setting_key, setting_value FROM app_settings");
//     const settings = settingsRows.reduce((acc, s) => { acc[s.setting_key] = parseFloat(s.setting_value); return acc; }, {});

//     const [items] = await connection.query(`
//         SELECT oi.id as order_item_id, oi.price_per_unit, oi.quantity, sp.purchase_price, p.gst_percentage
//         FROM order_items oi
//         JOIN seller_products sp ON oi.seller_product_id = sp.id
//         JOIN products p ON sp.product_id = p.id
//         WHERE oi.order_id = ?`, [orderId]);

//     for (const item of items) {
//         const basePrice = item.price_per_unit / (1 + ((item.gst_percentage || 0) / 100));
//         const netProfitOnItem = (basePrice - item.purchase_price) * item.quantity;
//         if (netProfitOnItem > 0) {
//             await distributeEarnings(connection, { userId: orderRows[0].user_id, sponsorId: orderRows[0].sponsor_id, orderItemId: item.order_item_id, netProfit: netProfitOnItem, settings });
//         }
//     }
// }

// async function distributeEarnings(connection, { userId, sponsorId, orderItemId, netProfit, settings }) {
//     const companySharePct = settings.profit_company_share_pct || 20.0;
//     const distributableProfit = netProfit * ((100 - companySharePct) / 100);
    
//     if (settings.profit_dist_cashback_pct > 0) {
//         const amt = distributableProfit * (settings.profit_dist_cashback_pct / 100);
//         await connection.query(`INSERT INTO profit_distribution_ledger (order_item_id, user_id, distribution_type, total_profit_on_item, distributable_amount, percentage_applied, amount_credited) VALUES (?, ?, 'CASHBACK', ?, ?, ?, ?)`, [orderItemId, userId, netProfit, distributableProfit, settings.profit_dist_cashback_pct, amt]);
//         await connection.query('UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?', [amt, userId]);
//     }

//     if (sponsorId && settings.profit_dist_sponsor_pct > 0) {
//         const amt = distributableProfit * (settings.profit_dist_sponsor_pct / 100);
//         await connection.query(`INSERT INTO profit_distribution_ledger (order_item_id, user_id, distribution_type, total_profit_on_item, distributable_amount, percentage_applied, amount_credited) VALUES (?, ?, 'SPONSOR_BONUS', ?, ?, ?, ?)`, [orderItemId, sponsorId, netProfit, distributableProfit, settings.profit_dist_sponsor_pct, amt]);
//         await connection.query('UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?', [amt, sponsorId]);
//     }
// }











// ---------------------testing 2---------------------------------------







/**
 * 1. INITIATE PAYMENT (createOrder)
 * Fetches secure amount from DB and generates Gateway specific data.
 */
exports.createOrder = async (req, res) => {
    try {
        const { userId, orderId, name, email, mobile } = req.body;

        // Fetch actual order details from DB (Anti-Tamper)
        const [orderRows] = await db.query(
            "SELECT total_amount, order_number FROM orders WHERE id = ? AND user_id = ?",
            [orderId, userId]
        );

        if (orderRows.length === 0) {
            return res.status(404).json({ status: false, message: "Order records not found." });
        }

        const dbAmount = parseFloat(orderRows[0].total_amount);
        const orderNo = orderRows[0].order_number;

        // Fetch Active Gateway
        const [gwRows] = await db.query(
            "SELECT gateway_name, encrypted_config, encryption_iv FROM payment_gateway_settings WHERE is_active = 1 LIMIT 1"
        );

        if (gwRows.length === 0) {
            return res.status(503).json({ status: false, message: "Electronic payment is unavailable." });
        }

        const activeGateway = gwRows[0];
        const gatewayName = activeGateway.gateway_name.toLowerCase().trim();
        const config = decryptObject({
            encryptedData: activeGateway.encrypted_config,
            iv: activeGateway.encryption_iv,
        });

        let transactionId = `TXN${Date.now()}${userId}`;
        let responsePayload = { gateway: gatewayName, transactionId, orderId };

        switch (gatewayName) {
            case "payu":
                const { merchantKey, merchantSalt, isSandbox } = config;
                const productinfo = `Payment_${orderNo}`;
                const firstname = (name || "Customer").trim().split(" ")[0];
                const amountStr = dbAmount.toFixed(2);

                const hashString = `${merchantKey}|${transactionId}|${amountStr}|${productinfo}|${firstname}|${email}|||||||||||${merchantSalt}`;
                const hash = crypto.createHash("sha512").update(hashString).digest("hex");
                const baseUrl = process.env.BASE_URL || 'https://newapi.earn24.in';

                responsePayload = {
                    ...responsePayload,
                    payu_url: isSandbox ? "https://test.payu.in/_payment" : "https://secure.payu.in/_payment",
                    params: {
                        key: merchantKey, txnid: transactionId, amount: amountStr,
                        productinfo, firstname, email, phone: mobile, hash,
                        surl: `${baseUrl}/api/payment/verify-payment`,
                        furl: `${baseUrl}/api/payment/verify-payment`,
                    },
                };
                break;

            case "razorpay":
                const Razorpay = require('razorpay');
                const rz = new Razorpay({ key_id: config.key_id, key_secret: config.secret });
                const rzOrder = await rz.orders.create({
                    amount: Math.round(dbAmount * 100),
                    currency: "INR",
                    receipt: orderNo,
                });
                transactionId = rzOrder.id;
                responsePayload = { ...responsePayload, key_id: config.key_id, order: rzOrder, transactionId };
                break;

            case "phonepe":
                const phonePePayload = {
                    merchantId: config.merchantId,
                    merchantTransactionId: transactionId,
                    merchantUserId: `UID${userId}`,
                    amount: Math.round(dbAmount * 100),
                    redirectUrl: `https://newapi.earn24.in/api/payment/status/${transactionId}`,
                    redirectMode: "POST",
                    paymentInstrument: { type: "PAY_PAGE" },
                };
                const base64 = Buffer.from(JSON.stringify(phonePePayload)).toString("base64");
                const xVerify = crypto.createHash("sha256").update(base64 + "/pg/v1/pay" + config.secret).digest("hex") + "###" + config.version;

                responsePayload = {
                    ...responsePayload,
                    redirectUrl: "https://api.phonepe.com/apis/hermes/pg/v1/pay",
                    requestBody: { request: base64 },
                    xVerify
                };
                break;

            default:
                return res.status(500).json({ status: false, message: "Gateway config error." });
        }

        // Log Transaction as PENDING
        await db.query(
            `INSERT INTO payment_transactions (transaction_id, user_id, order_id, amount, gateway, status) VALUES (?, ?, ?, ?, ?, ?)`,
            [transactionId, userId, orderId, dbAmount, gatewayName, "PENDING"]
        );

        return res.status(200).json({ status: true, ...responsePayload });

    } catch (err) {
        console.error("Payment Init Error:", err);
        return res.status(500).json({ status: false, message: "Payment initialization failed." });
    }
};

/**
 * 2. VERIFY PAYMENT (verifyPayment)
 * Handles Front-end success redirects and Signature Verification
 */
exports.verifyPayment = async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // --- A. PAYU VERIFICATION ---
        if (req.body.hash && req.body.mihpayid) {
            const { status, txnid, amount, firstname, email, hash, key, productinfo, mihpayid } = req.body;
            const [rows] = await connection.query("SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE gateway_name = 'payu'");
            const config = decryptObject({ encryptedData: rows[0].encrypted_config, iv: rows[0].encryption_iv });

            const reverseHash = `${config.merchantSalt}|${status}|||||||||||${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
            const generatedHash = crypto.createHash("sha512").update(reverseHash).digest("hex");

            if (generatedHash === hash && status === "success") {
                await finalizePayment(connection, txnid, mihpayid);
                await connection.commit();
                return res.send("<h1>Payment Successful</h1><script>setTimeout(()=>window.location.href='https://newapi.earn24.in/payment-success',1000);</script>");
            }
        }

        // --- B. RAZORPAY VERIFICATION ---
        const { gateway_name, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        if (gateway_name === "razorpay") {
            const [rows] = await connection.query("SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE gateway_name = 'razorpay'");
            const config = decryptObject({ encryptedData: rows[0].encrypted_config, iv: rows[0].encryption_iv });

            const hmac = crypto.createHmac("sha256", config.secret).update(razorpay_order_id + "|" + razorpay_payment_id).digest("hex");
            if (hmac === razorpay_signature) {
                await finalizePayment(connection, razorpay_order_id, razorpay_payment_id);
                await connection.commit();
                return res.status(200).json({ status: true, message: "Payment Verified" });
            }
        }
        
        await connection.rollback();
        return res.status(400).json({ status: false, message: "Verification failed." });
    } catch (error) {
        if (connection) await connection.rollback();
        res.status(500).json({ status: false, message: "Server error during verification." });
    } finally { connection.release(); }
};

/**
 * 3. CHECK PHONEPE STATUS (API Polling)
 */
exports.checkPhonePeStatus = async (req, res) => {
    const { transactionId } = req.params;
    const connection = await db.getConnection();
    try {
        const [rows] = await connection.query("SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE gateway_name = 'phonepe'");
        const config = decryptObject({ encryptedData: rows[0].encrypted_config, iv: rows[0].encryption_iv });

        const xVerify = crypto.createHash("sha256").update(`/pg/v1/status/${config.merchantId}/${transactionId}` + config.secret).digest("hex") + "###" + config.version;
        const response = await axios.get(`https://api.phonepe.com/apis/hermes/pg/v1/status/${config.merchantId}/${transactionId}`, {
            headers: { "Content-Type": "application/json", "X-VERIFY": xVerify, "X-MERCHANT-ID": config.merchantId }
        });

        if (response.data.code === "PAYMENT_SUCCESS") {
            await connection.beginTransaction();
            await finalizePayment(connection, transactionId, null);
            await connection.commit();
            return res.status(200).json({ status: true, message: "Payment Success" });
        }
        return res.status(400).json({ status: false, message: "Payment Pending or Failed" });
    } catch (error) {
        if (connection) await connection.rollback();
        res.status(500).json({ status: false, message: "Verification Check failed" });
    } finally { connection.release(); }
};

/**
 * --- INTERNAL CORE LOGIC ---
 * finalizing payment and distributing commissions in a single transaction
 */

async function finalizePayment(connection, transactionId, gatewayId) {
    // 1. Double-Check status to prevent double-commission bug
    const [txn] = await connection.query("SELECT order_id, status FROM payment_transactions WHERE transaction_id = ? FOR UPDATE", [transactionId]);
    if (!txn[0] || txn[0].status === 'SUCCESS') return;

    // 2. Update Transaction Table
    await connection.query('UPDATE payment_transactions SET status = "SUCCESS", gateway_payment_id = ? WHERE transaction_id = ?', [gatewayId, transactionId]);

    // 3. Update Order Status
    const orderId = txn[0].order_id;
    await connection.query("UPDATE orders SET order_status = 'CONFIRMED', payment_status = 'COMPLETED' WHERE id = ?", [orderId]);

    // 4. Distribute MLM Commissions & Cashback
    await processOrderCommissions(connection, orderId);
}

async function processOrderCommissions(connection, orderId) {
    const [orderRows] = await connection.query("SELECT o.user_id, u.sponsor_id FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = ?", [orderId]);
    const [settingsRows] = await connection.query("SELECT setting_key, setting_value FROM app_settings");
    const settings = settingsRows.reduce((acc, s) => { acc[s.setting_key] = parseFloat(s.setting_value); return acc; }, {});

    // Fetch line items with purchase prices for profit calculation
    const [items] = await connection.query(`
        SELECT oi.id as order_item_id, oi.price_per_unit, oi.quantity, sp.purchase_price, p.gst_percentage
        FROM order_items oi
        JOIN seller_products sp ON oi.seller_product_id = sp.id
        JOIN products p ON sp.product_id = p.id
        WHERE oi.order_id = ?`, [orderId]);

    for (const item of items) {
        const basePrice = item.price_per_unit / (1 + ((item.gst_percentage || 0) / 100));
        const netProfitOnItem = (basePrice - item.purchase_price) * item.quantity;
        
        if (netProfitOnItem > 0) {
            await distributeEarnings(connection, { 
                userId: orderRows[0].user_id, 
                sponsorId: orderRows[0].sponsor_id, 
                orderItemId: item.order_item_id, 
                netProfit: netProfitOnItem, 
                settings 
            });
        }
    }
}

async function distributeEarnings(connection, { userId, sponsorId, orderItemId, netProfit, settings }) {
    const companySharePct = settings.profit_company_share_pct || 20.0;
    const distributableProfit = netProfit * ((100 - companySharePct) / 100);
    
    // 1. Cashback to Buyer
    if (settings.profit_dist_cashback_pct > 0) {
        const amt = distributableProfit * (settings.profit_dist_cashback_pct / 100);
        await connection.query(`INSERT INTO profit_distribution_ledger (order_item_id, user_id, distribution_type, total_profit_on_item, distributable_amount, percentage_applied, amount_credited) VALUES (?, ?, 'CASHBACK', ?, ?, ?, ?)`, [orderItemId, userId, netProfit, distributableProfit, settings.profit_dist_cashback_pct, amt]);
        await connection.query('UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?', [amt, userId]);
    }

    // 2. Bonus to Sponsor
    if (sponsorId && settings.profit_dist_sponsor_pct > 0) {
        const amt = distributableProfit * (settings.profit_dist_sponsor_pct / 100);
        await connection.query(`INSERT INTO profit_distribution_ledger (order_item_id, user_id, distribution_type, total_profit_on_item, distributable_amount, percentage_applied, amount_credited) VALUES (?, ?, 'SPONSOR_BONUS', ?, ?, ?, ?)`, [orderItemId, sponsorId, netProfit, distributableProfit, settings.profit_dist_sponsor_pct, amt]);
        await connection.query('UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?', [amt, sponsorId]);
    }
}