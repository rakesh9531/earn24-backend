const db = require('./db');

async function runMigration() {
    try {
        console.log("Creating seller_product_variants table if not exists...");
        await db.query(`
            CREATE TABLE IF NOT EXISTS seller_product_variants (
                id INT AUTO_INCREMENT PRIMARY KEY,
                seller_product_id INT NOT NULL,
                product_id INT NULL,
                title VARCHAR(255) NULL,
                color VARCHAR(100) NULL,
                size VARCHAR(100) NULL,
                sku VARCHAR(100) NULL,
                price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
                mrp DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
                stock_quantity INT NOT NULL DEFAULT 0,
                variant_image_url VARCHAR(500) NULL,
                is_active TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_sp_id (seller_product_id),
                INDEX idx_prod_id (product_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        console.log("✅ seller_product_variants table verified successfully.");
        if (db.end) await db.end();
        process.exit(0);
    } catch (err) {
        console.error("❌ Migration error:", err);
        if (db.end) await db.end();
        process.exit(1);
    }
}

runMigration();
