const db = require('./db');

async function applyMigrations() {
    try {
        console.log("Starting Binary MLM Database Migrations on Production...");

        // 1. Add columns to users table
        const alterUsersQueries = [
            "ALTER TABLE users ADD COLUMN binary_placement_id INT NULL AFTER sponsor_id",
            "ALTER TABLE users ADD COLUMN binary_position ENUM('LEFT', 'RIGHT') NULL AFTER binary_placement_id",
            "ALTER TABLE users ADD COLUMN left_leg_bv DECIMAL(15, 2) DEFAULT 0.00 AFTER binary_position",
            "ALTER TABLE users ADD COLUMN right_leg_bv DECIMAL(15, 2) DEFAULT 0.00 AFTER left_leg_bv",
            "ALTER TABLE users ADD COLUMN total_matched_bv DECIMAL(15, 2) DEFAULT 0.00 AFTER right_leg_bv",
            "ALTER TABLE users ADD COLUMN binary_level_matched INT DEFAULT 0 AFTER total_matched_bv"
        ];

        for (const query of alterUsersQueries) {
            try {
                await db.query(query);
                console.log(`Executed user column: ${query}`);
            } catch (err) {
                if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Multiple primary key') || err.message.includes('already exists')) {
                    console.log(`Column already exists, skipping: ${query}`);
                } else {
                    console.error(`Error executing users column: ${query}`, err.message);
                }
            }
        }

        // 2. Add columns to orders table for cancellation safety
        const alterOrdersQueries = [
            "ALTER TABLE orders ADD COLUMN cancellation_reason VARCHAR(255) DEFAULT NULL",
            "ALTER TABLE orders ADD COLUMN cancelled_by ENUM('USER', 'ADMIN') DEFAULT NULL",
            "ALTER TABLE orders ADD COLUMN cancelled_at TIMESTAMP NULL DEFAULT NULL"
        ];

        for (const query of alterOrdersQueries) {
            try {
                await db.query(query);
                console.log(`Executed order column: ${query}`);
            } catch (err) {
                if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('already exists')) {
                    console.log(`Column already exists, skipping: ${query}`);
                } else {
                    console.error(`Error executing orders column: ${query}`, err.message);
                }
            }
        }

        // 3. Create user_binary_bv_entries table
        const createBvEntriesQuery = `
            CREATE TABLE IF NOT EXISTS \`user_binary_bv_entries\` (
              \`id\` INT AUTO_INCREMENT PRIMARY KEY,
              \`user_id\` INT NOT NULL,
              \`source_user_id\` INT NOT NULL,
              \`order_id\` INT NOT NULL DEFAULT 0,
              \`bv_amount\` DECIMAL(15,2) NOT NULL,
              \`leg\` ENUM('LEFT', 'RIGHT') NOT NULL,
              \`depth\` INT NOT NULL DEFAULT 1,
              \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE,
              FOREIGN KEY (\`source_user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE
            ) ENGINE=InnoDB;
        `;
        await db.query(createBvEntriesQuery);
        console.log("Executed: CREATE TABLE IF NOT EXISTS user_binary_bv_entries");

        // 4. Create binary_matching_payouts table
        const createPayoutsQuery = `
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
        `;
        await db.query(createPayoutsQuery);
        console.log("Executed: CREATE TABLE IF NOT EXISTS binary_matching_payouts");

        console.log("All Database Migrations completed successfully!");
        process.exit(0);
    } catch (error) {
        console.error("Migration fatal error:", error);
        process.exit(1);
    }
}

applyMigrations();
