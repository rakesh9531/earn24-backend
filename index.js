
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
app.listen(PORT, '0.0.0.0', () => {
  console.log("Current Time:", moment().tz("Asia/Kolkata").format());
  console.log(`Server is running on port ${PORT}`);
});
