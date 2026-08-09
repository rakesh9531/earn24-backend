const db = require('./db');

async function runMigration() {
  console.log("Starting DB migration for Multi-Vendor & Universal Pincode features...");
  const connection = await db.getConnection();
  try {
    // 1. Add is_universal_pincode to products
    try {
      await connection.query("ALTER TABLE products ADD COLUMN is_universal_pincode TINYINT(1) DEFAULT 0;");
      console.log("✅ Added is_universal_pincode to products");
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        console.log("ℹ️ is_universal_pincode already exists in products");
      } else {
        console.error("Error adding is_universal_pincode:", err.message);
      }
    }

    // 2. Add merchant_price & admin_margin_percent to seller_products
    try {
      await connection.query("ALTER TABLE seller_products ADD COLUMN merchant_price DECIMAL(15,2) NULL, ADD COLUMN admin_margin_percent DECIMAL(5,2) DEFAULT 10.00;");
      console.log("✅ Added merchant_price & admin_margin_percent to seller_products");
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        console.log("ℹ️ merchant_price/admin_margin_percent already exist in seller_products");
      } else {
        console.error("Error updating seller_products:", err.message);
      }
    }

    // 3. Add serviceable_pincodes to delivery_agents
    try {
      await connection.query("ALTER TABLE delivery_agents ADD COLUMN serviceable_pincodes TEXT NULL;");
      console.log("✅ Added serviceable_pincodes to delivery_agents");
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        console.log("ℹ️ serviceable_pincodes already exists in delivery_agents");
      } else {
        console.error("Error adding serviceable_pincodes:", err.message);
      }
    }

    // 4. Add admin_approval_status & doc columns to merchants
    try {
      await connection.query("ALTER TABLE merchants ADD COLUMN admin_approval_status ENUM('PENDING', 'APPROVED', 'REJECTED') DEFAULT 'APPROVED';");
      console.log("✅ Added admin_approval_status to merchants");
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        console.log("ℹ️ admin_approval_status already exists in merchants");
      } else {
        console.error("Error adding admin_approval_status:", err.message);
      }
    }

    try {
      await connection.query("ALTER TABLE merchants ADD COLUMN pan_card_doc VARCHAR(500) NULL, ADD COLUMN gst_cert_doc VARCHAR(500) NULL, ADD COLUMN bank_passbook_doc VARCHAR(500) NULL;");
      console.log("✅ Added document columns to merchants");
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        console.log("ℹ️ Document columns already exist in merchants");
      } else {
        console.error("Error adding merchant doc columns:", err.message);
      }
    }

    // 5. Create order_returns table
    const createReturnsSql = `
      CREATE TABLE IF NOT EXISTS order_returns (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT NOT NULL,
        order_item_id INT NOT NULL,
        user_id INT NOT NULL,
        merchant_id INT NOT NULL,
        return_type ENUM('RETURN', 'REPLACEMENT') NOT NULL DEFAULT 'RETURN',
        reason TEXT NOT NULL,
        images_json JSON NULL,
        status ENUM('PENDING', 'APPROVED', 'REJECTED', 'PICKUP_INITIATED', 'RECEIVED_BY_MERCHANT', 'COMPLETED') DEFAULT 'PENDING',
        courier_tracking_id VARCHAR(100) NULL,
        refund_amount DECIMAL(15,2) DEFAULT 0.00,
        admin_notes TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await connection.query(createReturnsSql);
    console.log("✅ Verified order_returns table structure");

    console.log("\n🎉 Database migration finished successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    connection.release();
    process.exit(0);
  }
}

runMigration();
