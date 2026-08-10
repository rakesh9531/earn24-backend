// migration_merchant_full_system.js
// Run with: node migration_merchant_full_system.js
// This creates all tables needed for:
// 1. Merchant Wallet + Transactions + Settlements
// 2. Return / Replacement full flow
// 3. Delivery type (Pan India / Specific Pincodes) on merchant products

const db = require('./db');

async function runMigration() {
    const connection = await db.getConnection();
    console.log('✅ Connected to DB. Starting migration...\n');

    try {
        await connection.beginTransaction();

        // ═══════════════════════════════════════════════════════════
        // 1. merchant_bank_details — merchant ka bank account
        // ═══════════════════════════════════════════════════════════
        await connection.query(`
            CREATE TABLE IF NOT EXISTS merchant_bank_details (
                id                  INT AUTO_INCREMENT PRIMARY KEY,
                merchant_id         INT NOT NULL UNIQUE,
                account_holder_name VARCHAR(200) NOT NULL,
                account_number      VARCHAR(50)  NOT NULL,
                ifsc_code           VARCHAR(20)  NOT NULL,
                bank_name           VARCHAR(100),
                branch_name         VARCHAR(100),
                account_type        ENUM('SAVINGS','CURRENT') DEFAULT 'SAVINGS',
                is_verified         TINYINT(1) DEFAULT 0,
                created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
            )
        `);
        console.log('✅ Table: merchant_bank_details');

        // ═══════════════════════════════════════════════════════════
        // 2. merchant_wallet — merchant ka main wallet
        // ═══════════════════════════════════════════════════════════
        await connection.query(`
            CREATE TABLE IF NOT EXISTS merchant_wallet (
                id                  INT AUTO_INCREMENT PRIMARY KEY,
                merchant_id         INT NOT NULL UNIQUE,
                total_earned        DECIMAL(12,2) DEFAULT 0.00,   -- lifetime 90% earnings
                pending_amount      DECIMAL(12,2) DEFAULT 0.00,   -- in 7-day return window
                available_amount    DECIMAL(12,2) DEFAULT 0.00,   -- return window expired, ready to pay
                paid_amount         DECIMAL(12,2) DEFAULT 0.00,   -- already bank transferred
                platform_fee_total  DECIMAL(12,2) DEFAULT 0.00,   -- total 10% deducted
                updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
            )
        `);
        console.log('✅ Table: merchant_wallet');

        // ═══════════════════════════════════════════════════════════
        // 3. merchant_transactions — every order earning entry
        // ═══════════════════════════════════════════════════════════
        await connection.query(`
            CREATE TABLE IF NOT EXISTS merchant_transactions (
                id                  INT AUTO_INCREMENT PRIMARY KEY,
                merchant_id         INT NOT NULL,
                order_id            INT NOT NULL,
                order_item_id       INT,
                gross_amount        DECIMAL(10,2) NOT NULL,   -- customer paid
                platform_fee        DECIMAL(10,2) NOT NULL,   -- 10%
                net_amount          DECIMAL(10,2) NOT NULL,   -- 90% merchant gets
                status              ENUM('PENDING','AVAILABLE','SETTLED','REFUNDED') DEFAULT 'PENDING',
                delivery_date       DATETIME,                 -- when order was delivered
                release_date        DATETIME,                 -- delivery_date + 7 days
                notes               TEXT,
                created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE,
                FOREIGN KEY (order_id)   REFERENCES orders(id) ON DELETE CASCADE
            )
        `);
        console.log('✅ Table: merchant_transactions');

        // ═══════════════════════════════════════════════════════════
        // 4. merchant_settlements — payout requests
        // ═══════════════════════════════════════════════════════════
        await connection.query(`
            CREATE TABLE IF NOT EXISTS merchant_settlements (
                id                  INT AUTO_INCREMENT PRIMARY KEY,
                merchant_id         INT NOT NULL,
                amount              DECIMAL(12,2) NOT NULL,
                bank_account_number VARCHAR(50),
                ifsc_code           VARCHAR(20),
                account_holder_name VARCHAR(200),
                utr_number          VARCHAR(100),              -- bank transfer UTR
                status              ENUM('REQUESTED','PROCESSING','PAID','FAILED') DEFAULT 'REQUESTED',
                admin_notes         TEXT,
                requested_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                paid_at             DATETIME,
                FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
            )
        `);
        console.log('✅ Table: merchant_settlements');

        // ═══════════════════════════════════════════════════════════
        // 5. Alter merchant_products — add delivery + policy columns
        //    (Only adds if they don't exist)
        // ═══════════════════════════════════════════════════════════
        const [mp_cols] = await connection.query(`SHOW COLUMNS FROM merchant_products`);
        const mpColNames = mp_cols.map(c => c.Field);

        const mpColumnsToAdd = [
            { name: 'delivery_type',           sql: "ADD COLUMN delivery_type ENUM('universal','pincode') DEFAULT 'universal'" },
            { name: 'pincodes_json',            sql: "ADD COLUMN pincodes_json JSON" },
            { name: 'processing_days',          sql: "ADD COLUMN processing_days TINYINT DEFAULT 1" },
            { name: 'free_shipping',            sql: "ADD COLUMN free_shipping TINYINT(1) DEFAULT 0" },
            { name: 'shipping_charge',          sql: "ADD COLUMN shipping_charge DECIMAL(8,2) DEFAULT 0.00" },
            { name: 'is_cod_available',         sql: "ADD COLUMN is_cod_available TINYINT(1) DEFAULT 1" },
            { name: 'has_return_policy',        sql: "ADD COLUMN has_return_policy TINYINT(1) DEFAULT 1" },
            { name: 'return_window_days',       sql: "ADD COLUMN return_window_days TINYINT DEFAULT 7" },
            { name: 'return_type',              sql: "ADD COLUMN return_type ENUM('full_refund','store_credit') DEFAULT 'full_refund'" },
            { name: 'return_shipping_by',       sql: "ADD COLUMN return_shipping_by ENUM('seller','buyer','platform') DEFAULT 'seller'" },
            { name: 'is_replacement_available', sql: "ADD COLUMN is_replacement_available TINYINT(1) DEFAULT 1" },
            { name: 'replacement_window_days',  sql: "ADD COLUMN replacement_window_days TINYINT DEFAULT 7" },
            { name: 'warranty_type',            sql: "ADD COLUMN warranty_type ENUM('no_warranty','manufacturer','seller','brand') DEFAULT 'no_warranty'" },
            { name: 'warranty_months',          sql: "ADD COLUMN warranty_months TINYINT DEFAULT 0" },
            { name: 'warranty_covered_by',      sql: "ADD COLUMN warranty_covered_by VARCHAR(200)" },
            { name: 'bv_points',                sql: "ADD COLUMN bv_points INT DEFAULT 0" },
            { name: 'cashback_percent',         sql: "ADD COLUMN cashback_percent DECIMAL(5,2) DEFAULT 0.00" },
            { name: 'gst_percent',              sql: "ADD COLUMN gst_percent DECIMAL(5,2) DEFAULT 0.00" },
            { name: 'has_variants',             sql: "ADD COLUMN has_variants TINYINT(1) DEFAULT 0" },
            { name: 'variants_json',            sql: "ADD COLUMN variants_json JSON" },
            { name: 'weight_kg',                sql: "ADD COLUMN weight_kg DECIMAL(8,3)" },
            { name: 'dimensions',               sql: "ADD COLUMN dimensions VARCHAR(100)" },
            { name: 'material',                 sql: "ADD COLUMN material VARCHAR(200)" },
            { name: 'care_instructions',        sql: "ADD COLUMN care_instructions TEXT" },
            { name: 'country_of_origin',        sql: "ADD COLUMN country_of_origin VARCHAR(100) DEFAULT 'India'" },
            { name: 'low_stock_alert',          sql: "ADD COLUMN low_stock_alert INT DEFAULT 5" },
        ];

        for (const col of mpColumnsToAdd) {
            if (!mpColNames.includes(col.name)) {
                await connection.query(`ALTER TABLE merchant_products ${col.sql}`);
                console.log(`✅  merchant_products: added column ${col.name}`);
            } else {
                console.log(`⏭️  merchant_products: column ${col.name} already exists`);
            }
        }

        // ═══════════════════════════════════════════════════════════
        // 6. Alter order_returns — add replacement + evidence columns
        // ═══════════════════════════════════════════════════════════
        const [or_cols] = await connection.query(`SHOW COLUMNS FROM order_returns`);
        const orColNames = or_cols.map(c => c.Field);

        const orColumnsToAdd = [
            { name: 'request_type',     sql: "ADD COLUMN request_type ENUM('RETURN','REPLACEMENT') DEFAULT 'RETURN'" },
            { name: 'evidence_images',  sql: "ADD COLUMN evidence_images JSON COMMENT 'Photo/video proof for damage claims'" },
            { name: 'merchant_action',  sql: "ADD COLUMN merchant_action ENUM('PENDING','ACCEPTED','DISPUTED') DEFAULT 'PENDING'" },
            { name: 'merchant_notes',   sql: "ADD COLUMN merchant_notes TEXT" },
            { name: 'admin_action',     sql: "ADD COLUMN admin_action ENUM('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING'" },
            { name: 'admin_notes',      sql: "ADD COLUMN admin_notes TEXT" },
            { name: 'refund_status',    sql: "ADD COLUMN refund_status ENUM('NOT_INITIATED','PROCESSING','COMPLETED','FAILED') DEFAULT 'NOT_INITIATED'" },
            { name: 'pickup_date',      sql: "ADD COLUMN pickup_date DATETIME" },
            { name: 'received_back',    sql: "ADD COLUMN received_back TINYINT(1) DEFAULT 0" },
            { name: 'replacement_dispatched', sql: "ADD COLUMN replacement_dispatched TINYINT(1) DEFAULT 0" },
        ];

        for (const col of orColumnsToAdd) {
            if (!orColNames.includes(col.name)) {
                await connection.query(`ALTER TABLE order_returns ${col.sql}`);
                console.log(`✅  order_returns: added column ${col.name}`);
            } else {
                console.log(`⏭️  order_returns: column ${col.name} already exists`);
            }
        }

        // ═══════════════════════════════════════════════════════════
        // 7. Alter merchants — add delivery_date tracking to orders
        // ═══════════════════════════════════════════════════════════
        const [o_cols] = await connection.query(`SHOW COLUMNS FROM orders`);
        const oColNames = o_cols.map(c => c.Field);

        if (!oColNames.includes('delivered_at')) {
            await connection.query(`ALTER TABLE orders ADD COLUMN delivered_at DATETIME COMMENT 'Actual delivery timestamp for return window calculation'`);
            console.log('✅  orders: added column delivered_at');
        } else {
            console.log('⏭️  orders: delivered_at already exists');
        }

        await connection.commit();
        console.log('\n🎉 Migration completed successfully!\n');
        console.log('Tables created:');
        console.log('  - merchant_bank_details');
        console.log('  - merchant_wallet');
        console.log('  - merchant_transactions');
        console.log('  - merchant_settlements');
        console.log('\nColumns added to:');
        console.log('  - merchant_products (delivery, policies, variants, BV etc.)');
        console.log('  - order_returns (replacement, evidence, merchant/admin actions)');
        console.log('  - orders (delivered_at timestamp)');

    } catch (err) {
        await connection.rollback();
        console.error('❌ Migration failed:', err.message);
        throw err;
    } finally {
        connection.release();
        process.exit(0);
    }
}

runMigration();
