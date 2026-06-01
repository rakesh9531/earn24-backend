const db = require('./db');

async function applyMigrations() {
    try {
        console.log("Starting Binary MLM Database Migrations...");

        // 1. Add columns to users table
        const alterUsersQueries = [
            "ALTER TABLE users ADD COLUMN binary_placement_id INT NULL AFTER sponsor_id",
            "ALTER TABLE users ADD COLUMN binary_position ENUM('LEFT', 'RIGHT') NULL AFTER binary_placement_id",
            "ALTER TABLE users ADD COLUMN left_leg_bv DECIMAL(15, 2) DEFAULT 0.00 AFTER binary_position",
            "ALTER TABLE users ADD COLUMN right_leg_bv DECIMAL(15, 2) DEFAULT 0.00 AFTER left_leg_bv",
            "ALTER TABLE users ADD COLUMN total_matched_bv DECIMAL(15, 2) DEFAULT 0.00 AFTER right_leg_bv"
        ];

        for (const query of alterUsersQueries) {
            try {
                await db.query(query);
                console.log(`Executed: ${query}`);
            } catch (err) {
                if (err.code === 'ER_DUP_FIELDNAME') {
                    console.log(`Column already exists, skipping: ${query}`);
                } else {
                    console.error(`Error executing: ${query}`, err.message);
                }
            }
        }

        // 2. Create user_binary_bv_entries table
        const createBvEntriesQuery = `
            CREATE TABLE IF NOT EXISTS \`user_binary_bv_entries\` (
              \`id\` INT AUTO_INCREMENT PRIMARY KEY,
              \`user_id\` INT NOT NULL,
              \`source_user_id\` INT NOT NULL,
              \`order_id\` INT NOT NULL,
              \`bv_amount\` DECIMAL(15,2) NOT NULL,
              \`leg\` ENUM('LEFT', 'RIGHT') NOT NULL,
              \`depth\` INT NOT NULL,
              \`is_matched\` TINYINT(1) DEFAULT 0,
              \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;
        await db.query(createBvEntriesQuery);
        console.log("Executed: CREATE TABLE user_binary_bv_entries");

        console.log("Migrations completed successfully!");
        process.exit(0);
    } catch (error) {
        console.error("Migration failed:", error);
        process.exit(1);
    }
}

applyMigrations();
