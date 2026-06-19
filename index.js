
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const db = require('./db'); // Ensure this path is correct
const apiRouter = require('./route');
const moment = require('moment-timezone');
const path = require('path');

const { scheduleQualificationJob } = require('./src/jobs/monthlyQualificationJob');
const { scheduleFundJob } = require('./src/jobs/monthlyFundDistributor');
const { scheduleBinaryMatchingJob } = require('./src/jobs/binaryMatchingJob');


const app = express();
const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.set('socketio', io);

io.on('connection', (socket) => {
  console.log('Client connected to socket:', socket.id);

  socket.on('join', (room) => {
    socket.join(room);
    console.log(`Socket ${socket.id} joined room: ${room}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected from socket:', socket.id);
  });
});




// Middleware
// app.use(cors());



// const corsOptions = {
//   origin: [
//     'https://newadmin.earn24.in', 
//     'http://localhost:4200'
//   ],
//   methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], // ✅ Explicitly allow all
//   allowedHeaders: ['Content-Type', 'Authorization'],
//   credentials: true
// };

// app.use(cors(corsOptions));



// const corsOptions = {
//   origin: function (origin, callback) {
//     const whitelist = [
//       'https://newadmin.earn24.in', 
//       'http://localhost:4200',
//       'http://127.0.0.1:4200' // Add this
//     ];
//     // Allow requests with no origin (like mobile apps or curl) 
//     // or if the origin is in the whitelist
//     if (!origin || whitelist.indexOf(origin) !== -1) {
//       callback(null, true);
//     } else {
//       callback(new Error('Not allowed by CORS'));
//     }
//   },
//   methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'], // Added more common headers
//   credentials: true,
//   optionsSuccessStatus: 200 // Some legacy browsers choke on 204
// };


const corsOptions = {
  origin: function (origin, callback) {

    if (!origin) return callback(null, true);

    if (
      origin.endsWith('.earn24.in') ||
      origin === 'https://earn24.in' ||
      origin === 'http://earn24.in' ||
      origin.includes('localhost')
    ) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },

  credentials: true
};



app.use(cors(corsOptions));






app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

app.use('/uploads', express.static('src/uploads'));
app.use('/uploads', express.static('src/uploads/brand-logos'));
app.use('/uploads/kyc-docs', express.static(path.join(__dirname, 'src/uploads/kyc-docs')));


// Serve static files
app.use('/public', express.static(path.join(__dirname, 'public')));

// Handle API routes
app.use('/api', apiRouter);


// Test Database Connection
async function testDatabaseConnection() {
  try {
    const connection = await db.getConnection();
    await connection.ping();
    console.log('Connection to the database has been established successfully.');

    // Production Safe Migrations for Order Cancellation
    const [columns] = await connection.query("SHOW COLUMNS FROM orders LIKE 'cancellation_reason'");
    if (columns.length === 0) {
      console.log('Running Order Cancellation schema migrations...');
      await connection.query("ALTER TABLE orders ADD COLUMN cancellation_reason VARCHAR(255) DEFAULT NULL");
      await connection.query("ALTER TABLE orders ADD COLUMN cancelled_by ENUM('USER', 'ADMIN') DEFAULT NULL");
      await connection.query("ALTER TABLE orders ADD COLUMN cancelled_at TIMESTAMP NULL DEFAULT NULL");
      console.log("Database updated: Added cancellation columns to 'orders' table successfully.");
    }

    // Auto-migration for user_favorites table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`user_favorites\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`user_id\` INT NOT NULL,
        \`product_id\` INT NOT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY \`uq_user_product_fav\` (\`user_id\`, \`product_id\`),
        FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE,
        FOREIGN KEY (\`product_id\`) REFERENCES \`products\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
    console.log("Database verification: user_favorites table checked/created.");

    // Auto-migration for user_business_volume table
    const [bvColumns] = await connection.query("SHOW COLUMNS FROM user_business_volume LIKE 'bv_type'");
    if (bvColumns.length === 0) {
      console.log('Running user_business_volume schema migrations...');
      await connection.query("ALTER TABLE user_business_volume ADD COLUMN bv_type ENUM('SELF', 'DOWNLINE') NOT NULL DEFAULT 'SELF' AFTER notes");
      await connection.query("ALTER TABLE user_business_volume ADD COLUMN source_user_id INT DEFAULT NULL AFTER bv_type");
      await connection.query("ALTER TABLE user_business_volume ADD CONSTRAINT fk_bv_source_user FOREIGN KEY (source_user_id) REFERENCES users(id) ON DELETE SET NULL");
      console.log("Database updated: Added bv_type and source_user_id columns to 'user_business_volume' table successfully.");
    } else {
      console.log("Database verification: user_business_volume columns already verified.");
    }

    // Auto-migration for user binary structure
    console.log("Running auto-migrations for binary schema verification...");
    const [userColumns] = await connection.query("SHOW COLUMNS FROM users");
    const userColNames = userColumns.map(c => c.Field);

    if (!userColNames.includes('binary_placement_id')) {
      await connection.query("ALTER TABLE users ADD COLUMN binary_placement_id INT NULL AFTER sponsor_id");
      console.log("Migration: Added binary_placement_id to users");
    }
    if (!userColNames.includes('binary_position')) {
      await connection.query("ALTER TABLE users ADD COLUMN binary_position ENUM('LEFT', 'RIGHT') NULL AFTER binary_placement_id");
      console.log("Migration: Added binary_position to users");
    }
    if (!userColNames.includes('left_leg_bv')) {
      await connection.query("ALTER TABLE users ADD COLUMN left_leg_bv DECIMAL(15, 2) DEFAULT 0.00 AFTER binary_position");
      console.log("Migration: Added left_leg_bv to users");
    }
    if (!userColNames.includes('right_leg_bv')) {
      await connection.query("ALTER TABLE users ADD COLUMN right_leg_bv DECIMAL(15, 2) DEFAULT 0.00 AFTER left_leg_bv");
      console.log("Migration: Added right_leg_bv to users");
    }
    if (!userColNames.includes('total_matched_bv')) {
      await connection.query("ALTER TABLE users ADD COLUMN total_matched_bv DECIMAL(15, 2) DEFAULT 0.00 AFTER right_leg_bv");
      console.log("Migration: Added total_matched_bv to users");
    }
    if (!userColNames.includes('binary_level_matched')) {
      await connection.query("ALTER TABLE users ADD COLUMN binary_level_matched INT DEFAULT 0 AFTER total_matched_bv");
      console.log("Migration: Added binary_level_matched to users");
    }
    if (!userColNames.includes('binary_placement_preference')) {
      await connection.query("ALTER TABLE users ADD COLUMN binary_placement_preference ENUM('LEFT', 'RIGHT', 'AUTO') DEFAULT 'LEFT' AFTER binary_level_matched");
      console.log("Migration: Added binary_placement_preference to users");
    }
    if (!userColNames.includes('is_default_chain')) {
      await connection.query("ALTER TABLE users ADD COLUMN is_default_chain TINYINT(1) DEFAULT 0 AFTER user_pic");
      console.log("Migration: Added is_default_chain to users");
      // Initialize the root user as part of the default chain
      await connection.query("UPDATE users SET is_default_chain = 1 WHERE id = (SELECT id FROM (SELECT id FROM users ORDER BY id ASC LIMIT 1) as tmp)");
    }

    // Auto-migration for user_binary_bv_entries table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`user_binary_bv_entries\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`user_id\` INT NOT NULL,
        \`source_user_id\` INT NOT NULL,
        \`leg_user_id\` INT NULL,
        \`order_id\` INT NOT NULL DEFAULT 0,
        \`bv_amount\` DECIMAL(15,2) NOT NULL,
        \`leg\` ENUM('LEFT', 'RIGHT') NULL,
        \`depth\` INT NOT NULL DEFAULT 1,
        \`matched_amount\` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE,
        FOREIGN KEY (\`source_user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
    console.log("Database verification: user_binary_bv_entries table checked/created.");

    // Check if matched_amount column exists in user_binary_bv_entries (in case table existed but column was missing)
    const [bvEntryColumns] = await connection.query("SHOW COLUMNS FROM user_binary_bv_entries LIKE 'matched_amount'");
    if (bvEntryColumns.length === 0) {
      await connection.query("ALTER TABLE user_binary_bv_entries ADD COLUMN matched_amount DECIMAL(15, 2) NOT NULL DEFAULT 0.00 AFTER depth");
      console.log("Migration: Added matched_amount to user_binary_bv_entries");
    }

    const [bvEntryLegColumns] = await connection.query("SHOW COLUMNS FROM user_binary_bv_entries LIKE 'leg_user_id'");
    if (bvEntryLegColumns.length === 0) {
      await connection.query("ALTER TABLE user_binary_bv_entries ADD COLUMN leg_user_id INT NULL AFTER source_user_id");
      console.log("Migration: Added leg_user_id to user_binary_bv_entries");
    }

    // Ensure leg column can be NULL in case it was NOT NULL in older versions
    await connection.query("ALTER TABLE user_binary_bv_entries MODIFY COLUMN leg ENUM('LEFT', 'RIGHT') NULL");

    // Add index if not exists
    const [indexes] = await connection.query("SHOW INDEX FROM user_binary_bv_entries WHERE Key_name = 'idx_user_leg_depth'");
    if (indexes.length === 0) {
      await connection.query("ALTER TABLE user_binary_bv_entries ADD INDEX idx_user_leg_depth (user_id, leg_user_id, depth)");
      console.log("Migration: Added index idx_user_leg_depth to user_binary_bv_entries");
    }

    // Auto-migration for binary_matching_payouts table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`binary_matching_payouts\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`user_id\` INT NOT NULL,
        \`matched_bv\` DECIMAL(15, 2) NOT NULL,
        \`payout_percentage\` DECIMAL(5, 2) NOT NULL,
        \`payout_amount\` DECIMAL(15, 2) NOT NULL,
        \`remarks\` VARCHAR(255),
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
    console.log("Database verification: binary_matching_payouts table checked/created.");

    // Auto-migration for setting key: min_withdrawal_limit
    const [existingSetting] = await connection.query("SELECT * FROM app_settings WHERE setting_key = 'min_withdrawal_limit'");
    if (existingSetting.length === 0) {
      await connection.query(`
        INSERT INTO app_settings (setting_key, setting_value, description) 
        VALUES ('min_withdrawal_limit', '100', 'Minimum wallet withdrawal amount to bank account')
      `);
      console.log("Migration: Added min_withdrawal_limit setting (default 100).");
    }

    // Auto-migration for KYC document upload columns
    const [kycColumns] = await connection.query("SHOW COLUMNS FROM user_kyc LIKE 'pan_card_doc'");
    if (kycColumns.length === 0) {
      console.log('Running user_kyc document columns migration...');
      await connection.query("ALTER TABLE user_kyc ADD COLUMN pan_card_doc VARCHAR(500) NULL COMMENT 'Path to uploaded PAN card image' AFTER bank_name");
      await connection.query("ALTER TABLE user_kyc ADD COLUMN aadhaar_card_doc VARCHAR(500) NULL COMMENT 'Path to uploaded Aadhaar card image' AFTER pan_card_doc");
      await connection.query("ALTER TABLE user_kyc ADD COLUMN bank_passbook_doc VARCHAR(500) NULL COMMENT 'Path to uploaded Bank Passbook image' AFTER aadhaar_card_doc");
      console.log("Migration: Added pan_card_doc, aadhaar_card_doc, bank_passbook_doc to user_kyc table.");
    } else {
      console.log("Database verification: user_kyc document columns already exist.");
    }

    // Auto-migration for user_withdraw_requests table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`user_withdraw_requests\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`user_id\` INT NOT NULL,
        \`amount\` DECIMAL(12,2) NOT NULL,
        \`status\` ENUM('PENDING', 'APPROVED', 'REJECTED') DEFAULT 'PENDING',
        \`bank_details_snapshot\` JSON NOT NULL COMMENT 'Snapshot of approved bank info at the time of request',
        \`utr_number\` VARCHAR(100) NULL COMMENT 'Bank transaction ID entered by Admin on approval',
        \`admin_remarks\` TEXT NULL COMMENT 'Rejection reason or approval notes',
        \`requested_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`processed_at\` TIMESTAMP NULL,
        FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`)
      ) ENGINE=InnoDB;
    `);
    console.log("Database verification: user_withdraw_requests table checked/created.");

    // In case the table already existed but without the new columns, perform auto-migration
    const [withdrawColumns] = await connection.query("SHOW COLUMNS FROM user_withdraw_requests LIKE 'bank_details_snapshot'");
    if (withdrawColumns.length === 0) {
      console.log('Running user_withdraw_requests table columns migration...');
      await connection.query("ALTER TABLE user_withdraw_requests ADD COLUMN bank_details_snapshot JSON NULL COMMENT 'Snapshot of approved bank info at the time of request' AFTER status");
      await connection.query("ALTER TABLE user_withdraw_requests ADD COLUMN utr_number VARCHAR(100) NULL COMMENT 'Bank transaction ID entered by Admin on approval' AFTER bank_details_snapshot");
      await connection.query("ALTER TABLE user_withdraw_requests ADD COLUMN admin_remarks TEXT NULL COMMENT 'Rejection reason or approval notes' AFTER utr_number");
      console.log("Migration: Added bank_details_snapshot, utr_number, admin_remarks to user_withdraw_requests table.");
    } else {
      console.log("Database verification: user_withdraw_requests columns already exist.");
    }

    connection.release();
  } catch (error) {
    console.error('Unable to connect to the database:', error);
  }
}
testDatabaseConnection();

// Initialize Scheduled MLM Jobs
scheduleQualificationJob();
scheduleFundJob();
scheduleBinaryMatchingJob();
console.log('Scheduled MLM cron jobs have been initialized.');


// Server Port
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log("Current Time:", moment().tz("Asia/Kolkata").format());
  console.log(`Server is running on port ${PORT}`);
});

