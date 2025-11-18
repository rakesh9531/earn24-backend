const db = require('../../db'); // Assuming you have a database connection module
const User = require('../Models/userModel'); // Import the Admin model
const bcrypt = require('bcrypt'); // For hashing passwords
const jwt = require('jsonwebtoken');
const moment = require('moment');
const { registerUserValidator, loginUserValidator } = require('../Validator/userValidation');

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



// MLM Logic For Resigter controller belwo
exports.registerUser = async (req, res) => {
  try {
    const { error } = registerUserValidator(req.body);
    if (error) {
      return res.status(400).json({ status: false, message: 'Validation failed', errors: error.details.map(err => err.message) });
    }

    const {
      full_name,
      username,
      password,
      email,
      mobile_number,
      referral_code, // This is the SPONSOR's referral code
      device_token,
    } = req.body;

    const [existing] = await db.query(
      'SELECT * FROM users WHERE username = ? OR email = ? OR mobile_number = ? LIMIT 1',
      [username, email, mobile_number]
    );
    if (existing.length > 0) {
      return res.status(409).json({ status: false, message: 'Username, email, or mobile number already exists' });
    }

    // ===============================================
    //           YOUR FINAL, CORRECTED LOGIC
    // ===============================================
    let sponsorId = null;
    let userType = 'CUSTOMER'; // Default to Customer

    if (referral_code && referral_code.trim() !== '') {
      // A referral code was provided. This user intends to be an Affiliate.
      const [sponsor] = await db.query('SELECT id FROM users WHERE referral_code = ?', [referral_code.trim()]);

      if (sponsor.length === 0) {
        // The provided code is invalid. Stop the registration.
        return res.status(400).json({ status: false, message: 'Invalid referral code provided.' });
      }
      sponsorId = sponsor[0].id;
      userType = 'AFFILIATE'; // Upgrade the user to an Affiliate.

    }
    // If no referral_code is provided, sponsorId remains NULL and userType remains 'CUSTOMER'.
    // This is the correct behavior for a direct customer.
    // ===============================================
    //            END OF CORRECTED LOGIC
    // ===============================================

    const hashedPassword = await bcrypt.hash(password, 10);
    // The new user's own username becomes their personal referral code.
    const newUserReferralCode = username;
    const createdAt = moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

    const [result] = await db.query(
      `INSERT INTO users (
         full_name, username, password, email, mobile_number, 
         referral_code, sponsor_id, user_type, device_token, 
         is_online, is_active, is_deleted, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
      [
        full_name,
        username,
        hashedPassword,
        email,
        mobile_number,
        newUserReferralCode,
        sponsorId,           // Will be NULL for Customers, or an ID for Affiliates
        userType,            // Will be 'CUSTOMER' or 'AFFILIATE'
        device_token || null,
        1, // is_online
        createdAt,
        createdAt
      ]
    );

    const userId = result.insertId;
    await db.query('INSERT INTO user_wallets (user_id) VALUES (?)', [userId]);

    const token = jwt.sign({ id: userId, username }, process.env.JWT_SECRET, { expiresIn: '30d' });
    
    // Fetch the newly created user to return all details
    const [newUserRows] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    const newUserInfo = newUserRows[0];

    res.status(201).json({
      status: true,
      message: 'User registered successfully',
      data: {
        user: newUserInfo,
        token
      }
    });

  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ status: false, message: 'Server error' });
  }
}; 


exports.userLogin = async (req, res) => {
  try {
    // Validator is fine, no changes needed
    const { error } = loginUserValidator(req.body);
    if (error) {
      return res.status(400).json({
        status: false,
        message: 'Validation failed',
        errors: error.details.map(err => err.message)
      });
    }

    const { login, password } = req.body;

    // --- THIS IS THE FIX ---
    // The query now checks the 'login' input against three possible columns.
    const [users] = await db.query(
      'SELECT * FROM users WHERE username = ? OR email = ? OR mobile_number = ? LIMIT 1',
      [login, login, login] // Pass the same input for all three checks
    );

    if (users.length === 0) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    const user = users[0];

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ status: false, message: 'Invalid credentials' }); // More generic error
    }

    // Generate JWT Token
    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(200).json({
      status: true,
      message: 'Login successful',
      token, // Send the token for the app to store
      data: {
        id: user.id,
        full_name: user.full_name,
        username: user.username,
        email: user.email,
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ status: false, message: 'Server error' });
  }
};


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