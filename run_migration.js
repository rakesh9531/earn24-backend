// run_migration.js
const db = require("./db");

async function run() {
    console.log("=== RUNNING DATABASE SCHEMA MIGRATIONS ===");

    try {
        // 1. Alter users table to add tracking columns
        console.log("Checking users table columns...");
        const [columns] = await db.query("SHOW COLUMNS FROM users");
        const existingColumns = columns.map(c => c.Field.toLowerCase());

        const alterQueries = [
            { name: "bike_fund_months_paid", query: "ALTER TABLE users ADD COLUMN bike_fund_months_paid INT DEFAULT 0" },
            { name: "car_fund_months_paid", query: "ALTER TABLE users ADD COLUMN car_fund_months_paid INT DEFAULT 0" },
            { name: "house_fund_months_paid", query: "ALTER TABLE users ADD COLUMN house_fund_months_paid INT DEFAULT 0" },
            { name: "qualifying_sponsor_ids", query: "ALTER TABLE users ADD COLUMN qualifying_sponsor_ids JSON NULL" }
        ];

        for (const alter of alterQueries) {
            if (!existingColumns.includes(alter.name.toLowerCase())) {
                await db.query(alter.query);
                console.log(`Success: ${alter.query}`);
            } else {
                console.log(`Column already exists: ${alter.name}`);
            }
        }

        // 2. Create reward_claims table
        console.log("\nCreating reward_claims table...");
        const createTableSql = `
            CREATE TABLE IF NOT EXISTS reward_claims (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                reward_type ENUM('BIKE_FUND', 'CAR_FUND', 'DOMESTIC_TOUR', 'INSURANCE_HEALTH', 'INSURANCE_TERM', 'INTERNATIONAL_TOUR', 'RELIEF_FUND', 'HOUSE_FUND', 'LEADERSHIP_FUND', 'TRAVEL_FUND') NOT NULL,
                claim_month INT NOT NULL, -- YYYYMM format
                status ENUM('PENDING', 'APPROVED', 'REJECTED') DEFAULT 'PENDING',
                user_details JSON NULL,
                admin_notes TEXT NULL,
                attachment_path VARCHAR(255) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `;
        await db.query(createTableSql);
        console.log("Success: reward_claims table created successfully.");

        // Create indexes
        console.log("\nCreating indexes...");
        try {
            await db.query("ALTER TABLE reward_claims ADD INDEX idx_user_status (user_id, status)");
            console.log("Success: idx_user_status index created.");
        } catch (err) {
            if (err.errno === 1061) {
                console.log("Index idx_user_status already exists.");
            } else {
                throw err;
            }
        }

        console.log("\n=== MIGRATIONS COMPLETED SUCCESSFULLY ===");

    } catch (err) {
        console.error("Migration failed:", err);
    } finally {
        await db.end();
    }
}

run();
