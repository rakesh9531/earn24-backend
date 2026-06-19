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
            { name: "qualifying_sponsor_ids", query: "ALTER TABLE users ADD COLUMN qualifying_sponsor_ids JSON NULL" },
            { name: "last_rank_promoted_at", query: "ALTER TABLE users ADD COLUMN last_rank_promoted_at TIMESTAMP NULL DEFAULT NULL COMMENT 'Date when user was promoted to current rank' AFTER `rank`" }
        ];

        for (const alter of alterQueries) {
            if (!existingColumns.includes(alter.name.toLowerCase())) {
                await db.query(alter.query);
                console.log(`Success: ${alter.query}`);
            } else {
                console.log(`Column already exists: ${alter.name}`);
            }
        }

        // Initialize last_rank_promoted_at for existing users
        console.log("Initializing last_rank_promoted_at for users...");
        await db.query("UPDATE users SET last_rank_promoted_at = created_at WHERE last_rank_promoted_at IS NULL");

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

        // 3. Alter user_kyc table to add document upload columns
        console.log("\nChecking user_kyc table for document columns...");
        const [kycCols] = await db.query("SHOW COLUMNS FROM user_kyc");
        const existingKycColumns = kycCols.map(c => c.Field.toLowerCase());

        const kycDocAlters = [
            {
                name: "pan_card_doc",
                query: "ALTER TABLE `user_kyc` ADD COLUMN `pan_card_doc` VARCHAR(500) NULL COMMENT 'Server path to uploaded PAN Card image/PDF' AFTER `bank_name`"
            },
            {
                name: "aadhaar_card_doc",
                query: "ALTER TABLE `user_kyc` ADD COLUMN `aadhaar_card_doc` VARCHAR(500) NULL COMMENT 'Server path to uploaded Aadhaar Card image/PDF' AFTER `pan_card_doc`"
            },
            {
                name: "bank_passbook_doc",
                query: "ALTER TABLE `user_kyc` ADD COLUMN `bank_passbook_doc` VARCHAR(500) NULL COMMENT 'Server path to uploaded Bank Passbook image/PDF' AFTER `aadhaar_card_doc`"
            }
        ];

        for (const alter of kycDocAlters) {
            if (!existingKycColumns.includes(alter.name.toLowerCase())) {
                await db.query(alter.query);
                console.log(`✅ Added column: ${alter.name}`);
            } else {
                console.log(`⏭️  Column already exists: ${alter.name}`);
            }
        }

        // 4. Alter user_withdraw_requests table to add missing withdrawal columns
        console.log("\nChecking user_withdraw_requests table columns...");
        const [withdrawCols] = await db.query("SHOW COLUMNS FROM user_withdraw_requests");
        const existingWithdrawColumns = withdrawCols.map(c => c.Field.toLowerCase());

        const withdrawAlters = [
            {
                name: "bank_details_snapshot",
                query: "ALTER TABLE `user_withdraw_requests` ADD COLUMN `bank_details_snapshot` JSON NULL COMMENT 'Snapshot of approved bank info at the time of request' AFTER `status`"
            },
            {
                name: "utr_number",
                query: "ALTER TABLE `user_withdraw_requests` ADD COLUMN `utr_number` VARCHAR(100) NULL COMMENT 'Bank transaction ID entered by Admin on approval' AFTER `bank_details_snapshot`"
            },
            {
                name: "admin_remarks",
                query: "ALTER TABLE `user_withdraw_requests` ADD COLUMN `admin_remarks` TEXT NULL COMMENT 'Rejection reason or approval notes' AFTER `utr_number`"
            }
        ];

        for (const alter of withdrawAlters) {
            if (!existingWithdrawColumns.includes(alter.name.toLowerCase())) {
                await db.query(alter.query);
                console.log(`✅ Added column: ${alter.name}`);
            } else {
                console.log(`⏭️  Column already exists: ${alter.name}`);
            }
        }

        // 5. Alter order_items table to add purchase_price and gst_percentage snapshots
        console.log("\nChecking order_items table for snapshot columns...");
        const [orderItemCols] = await db.query("SHOW COLUMNS FROM order_items");
        const existingOrderItemCols = orderItemCols.map(c => c.Field.toLowerCase());

        if (!existingOrderItemCols.includes("purchase_price")) {
            await db.query("ALTER TABLE order_items ADD COLUMN purchase_price DECIMAL(10, 2) NOT NULL DEFAULT 0.00 AFTER price_per_unit");
            console.log("✅ Added column: purchase_price to order_items");
        } else {
            console.log("⏭️  Column already exists: purchase_price in order_items");
        }

        if (!existingOrderItemCols.includes("gst_percentage")) {
            await db.query("ALTER TABLE order_items ADD COLUMN gst_percentage DECIMAL(5, 2) NOT NULL DEFAULT 0.00 AFTER purchase_price");
            console.log("✅ Added column: gst_percentage to order_items");
        } else {
            console.log("⏭️  Column already exists: gst_percentage in order_items");
        }

        // Backfill historical rows
        console.log("Backfilling historical order_items snapshots...");
        await db.query(`
            UPDATE order_items oi
            JOIN seller_products sp ON oi.seller_product_id = sp.id
            JOIN products p ON oi.product_id = p.id
            LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
            SET oi.purchase_price = sp.purchase_price, oi.gst_percentage = IFNULL(h.gst_percentage, 0.00)
            WHERE oi.purchase_price = 0.00 AND oi.gst_percentage = 0.00
        `);
        console.log("✅ Backfilled historical order_items snapshots.");

        console.log("\n=== MIGRATIONS COMPLETED SUCCESSFULLY ===");

    } catch (err) {
        console.error("Migration failed:", err);
    } finally {
        await db.end();
    }
}

run();
