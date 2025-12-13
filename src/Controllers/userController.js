const db = require('../../db'); // Assuming you have a database connection module
const User = require('../Models/userModel'); // Import the Admin model
const bcrypt = require('bcrypt'); // For hashing passwords
const jwt = require('jsonwebtoken');
const moment = require('moment');
const { registerUserValidator, loginUserValidator } = require('../Validator/userValidation');
const { sendSms } = require('../utils/smsHelper');

require('dotenv').config();



// exports.registerUser = async (req, res) => {
//   try {
//     const { error } = registerUserValidator(req.body);
//     if (error) {
//       return res.status(400).json({ status: false, message: 'Validation failed', errors: error.details.map(err => err.message) });
//     }

//     const {
//       full_name,
//       username,
//       password,
//       email,
//       mobile_number, // <-- ADDED
//       referral_code,
//       default_sponsor,
//       device_token,
//     } = req.body;

//     // Check if username, email, OR mobile number already exists
//     const [existing] = await db.query(
//       'SELECT * FROM users WHERE username = ? OR email = ? OR mobile_number = ? LIMIT 1',
//       [username, email, mobile_number]
//     );
//     if (existing.length > 0) {
//       return res.status(409).json({ status: false, message: 'Username, email, or mobile number already exists' });
//     }

//     // ===============================================
//     //           NEW MLM LOGIC STARTS HERE
//     // ===============================================
//     let sponsorId = null;

//     if (referral_code) {
//       // Scenario: A referral code was provided. Find the sponsor.
//       // We assume the referral code is the sponsor's username.
//       const [sponsor] = await db.query('SELECT id FROM users WHERE username = ?', [referral_code]);

//       if (sponsor.length === 0) {
//         // The provided referral code is invalid. Stop the registration.
//         return res.status(400).json({ status: false, message: 'Invalid referral code provided.' });
//       }
//       sponsorId = sponsor[0].id;

//     } else {
//       // Scenario: No referral code. Find the last user in the chain.
//       const [lastUser] = await db.query('SELECT id FROM users ORDER BY id DESC LIMIT 1');

//       if (lastUser.length > 0) {
//         // If a user exists, they become the sponsor.
//         sponsorId = lastUser[0].id;
//       }
//       // If no users exist (this is the first user), sponsorId will correctly remain null.
//     }
//     // ===============================================
//     //            NEW MLM LOGIC ENDS HERE
//     // ===============================================

//     const hashedPassword = await bcrypt.hash(password, 10);
//     const createdAt = moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');
//     const updatedAt = createdAt;

//     const [result] = await db.query(
//       `INSERT INTO users (full_name, username, password, email, mobile_number, referral_code, default_sponsor, sponsor_id, device_token, is_online, is_deleted, created_at, updated_at)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`, // Added mobile_number and sponsor_id
//       [
//         full_name,
//         username,
//         hashedPassword,
//         email,
//         mobile_number, // <-- ADDED
//         referral_code || null,
//         default_sponsor,
//         sponsorId, // <-- ADDED
//         device_token || null,
//         1, // is_online
//         createdAt,
//         updatedAt
//       ]
//     );

//     const userId = result.insertId;
//     await db.query('INSERT INTO user_wallets (user_id) VALUES (?)', [userId]);

//     const token = jwt.sign({ id: userId, username }, process.env.JWT_SECRET, { expiresIn: '30d' });

//     res.status(201).json({
//       status: true,
//       message: 'User registered successfully',
//       data: {
//         id: userId,
//         full_name,
//         username,
//         email,
//         mobile_number, // <-- ADDED
//         referral_code,
//         sponsor_id: sponsorId, // <-- ADDED for clarity
//         token
//       }
//     });

//   } catch (err) {
//     console.error('Registration error:', err);
//     res.status(500).json({ status: false, message: 'Server error' });
//   }
// };



// New With OTP 


// --- HELPER: OTP GENERATION & RATE LIMITING LOGIC ---
// This function handles the "5 OTPs per day" and "Block" logic
const handleOtpSending = async (mobile_number) => {
    const currentTime = moment().tz("Asia/Kolkata");
    const [rows] = await db.query('SELECT * FROM otp_records WHERE mobile_number = ?', [mobile_number]);
    let record = rows[0];

    // 1. Check Block Status
    if (record && record.is_blocked) {
        const blockedUntil = moment(record.blocked_until);
        if (currentTime.isBefore(blockedUntil)) {
            return { success: false, status: 429, message: `Too many attempts. Blocked until ${blockedUntil.format('hh:mm A')}` };
        }
        // Unblock if time passed
        await db.query('UPDATE otp_records SET is_blocked = 0, attempts_count = 0 WHERE mobile_number = ?', [mobile_number]);
        record.attempts_count = 0;
    }

    // 2. Check Daily Limit (Reset if next day)
    if (record) {
        const lastSent = moment(record.last_sent_at);
        if (!currentTime.isSame(lastSent, 'day')) {
            await db.query('UPDATE otp_records SET attempts_count = 0 WHERE mobile_number = ?', [mobile_number]);
            record.attempts_count = 0;
        }

        if (record.attempts_count >= 5) {
            const blockTime = moment().tz("Asia/Kolkata").add(24, 'hours').format('YYYY-MM-DD HH:mm:ss');
            await db.query('UPDATE otp_records SET is_blocked = 1, blocked_until = ? WHERE mobile_number = ?', [blockTime, mobile_number]);
            return { success: false, status: 429, message: "Daily limit exceeded. Blocked for 24 hours." };
        }
    }

    // 3. Generate & Send
    const otp = "123456";
    // const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const smsSent = await sendSms(mobile_number, otp);

    if (!smsSent) return { success: false, status: 500, message: "SMS provider failed." };

    // 4. Update DB
    if (record) {
        await db.query('UPDATE otp_records SET otp_code = ?, attempts_count = attempts_count + 1, last_sent_at = NOW() WHERE mobile_number = ?', [otp, mobile_number]);
    } else {
        await db.query('INSERT INTO otp_records (mobile_number, otp_code, attempts_count, last_sent_at) VALUES (?, ?, 1, NOW())', [mobile_number, otp]);
    }

    return { success: true };
};

// =========================================================
// 1. REGISTER INITIATE (Step 1: Form Submit -> Send OTP)
// =========================================================
exports.registerInitiate = async (req, res) => {
    try {
        // 1. Validate Input
        const { error } = registerUserValidator(req.body);
        if (error) return res.status(400).json({ status: false, message: error.details[0].message });

        const { full_name, username, password, email, mobile_number, referral_code, device_token } = req.body;

        // 2. Check if user exists in MAIN table
        const [existing] = await db.query(
            'SELECT id FROM users WHERE username = ? OR email = ? OR mobile_number = ?', 
            [username, email, mobile_number]
        );
        if (existing.length > 0) {
            return res.status(409).json({ status: false, message: 'Username, Email or Mobile already exists.' });
        }

        // 3. MLM Sponsor Logic Check (Validate logic before saving to temp)
        let sponsorId = null;
        let userType = 'CUSTOMER';
        if (referral_code && referral_code.trim() !== '') {
            const [sponsor] = await db.query('SELECT id FROM users WHERE referral_code = ?', [referral_code.trim()]);
            if (sponsor.length === 0) return res.status(400).json({ status: false, message: 'Invalid referral code.' });
            sponsorId = sponsor[0].id;
            userType = 'AFFILIATE';
        }

        // 4. Send OTP (using helper)
        const otpResult = await handleOtpSending(mobile_number);
        if (!otpResult.success) return res.status(otpResult.status).json({ status: false, message: otpResult.message });

        // 5. Hash Password NOW
        const hashedPassword = await bcrypt.hash(password, 10);

        // 6. Save data to TEMP table (expires in 15 mins)
        const userData = JSON.stringify({
            full_name, username, password: hashedPassword, email, mobile_number, 
            referral_code, sponsorId, userType, device_token
        });
        
        const expiry = moment().tz("Asia/Kolkata").add(15, 'minutes').format('YYYY-MM-DD HH:mm:ss');

        // Upsert: If user tried registering before but didn't verify, update the record
        await db.query(`
            INSERT INTO temp_registrations (mobile_number, user_data, expires_at) 
            VALUES (?, ?, ?) 
            ON DUPLICATE KEY UPDATE user_data = VALUES(user_data), expires_at = VALUES(expires_at)
        `, [mobile_number, userData, expiry]);

        res.status(200).json({ status: true, message: `OTP sent to ${mobile_number}. Please verify.` });

    } catch (err) {
        console.error(err);
        res.status(500).json({ status: false, message: 'Server error' });
    }
};

// =========================================================
// 2. VERIFY REGISTRATION OTP (Step 2: OTP -> Create User)
// =========================================================
exports.verifyRegistrationOtp = async (req, res) => {
    try {
        const { mobile_number, otp } = req.body;

        // 1. Check OTP
        const [otpRows] = await db.query('SELECT * FROM otp_records WHERE mobile_number = ?', [mobile_number]);
        if (otpRows.length === 0 || otpRows[0].otp_code !== otp) {
            return res.status(400).json({ status: false, message: "Invalid OTP." });
        }

        // 2. Retrieve Temp Data
        const [tempRows] = await db.query('SELECT * FROM temp_registrations WHERE mobile_number = ?', [mobile_number]);
        if (tempRows.length === 0) {
            return res.status(400).json({ status: false, message: "Registration session expired. Please register again." });
        }

        // Check expiry
        if (moment().isAfter(moment(tempRows[0].expires_at))) {
            return res.status(400).json({ status: false, message: "OTP session expired." });
        }

        const userData = tempRows[0].user_data; // JSON automatically parsed by mysql2 usually, if not use JSON.parse

        // 3. START TRANSACTION (Move from Temp to Main)
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            const newUserReferralCode = userData.username;
            const now = moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

            // Insert into Users
            const [result] = await connection.query(
                `INSERT INTO users (full_name, username, password, email, mobile_number, referral_code, sponsor_id, user_type, device_token, is_active, created_at, updated_at) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
                [userData.full_name, userData.username, userData.password, userData.email, userData.mobile_number, newUserReferralCode, userData.sponsorId, userData.userType, userData.device_token, now, now]
            );

            const userId = result.insertId;
            await connection.query('INSERT INTO user_wallets (user_id) VALUES (?)', [userId]);

            // Cleanup
            await connection.query('DELETE FROM temp_registrations WHERE mobile_number = ?', [mobile_number]);
            await connection.query('UPDATE otp_records SET otp_code = NULL WHERE mobile_number = ?', [mobile_number]); // Invalidate OTP

            await connection.commit();

            // 4. Generate Token (Auto Login)
            const token = jwt.sign({ id: userId, username: userData.username }, process.env.JWT_SECRET, { expiresIn: '30d' });

            const [userRow] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);

            res.status(201).json({ 
                status: true, 
                message: "Registration Successful!", 
                data: { user: userRow[0], token } 
            });

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ status: false, message: 'Server error during verification.' });
    }
};

// =========================================================
// 3. RESEND OTP
// =========================================================
exports.resendOtp = async (req, res) => {
    try {
        const { mobile_number } = req.body;
        // Check if a registration or recovery session exists
        const [temp] = await db.query('SELECT mobile_number FROM temp_registrations WHERE mobile_number = ? UNION SELECT mobile_number FROM users WHERE mobile_number = ?', [mobile_number, mobile_number]);
        
        if (temp.length === 0) return res.status(404).json({ status: false, message: "No active session found for this number." });

        const otpResult = await handleOtpSending(mobile_number);
        if (!otpResult.success) return res.status(otpResult.status).json({ status: false, message: otpResult.message });

        res.status(200).json({ status: true, message: "OTP resent successfully." });

    } catch (error) {
        res.status(500).json({ status: false, message: 'Server error' });
    }
};

// =========================================================
// 4. LOGIN (No OTP needed)
// =========================================================
exports.loginUser = async (req, res) => {
    try {
        const { identifier, password } = req.body; // identifier can be email, mobile, or username

        // Allow login via Email OR Mobile OR Username
        const [users] = await db.query(
            'SELECT * FROM users WHERE email = ? OR mobile_number = ? OR username = ?', 
            [identifier, identifier, identifier]
        );

        if (users.length === 0) {
            return res.status(404).json({ status: false, message: "User not found." });
        }

        const user = users[0];

        if (!user.is_active) return res.status(403).json({ status: false, message: "Account is inactive." });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ status: false, message: "Invalid credentials." });
        }

        const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '30d' });

        res.status(200).json({
            status: true,
            message: "Login successful",
            data: { user, token }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ status: false, message: 'Server error' });
    }
};

// =========================================================
// 5. FORGOT PASSWORD FLOW
// =========================================================
exports.forgotPasswordInitiate = async (req, res) => {
    try {
        const { mobile_number } = req.body;
        const [user] = await db.query('SELECT id FROM users WHERE mobile_number = ?', [mobile_number]);
        
        if (user.length === 0) return res.status(404).json({ status: false, message: "User not found." });

        const otpResult = await handleOtpSending(mobile_number);
        if (!otpResult.success) return res.status(otpResult.status).json({ status: false, message: otpResult.message });

        res.status(200).json({ status: true, message: "OTP sent for password reset." });
    } catch (err) { res.status(500).json({ status: false, message: 'Server error' }); }
};

exports.resetPasswordVerify = async (req, res) => {
    try {
        const { mobile_number, otp, new_password } = req.body;

        // Verify OTP
        const [otpRows] = await db.query('SELECT * FROM otp_records WHERE mobile_number = ?', [mobile_number]);
        if (otpRows.length === 0 || otpRows[0].otp_code !== otp) {
            return res.status(400).json({ status: false, message: "Invalid OTP." });
        }

        const hashedPassword = await bcrypt.hash(new_password, 10);
        await db.query('UPDATE users SET password = ? WHERE mobile_number = ?', [hashedPassword, mobile_number]);
        
        // Clear OTP
        await db.query('UPDATE otp_records SET otp_code = NULL WHERE mobile_number = ?', [mobile_number]);

        res.status(200).json({ status: true, message: "Password updated successfully. Please login." });

    } catch (err) { res.status(500).json({ status: false, message: 'Server error' }); }
};




// MLM Logic For Resigter controller belwo
// exports.registerUser = async (req, res) => {
//   try {
//     const { error } = registerUserValidator(req.body);
//     if (error) {
//       return res.status(400).json({ status: false, message: 'Validation failed', errors: error.details.map(err => err.message) });
//     }

//     const {
//       full_name,
//       username,
//       password,
//       email,
//       mobile_number,
//       referral_code, // This is the SPONSOR's referral code
//       device_token,
//     } = req.body;

//     const [existing] = await db.query(
//       'SELECT * FROM users WHERE username = ? OR email = ? OR mobile_number = ? LIMIT 1',
//       [username, email, mobile_number]
//     );
//     if (existing.length > 0) {
//       return res.status(409).json({ status: false, message: 'Username, email, or mobile number already exists' });
//     }

//     // ===============================================
//     //           YOUR FINAL, CORRECTED LOGIC
//     // ===============================================
//     let sponsorId = null;
//     let userType = 'CUSTOMER'; // Default to Customer

//     if (referral_code && referral_code.trim() !== '') {
//       // A referral code was provided. This user intends to be an Affiliate.
//       const [sponsor] = await db.query('SELECT id FROM users WHERE referral_code = ?', [referral_code.trim()]);

//       if (sponsor.length === 0) {
//         // The provided code is invalid. Stop the registration.
//         return res.status(400).json({ status: false, message: 'Invalid referral code provided.' });
//       }
//       sponsorId = sponsor[0].id;
//       userType = 'AFFILIATE'; // Upgrade the user to an Affiliate.

//     }
//     // If no referral_code is provided, sponsorId remains NULL and userType remains 'CUSTOMER'.
//     // This is the correct behavior for a direct customer.
//     // ===============================================
//     //            END OF CORRECTED LOGIC
//     // ===============================================

//     const hashedPassword = await bcrypt.hash(password, 10);
//     // The new user's own username becomes their personal referral code.
//     const newUserReferralCode = username;
//     const createdAt = moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

//     const [result] = await db.query(
//       `INSERT INTO users (
//          full_name, username, password, email, mobile_number, 
//          referral_code, sponsor_id, user_type, device_token, 
//          is_online, is_active, is_deleted, created_at, updated_at
//        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
//       [
//         full_name,
//         username,
//         hashedPassword,
//         email,
//         mobile_number,
//         newUserReferralCode,
//         sponsorId,           // Will be NULL for Customers, or an ID for Affiliates
//         userType,            // Will be 'CUSTOMER' or 'AFFILIATE'
//         device_token || null,
//         1, // is_online
//         createdAt,
//         createdAt
//       ]
//     );

//     const userId = result.insertId;
//     await db.query('INSERT INTO user_wallets (user_id) VALUES (?)', [userId]);

//     const token = jwt.sign({ id: userId, username }, process.env.JWT_SECRET, { expiresIn: '30d' });
    
//     // Fetch the newly created user to return all details
//     const [newUserRows] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
//     const newUserInfo = newUserRows[0];

//     res.status(201).json({
//       status: true,
//       message: 'User registered successfully',
//       data: {
//         user: newUserInfo,
//         token
//       }
//     });

//   } catch (err) {
//     console.error('Registration error:', err);
//     res.status(500).json({ status: false, message: 'Server error' });
//   }
// }; 


// exports.userLogin = async (req, res) => {
//   try {
//     // Validator is fine, no changes needed
//     const { error } = loginUserValidator(req.body);
//     if (error) {
//       return res.status(400).json({
//         status: false,
//         message: 'Validation failed',
//         errors: error.details.map(err => err.message)
//       });
//     }

//     const { login, password } = req.body;

//     // --- THIS IS THE FIX ---
//     // The query now checks the 'login' input against three possible columns.
//     const [users] = await db.query(
//       'SELECT * FROM users WHERE username = ? OR email = ? OR mobile_number = ? LIMIT 1',
//       [login, login, login] // Pass the same input for all three checks
//     );

//     if (users.length === 0) {
//       return res.status(404).json({ status: false, message: 'User not found' });
//     }

//     const user = users[0];

//     // Compare password
//     const isMatch = await bcrypt.compare(password, user.password);
//     if (!isMatch) {
//       return res.status(401).json({ status: false, message: 'Invalid credentials' }); // More generic error
//     }

//     // Generate JWT Token
//     const token = jwt.sign(
//       { id: user.id, username: user.username },
//       process.env.JWT_SECRET,
//       { expiresIn: '30d' }
//     );

//     res.status(200).json({
//       status: true,
//       message: 'Login successful',
//       token, // Send the token for the app to store
//       data: {
//         id: user.id,
//         full_name: user.full_name,
//         username: user.username,
//         email: user.email,
//       }
//     });

//   } catch (err) {
//     console.error('Login error:', err);
//     res.status(500).json({ status: false, message: 'Server error' });
//   }
// };


// // --- Main Dashboard Summary ---
// exports.getDashboardSummary = async (req, res) => {
//     // const userId = req.user.id; // Get user ID from auth middleware
//     const userId = 1

//     try {
//         // Fetch wallet balance from the users table
//         const [userRows] = await db.query("SELECT wallet_balance FROM users WHERE id = ?", [userId]);

//         // Fetch total BV earned by summing up from the ledger
//         const [bvRows] = await db.query("SELECT SUM(bv_earned) as total_bv FROM user_business_volume WHERE user_id = ?", [userId]);

//         // Fetch the count of direct referrals (Level 1)
//         const [downlineRows] = await db.query("SELECT COUNT(id) as downline_count FROM users WHERE sponsor_id = ?", [userId]);

//         res.status(200).json({
//             status: true,
//             data: {
//                 walletBalance: userRows[0]?.wallet_balance || 0,
//                 totalBv: bvRows[0]?.total_bv || 0,
//                 directReferrals: downlineRows[0]?.downline_count || 0
//             }
//         });
//     } catch (error) {
//         console.error("Error fetching user summary:", error);
//         res.status(500).json({ status: false, message: "An error occurred." });
//     }
// };

// // --- Transaction Histories (Paginated) ---
// exports.getProfitHistory = async (req, res) => {
//     const userId = req.user.id;
//     const page = parseInt(req.query.page, 10) || 1;
//     const limit = parseInt(req.query.limit, 10) || 10;
//     const offset = (page - 1) * limit;

//     try {
//         const dataQuery = `SELECT * FROM profit_distribution_ledger WHERE user_id = ? ORDER BY transaction_date DESC LIMIT ? OFFSET ?`;
//         const [rows] = await db.query(dataQuery, [userId, limit, offset]);

//         const countQuery = `SELECT COUNT(*) as total FROM profit_distribution_ledger WHERE user_id = ?`;
//         const [countRows] = await db.query(countQuery, [userId]);
//         const totalRecords = countRows[0].total;

//         res.status(200).json({
//             status: true, data: rows, pagination: { /* ... pagination object ... */ }
//         });
//     } catch (error) {
//         console.error("Error fetching profit history:", error);
//         res.status(500).json({ status: false, message: "An error occurred." });
//     }
// };

// exports.getBvHistory = async (req, res) => {
//     const userId = req.user.id;
//     // ... similar logic to getProfitHistory, but querying `user_business_volume` table ...
// };

// // --- Downline View ---
// exports.getDownline = async (req, res) => {
//     const userId = req.user.id;
//     try {
//         // Fetches key details about the user's direct referrals
//         const query = `SELECT id, full_name, email, created_at as join_date FROM users WHERE sponsor_id = ? ORDER BY created_at DESC`;
//         const [downline] = await db.query(query, [userId]);
//         res.status(200).json({ status: true, data: downline });
//     } catch (error) {
//         console.error("Error fetching downline:", error);
//         res.status(500).json({ status: false, message: "An error occurred." });
//     }
// };




/**
 * Gets the profile of the currently authenticated user, including their default address.
 */
exports.getUserProfile = async (req, res) => {
    try {
        // Your authentication middleware must set `req.user.id`.
        const userId = req.user.id; 
        // const userId = 1; 


        const query = `
            SELECT 
                u.id, u.full_name, u.email, u.mobile_number,
                ua.pincode, ua.address_line_1, ua.city, ua.state
            FROM users u
            LEFT JOIN user_addresses ua ON u.id = ua.user_id AND ua.is_default = TRUE
            WHERE u.id = ?
        `;
        
        const [rows] = await db.query(query, [userId]);

        if (rows.length === 0) {
            return res.status(404).json({ status: false, message: "User not found." });
        }
        
        const user = rows[0];
        const userData = {
            id: user.id,
            fullName: user.full_name,
            email: user.email,
            mobileNumber: user.mobile_number,
            defaultAddress: user.pincode ? { // Only create address object if a default exists
                pincode: user.pincode,
                addressLine1: user.address_line_1,
                city: user.city,
                state: user.state
            } : null
        };

        res.status(200).json({ status: true, data: userData });

    } catch (error) {
        console.error("Error fetching user profile:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};








// ===============================================
// === Main Dashboard Summary                  ===
// ===============================================
exports.getDashboardSummary = async (req, res) => {
  // In a real application, you would get the user ID from your authentication middleware.
  const userId = req.user.id;
  // const userId = 1; // Using a placeholder user ID for now.

  try {
    // --- CORRECTED QUERY: Fetch balance from the separate 'wallets' table ---
    const walletQuery = "SELECT balance FROM user_wallets WHERE user_id = ?";
    const [walletRows] = await db.query(walletQuery, [userId]);

    // --- This query correctly sums up the total BV from the ledger ---
    const bvQuery = "SELECT SUM(bv_earned) as total_bv FROM user_business_volume WHERE user_id = ?";
    const [bvRows] = await db.query(bvQuery, [userId]);

    // --- This query correctly counts direct referrals ---
    const downlineQuery = "SELECT COUNT(id) as downline_count FROM users WHERE sponsor_id = ?";
    const [downlineRows] = await db.query(downlineQuery, [userId]);

    // Construct the final JSON response object
    res.status(200).json({
      status: true,
      data: {
        // Use optional chaining (?.) and a default value (|| 0) for safety
        walletBalance: walletRows[0]?.balance || 0,
        totalBv: bvRows[0]?.total_bv || 0,
        directReferrals: downlineRows[0]?.downline_count || 0
      }
    });

  } catch (error) {
    console.error("Error fetching user MLM summary:", error);
    res.status(500).json({ status: false, message: "An error occurred while fetching summary." });
  }
};

// ===============================================
// === Transaction Histories (Paginated)       ===
// ===============================================

// Fetches the user's profit/cash distribution history
exports.getProfitHistory = async (req, res) => {
  const userId = req.user.id;
  // const userId = 1; // Placeholder
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const offset = (page - 1) * limit;

  try {
    const dataQuery = `SELECT * FROM profit_distribution_ledger WHERE user_id = ? ORDER BY transaction_date DESC LIMIT ? OFFSET ?`;
    const [rows] = await db.query(dataQuery, [userId, limit, offset]);

    const countQuery = `SELECT COUNT(*) as total FROM profit_distribution_ledger WHERE user_id = ?`;
    const [countRows] = await db.query(countQuery, [userId]);
    const totalRecords = countRows[0].total;

    res.status(200).json({
      status: true,
      data: rows,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalRecords / limit),
        totalRecords: totalRecords,
        limit: limit
      }
    });
  } catch (error) {
    console.error("Error fetching profit history:", error);
    res.status(500).json({ status: false, message: "An error occurred while fetching profit history." });
  }
};

// Fetches the user's Business Volume (BV) history
exports.getBvHistory = async (req, res) => {
  const userId = req.user.id;
  // const userId = 1; // Placeholder
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const offset = (page - 1) * limit;

  try {
    const dataQuery = `SELECT * FROM user_business_volume WHERE user_id = ? ORDER BY transaction_date DESC LIMIT ? OFFSET ?`;
    const [rows] = await db.query(dataQuery, [userId, limit, offset]);

    const countQuery = `SELECT COUNT(*) as total FROM user_business_volume WHERE user_id = ?`;
    const [countRows] = await db.query(countQuery, [userId]);
    const totalRecords = countRows[0].total;

    res.status(200).json({
      status: true,
      data: rows,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalRecords / limit),
        totalRecords: totalRecords,
        limit: limit
      }
    });
  } catch (error) {
    console.error("Error fetching BV history:", error);
    res.status(500).json({ status: false, message: "An error occurred while fetching BV history." });
  }
};

// ===============================================
// === Downline (Network) View                 ===
// ===============================================
exports.getDownline = async (req, res) => {
  const userId = req.user.id;
  // const userId = 1; // Placeholder
  try {
    // Fetches key details about the user's direct referrals (Level 1)
    const query = `SELECT id, full_name, email, created_at as join_date FROM users WHERE sponsor_id = ? ORDER BY created_at DESC`;
    const [downline] = await db.query(query, [userId]);

    res.status(200).json({
      status: true,
      data: downline
    });
  } catch (error) {
    console.error("Error fetching downline:", error);
    res.status(500).json({ status: false, message: "An error occurred while fetching downline." });
  }

}



/**
 * @desc   Fetch the direct downline (Level 1) for a specific user ID.
 *         This is for the authenticated user's mobile app tree view.
 * @route  GET /api/mlm/tree-node/:userId
 * @access Private/User
 */
exports.getMlmTreeNode = async (req, res) => {
    try {
        const parentId = req.params.userId;
        const loggedInUserId = req.user.id; // From your auth middleware

        // On the first load, the app might request the user's own downline.
        // The `userId` in the param will be the logged-in user's ID.
        // For subsequent expansions, it will be the ID of the node being expanded.

        // Optional Security Check (Advanced): You could verify if `parentId` is
        // actually in the `loggedInUserId`'s downline before proceeding.
        // For now, we'll keep it simple as the user can only start from their own tree.

        const query = `
            SELECT 
                u.id, 
                u.full_name, 
                u.username,
                u.rank,
                u.created_at AS join_date,
                (SELECT COUNT(*) FROM users WHERE sponsor_id = u.id AND is_deleted = 0) AS children_count
            FROM 
                users u
            WHERE 
                u.sponsor_id = ? AND u.is_deleted = 0
            ORDER BY 
                u.full_name;
        `;

        const [downline] = await db.query(query, [parentId]);

        res.status(200).json({
            status: true,
            data: downline
        });

    } catch (error) {
        console.error("Error fetching MLM tree node for user:", error);
        res.status(500).json({ status: false, message: "Server error while fetching network data." });
    }
};

/**
 * @desc   Fetch the initial, top-level downline for the logged-in user.
 * @route  GET /api/mlm/my-network-tree
 * @access Private/User
 */
exports.getMyInitialNetworkTree = async (req, res) => {
    // This function simply calls the other function with the logged-in user's ID.
    req.params.userId = req.user.id;
    return exports.getMlmTreeNode(req, res);
};