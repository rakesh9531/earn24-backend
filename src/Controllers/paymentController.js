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






// 6. CREATE ORDER & INITIATE PAYMENT
exports.createOrder = async (req, res) => {
  try {
    const { userId, name, email, mobile, amount, orderId } = req.body;

    // 1. Validation
    if (!userId || !amount || !orderId) {
      return res.status(400).json({ status: false, message: "Missing Order Details." });
    }

    // 2. Fetch Active Gateway
    const [rows] = await db.query(
      "SELECT gateway_name, encrypted_config, encryption_iv FROM payment_gateway_settings WHERE is_active = 1 LIMIT 1"
    );

    if (rows.length === 0) {
      return res.status(503).json({ status: false, message: "No active payment gateway configured." });
    }

    const activeGateway = rows[0];
    // Normalize name to lowercase and trim spaces to prevent matching errors
    const gatewayName = activeGateway.gateway_name.toLowerCase().trim();

    const decryptedConfig = decryptObject({
      encryptedData: activeGateway.encrypted_config,
      iv: activeGateway.encryption_iv,
    });

    let responsePayload = {
        // ✅ SAFETY: Ensure gateway is always in the response, regardless of switch case
        gateway: gatewayName 
    };
    
    let transactionId = `TXN${Date.now()}`;

    // 3. Generate Gateway Specific Payload
    switch (gatewayName) {
      
      // --- PAYU ---
      case "payu":
        const { merchantKey, merchantSalt, isSandbox } = decryptedConfig;
        const productinfo = "Order_Payment";
        
        // PayU Hash sequence
        const hashString = `${merchantKey}|${transactionId}|${amount}|${productinfo}|${name}|${email}|||||||||||${merchantSalt}`;
        const hash = crypto.createHash("sha512").update(hashString).digest("hex");

        responsePayload = {
          ...responsePayload, // Keep the gateway key
          payu_url: isSandbox ? "https://test.payu.in/_payment" : "https://secure.payu.in/_payment",
          params: {
            key: merchantKey,
            txnid: transactionId,
            amount: amount,
            productinfo: productinfo,
            firstname: name,
            email: email,
            phone: mobile,
            hash: hash,
            // Ensure these URLs point to your LIVE server or Tunneled URL (ngrok) for testing
            surl: `${process.env.BASE_URL || 'http://localhost:3000'}/api/payment/verify-payment`, 
            furl: `${process.env.BASE_URL || 'http://localhost:3000'}/api/payment/verify-payment`,
          },
        };
        break;

      // --- RAZORPAY ---
      case "razorpay":
        const razorpay = new Razorpay({
          key_id: decryptedConfig.key_id,
          key_secret: decryptedConfig.secret,
        });
        const rzOrder = await razorpay.orders.create({
          amount: amount * 100, // Paise
          currency: "INR",
          receipt: `receipt_${orderId}`,
        });
        transactionId = rzOrder.id; 
        responsePayload = {
          ...responsePayload,
          key_id: decryptedConfig.key_id,
          order: rzOrder,
        };
        break;

      // --- PHONEPE ---
      case "phonepe":
        const { merchantId, secret, version } = decryptedConfig;
        const redirectUrl = `https://newapi.earn24.in/api/payment/status/${transactionId}`;

        const payload = {
          merchantId: merchantId,
          merchantTransactionId: transactionId,
          merchantUserId: `USER${userId}`,
          amount: amount * 100,
          redirectUrl: redirectUrl,
          redirectMode: "POST",
          paymentInstrument: { type: "PAY_PAGE" },
        };

        const base64Payload = Buffer.from(JSON.stringify(payload)).toString("base64");
        const xVerify = crypto.createHash("sha256").update(base64Payload + "/pg/v1/pay" + secret).digest("hex") + "###" + version;

        const phonePeRes = await axios.post(
          "https://api.phonepe.com/apis/hermes/pg/v1/pay",
          { request: base64Payload },
          { headers: { "Content-Type": "application/json", "X-VERIFY": xVerify } }
        );

        responsePayload = {
          ...responsePayload,
          redirectUrl: phonePeRes.data.data.instrumentResponse.redirectInfo.url,
          transactionId: transactionId,
        };
        break;

      default:
        return res.status(500).json({ status: false, message: `Gateway '${gatewayName}' not supported.` });
    }

    // 4. Save Transaction
    await db.query(
      `INSERT INTO payment_transactions (transaction_id, user_id, order_id, amount, gateway, status) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [transactionId, userId, orderId, amount, gatewayName, "PENDING"]
    );

    return res.status(200).json({ status: true, ...responsePayload });

  } catch (err) {
    console.error("Payment Init Error:", err);
    return res.status(500).json({ status: false, message: "Payment initiation failed", error: err.message });
  }
};








// 7. VERIFY PAYMENT (Handles Redirects from PayU / Calls from Razorpay)
exports.verifyPayment = async (req, res) => {
  try {
    // ===========================
    // === PAYU VERIFICATION ===
    // ===========================
    if (req.body.hash && req.body.mihpayid) {
      const { status, txnid, amount, firstname, email, hash, key, productinfo, mihpayid } = req.body;

      const [rows] = await db.query("SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE gateway_name = 'payu'");
      const config = decryptObject({ encryptedData: rows[0].encrypted_config, iv: rows[0].encryption_iv });

      // Verify Hash
      const reverseHashString = `${config.merchantSalt}|${status}|||||||||||${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
      const generatedHash = crypto.createHash("sha512").update(reverseHashString).digest("hex");

      if (generatedHash === hash && status === "success") {
        // 1. Update Transaction
        await db.query('UPDATE payment_transactions SET status = "SUCCESS", gateway_payment_id = ? WHERE transaction_id = ?', [mihpayid, txnid]);
        
        // 2. Update Order Status
        const [txn] = await db.query("SELECT order_id FROM payment_transactions WHERE transaction_id = ?", [txnid]);
        if(txn.length > 0) {
            await db.query("UPDATE orders SET order_status = 'CONFIRMED', payment_status = 'COMPLETED' WHERE id = ?", [txn[0].order_id]);
        }

        return res.send("<h1>Payment Successful</h1><script>setTimeout(function(){ window.location.href='https://newapi.earn24.in/payment-success'; }, 1000);</script>");
      } else {
        await db.query('UPDATE payment_transactions SET status = "FAILED" WHERE transaction_id = ?', [txnid]);
        return res.send("<h1>Payment Failed</h1><script>setTimeout(function(){ window.location.href='https://newapi.earn24.in/payment-failure'; }, 1000);</script>");
      }
    }

    // ===========================
    // === RAZORPAY VERIFICATION ===
    // ===========================
    const { gateway_name, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (gateway_name === "razorpay") {
      const [rows] = await db.query("SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE gateway_name = 'razorpay'");
      const config = decryptObject({ encryptedData: rows[0].encrypted_config, iv: rows[0].encryption_iv });

      const hmac = crypto.createHmac("sha256", config.secret);
      hmac.update(razorpay_order_id + "|" + razorpay_payment_id);
      const generated_signature = hmac.digest("hex");

      if (generated_signature === razorpay_signature) {
        await db.query('UPDATE payment_transactions SET status = "SUCCESS", gateway_payment_id = ? WHERE transaction_id = ?', [razorpay_payment_id, razorpay_order_id]);
        
        const [txn] = await db.query("SELECT order_id FROM payment_transactions WHERE transaction_id = ?", [razorpay_order_id]);
        if(txn.length > 0) {
            await db.query("UPDATE orders SET order_status = 'CONFIRMED', payment_status = 'COMPLETED' WHERE id = ?", [txn[0].order_id]);
        }

        return res.status(200).json({ status: true, message: "Payment Verified" });
      } else {
        return res.status(400).json({ status: false, message: "Invalid Signature" });
      }
    }

  } catch (error) {
    console.error("Verify Error:", error);
    res.status(500).json({ status: false, message: "Verification failed" });
  }
};

// 8. CHECK PHONEPE STATUS
exports.checkPhonePeStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const [rows] = await db.query("SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE gateway_name = 'phonepe'");
    const config = decryptObject({ encryptedData: rows[0].encrypted_config, iv: rows[0].encryption_iv });

    const xVerify = crypto.createHash("sha256").update(`/pg/v1/status/${config.merchantId}/${transactionId}` + config.secret).digest("hex") + "###" + config.version;

    const response = await axios.get(`https://api.phonepe.com/apis/hermes/pg/v1/status/${config.merchantId}/${transactionId}`, {
        headers: { "Content-Type": "application/json", "X-VERIFY": xVerify, "X-MERCHANT-ID": config.merchantId }
    });

    if (response.data.code === "PAYMENT_SUCCESS") {
        await db.query('UPDATE payment_transactions SET status = "SUCCESS" WHERE transaction_id = ?', [transactionId]);
        
        const [txn] = await db.query("SELECT order_id FROM payment_transactions WHERE transaction_id = ?", [transactionId]);
        if(txn.length > 0) {
            await db.query("UPDATE orders SET order_status = 'CONFIRMED', payment_status = 'COMPLETED' WHERE id = ?", [txn[0].order_id]);
        }
        return res.status(200).json({ status: true, message: "Payment Success" });
    } else {
        return res.status(400).json({ status: false, message: "Payment Pending or Failed" });
    }
  } catch (error) {
    res.status(500).json({ status: false, message: "Check failed" });
  }
};

// 9. WEBHOOK (For PayU)
exports.payuWebhook = async (req, res) => {
  try {
    const { status, txnid, hash, mihpayid } = req.body;
    
    // Logic similar to verifyPayment but responding with 200 OK text
    if (status === "success") {
       await db.query('UPDATE payment_transactions SET status = "SUCCESS", gateway_payment_id = ? WHERE transaction_id = ?', [mihpayid, txnid]);
       const [txn] = await db.query("SELECT order_id FROM payment_transactions WHERE transaction_id = ?", [txnid]);
       if(txn.length > 0) {
           await db.query("UPDATE orders SET order_status = 'CONFIRMED', payment_status = 'COMPLETED' WHERE id = ?", [txn[0].order_id]);
       }
    } else {
       await db.query('UPDATE payment_transactions SET status = "FAILED" WHERE transaction_id = ?', [txnid]);
    }
    return res.status(200).send("OK");
  } catch (error) {
    return res.status(200).send("Error");
  }
};