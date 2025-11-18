CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  email VARCHAR(100),
  referral_code VARCHAR(50),
  default_sponsor VARCHAR(50),
  device_token VARCHAR(255),
  is_online BOOLEAN DEFAULT 0,
  is_deleted BOOLEAN DEFAULT 0,
  user_pic VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);


CREATE TABLE admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100),
  username VARCHAR(50) UNIQUE,
  password VARCHAR(255),
  email VARCHAR(100) UNIQUE,
  role ENUM('admin', 'manager', 'staff'),
  status ENUM('active', 'inactive') DEFAULT 'active',
  admin_pic VARCHAR(255),
  is_online TINYINT DEFAULT 0,
  is_deleted TINYINT DEFAULT 0,
  created_at DATETIME,
  updated_at DATETIME
);




CREATE TABLE user_wallets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  balance DECIMAL(12,2) DEFAULT 0.00,
  locked_balance DECIMAL(12,2) DEFAULT 0.00, -- For pending withdrawals or holds
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);


CREATE TABLE user_wallet_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  txn_type ENUM('credit', 'debit') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  source ENUM('signup_bonus', 'level_income', 'purchase', 'refund', 'manual', 'withdrawal') NOT NULL,
  reference_id VARCHAR(100), -- order ID, referral ID, etc.
  remarks VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP

);


CREATE TABLE user_withdraw_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  method VARCHAR(50), -- e.g., 'UPI', 'Bank'
  account_info TEXT, -- JSON or string for account details
  requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME
);

ALTER TABLE `users` CHANGE `default_sponsor` `default_sponsor` BOOLEAN NULL DEFAULT NULL;


CREATE TABLE product_subcategories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  description TEXT,
  image_url VARCHAR(255),
  is_active TINYINT(1) DEFAULT 1,
  is_deleted TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);


CREATE TABLE hsn_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  hsn_code VARCHAR(20) UNIQUE NOT NULL,
  description VARCHAR(255),
  gst_percentage DECIMAL(5,2) NOT NULL CHECK (gst_percentage >= 0 AND gst_percentage <= 100),
  is_active BOOLEAN DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);


CREATE TABLE products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  
  -- Universal Information
  category_id INT NOT NULL,
  subcategory_id INT,
  brand_id INT,
  hsn_code_id INT,
  description TEXT,
  main_image_url VARCHAR(255),
  gallery_image_urls JSON,
  
  -- Admin-controlled status for the master product
  is_approved BOOLEAN DEFAULT FALSE, -- Admin must approve before any seller can use it
  is_active BOOLEAN DEFAULT TRUE,
  is_deleted BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Foreign Keys
  FOREIGN KEY (category_id) REFERENCES product_categories(id) ON DELETE RESTRICT,
  FOREIGN KEY (subcategory_id) REFERENCES product_subcategories(id) ON DELETE SET NULL,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL,
  FOREIGN KEY (hsn_code_id) REFERENCES hsn_codes(id) ON DELETE RESTRICT
) ENGINE=InnoDB;


CREATE TABLE brands (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  slug VARCHAR(100) NOT NULL UNIQUE,
  logo_url VARCHAR(255),
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE attributes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE, -- e.g., "Color", "RAM", "Material"
  admin_label VARCHAR(100) NOT NULL -- A more descriptive name for the admin panel
) ENGINE=InnoDB;

CREATE TABLE attribute_values (
  id INT AUTO_INCREMENT PRIMARY KEY,
  attribute_id INT NOT NULL,
  value VARCHAR(100) NOT NULL, -- e.g., "Red", "16GB", "Cotton"
  
  -- A value like "Red" should be unique for the "Color" attribute
  UNIQUE KEY `uq_attribute_value` (attribute_id, value), 
  
  CONSTRAINT fk_attr_values_attr FOREIGN KEY (attribute_id) REFERENCES attributes(id) ON DELETE CASCADE
) ENGINE=InnoDB;


CREATE TABLE product_attributes (
  product_id INT NOT NULL,
  attribute_value_id INT NOT NULL,
  PRIMARY KEY (product_id, attribute_value_id),
  CONSTRAINT fk_prod_attr_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_prod_attr_value FOREIGN KEY (attribute_value_id) REFERENCES attribute_values(id) ON DELETE CASCADE
) ENGINE=InnoDB;


CREATE TABLE seller_products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  
  -- The "Who" and "What"
  seller_id INT NOT NULL,     -- Foreign Key to your users/merchants table
  product_id INT NOT NULL,    -- Foreign Key to the master 'products' table
  
  -- The "How Much" (Seller's specific offer)
  sku VARCHAR(100),           -- The seller's own SKU for this item
  mrp DECIMAL(10,2) NOT NULL,
  selling_price DECIMAL(10,2) NOT NULL,
  
  -- The "Where" and "How Many"
  quantity INT NOT NULL DEFAULT 0,
  pincode VARCHAR(10) NOT NULL,
  
  -- Seller-controlled status for their own listing
  is_in_stock BOOLEAN DEFAULT TRUE,
  is_active BOOLEAN DEFAULT TRUE,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- A seller can only list a specific product once per pincode
  UNIQUE KEY `seller_product_offering` (seller_id, product_id, pincode),

  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  -- IMPORTANT: This assumes your sellers (Merchants/Retailers) have a user_id in the 'users' table
  FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;


CREATE TABLE sellers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  
  -- Polymorphic Association: Links to the source table (admins, merchants, or retailers)
  sellerable_id INT NOT NULL,
  sellerable_type ENUM('Admin', 'Merchant', 'Retailer') NOT NULL,
  
  -- Common information for all sellers
  display_name VARCHAR(255) NOT NULL, -- The name shown to customers (e.g., "Earn24 Warehouse", "Rajesh Kirana Store")
  is_active BOOLEAN DEFAULT TRUE, -- Global switch for a seller
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE KEY `idx_sellerable` (sellerable_id, sellerable_type)
) ENGINE=InnoDB;


ALTER TABLE seller_products
ADD COLUMN purchase_price DECIMAL(10, 2) NOT NULL DEFAULT 0.00 AFTER selling_price;

CREATE TABLE `app_settings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `setting_key` VARCHAR(100) NOT NULL UNIQUE COMMENT 'A unique key for the setting, e.g., profit_company_share_pct',
  `setting_value` VARCHAR(255) NOT NULL COMMENT 'The value of the setting',
  `description` TEXT COMMENT 'A human-readable explanation of what the setting does',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) COMMENT='Stores global application settings like MLM profit rules.';


CREATE TABLE `profit_distribution_ledger` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `order_item_id` INT NOT NULL COMMENT 'Links to the specific item sold in an order.',
  `user_id` INT NOT NULL COMMENT 'The user who received this profit.',
  `distribution_type` VARCHAR(50) NOT NULL COMMENT 'e.g., cashback, sponsor_bonus',
  `total_profit_on_item` DECIMAL(10, 2) NOT NULL COMMENT 'The total net profit generated by this one item.',
  `distributable_amount` DECIMAL(10, 2) NOT NULL COMMENT 'The portion of the profit available for distribution (after company share).',
  `percentage_applied` DECIMAL(5, 2) NOT NULL COMMENT 'The rule percentage applied (e.g., 15 for cashback).',
  `amount_credited` DECIMAL(10, 2) NOT NULL COMMENT 'The final cash amount credited to the user''s wallet.',
  `transaction_date` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
  -- Note: You should also have a foreign key to your `order_items` table
) COMMENT='Records every single profit distribution transaction.';

CREATE TABLE `user_business_volume` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT NOT NULL,
    `order_item_id` INT NOT NULL,
    `product_id` INT NOT NULL,
    `net_profit_base` DECIMAL(10, 2) NOT NULL COMMENT 'The net profit on which the BV was calculated.',
    `bv_earned` DECIMAL(10, 2) NOT NULL COMMENT 'The final BV points earned from this transaction.',
    `transaction_date` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `notes` VARCHAR(255) COMMENT 'e.g., "From purchase of Salt by user #123"',
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
    FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)
) COMMENT='Records every BV transaction for each user.';


CREATE TABLE `banners` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `title` VARCHAR(255) NOT NULL COMMENT 'For internal reference in the admin panel',
  `image_url` VARCHAR(255) NOT NULL,
  `link_to` VARCHAR(255) COMMENT 'Optional: link to a product, category, or offer',
  `display_order` INT DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) COMMENT='Stores promotional banners for the home screen.';

ALTER TABLE `product_categories` 
ADD COLUMN `display_order` INT NOT NULL DEFAULT 0 AFTER `is_deleted`;


ALTER TABLE `products` 
ADD COLUMN `popularity` INT NOT NULL DEFAULT 0 COMMENT 'Higher number means higher priority on home screen' AFTER `is_deleted`;

ALTER TABLE `seller_products` 
ADD COLUMN `minimum_order_quantity` INT NOT NULL DEFAULT 1 AFTER `quantity`;

CREATE TABLE `carts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL UNIQUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) COMMENT='Represents a user''s persistent shopping cart.';


CREATE TABLE `cart_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `cart_id` INT NOT NULL,
  `seller_product_id` INT NOT NULL COMMENT 'Links to the specific offer from seller_products.',
  `quantity` INT NOT NULL DEFAULT 1,
  `added_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`cart_id`) REFERENCES `carts`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`seller_product_id`) REFERENCES `seller_products`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `cart_product_unique` (`cart_id`, `seller_product_id`)
) COMMENT='Stores the items within a user''s cart.';


CREATE TABLE `user_kyc` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL UNIQUE COMMENT 'Each user has one KYC profile.',
  
  -- Identity Verification
  `pan_number` VARCHAR(10) NOT NULL UNIQUE,
  `aadhaar_number` VARCHAR(12) NOT NULL,

  -- Bank Account Details (for Payouts)
  `bank_account_holder_name` VARCHAR(255) NOT NULL COMMENT 'Name as it appears on the bank account.',
  `bank_account_number` VARCHAR(20) NOT NULL,
  `bank_ifsc_code` VARCHAR(11) NOT NULL,
  `bank_name` VARCHAR(255) NULL,
  
  -- Verification Status
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'NOT_SUBMITTED') NOT NULL DEFAULT 'NOT_SUBMITTED',
  `rejection_reason` TEXT NULL COMMENT 'Reason for rejection, provided by admin.',
  `verified_by` INT NULL COMMENT 'ID of the admin who verified the KYC.',
  `verified_at` TIMESTAMP NULL,
  
  -- Timestamps
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) COMMENT='Stores user KYC numbers, bank details, and verification status.';


CREATE TABLE `user_addresses` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  
  -- Name and Phone are REMOVED from this table. They will be fetched from the 'users' table.
  
  `address_line_1` VARCHAR(255) NOT NULL,
  `address_line_2` VARCHAR(255) NULL,
  `landmark` VARCHAR(100) NULL,
  `city` VARCHAR(100) NOT NULL,
  `state` VARCHAR(100) NOT NULL,
  `pincode` VARCHAR(10) NOT NULL,
  `address_type` VARCHAR(50) DEFAULT 'Home' COMMENT 'e.g., Home, Work, Other',
  `is_default` BOOLEAN NOT NULL DEFAULT FALSE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) COMMENT='Stores multiple shipping addresses for each user.';

CREATE TABLE `orders` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `shipping_address_id` INT NOT NULL,
  `order_number` VARCHAR(20) NOT NULL UNIQUE COMMENT 'A user-friendly order ID, e.g., ORD-20240528-1001',
  `subtotal` DECIMAL(10, 2) NOT NULL,
  `delivery_fee` DECIMAL(10, 2) NOT NULL DEFAULT 0,
  `total_amount` DECIMAL(10, 2) NOT NULL,
  `total_bv_earned` DECIMAL(10, 2) NOT NULL DEFAULT 0,
  `payment_method` VARCHAR(50) NOT NULL,
  `payment_status` ENUM('PENDING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `order_status` ENUM('PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
  FOREIGN KEY (`shipping_address_id`) REFERENCES `user_addresses`(`id`)
) COMMENT='Stores the summary of each completed order.';

CREATE TABLE `order_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `product_id` INT NOT NULL,
  `seller_product_id` INT NOT NULL,
  `product_name` VARCHAR(255) NOT NULL COMMENT 'Snapshot of product name at time of order',
  `quantity` INT NOT NULL,
  `price_per_unit` DECIMAL(10, 2) NOT NULL COMMENT 'Price of one unit at time of order',
  `total_price` DECIMAL(10, 2) NOT NULL,
  `bv_earned_per_unit` DECIMAL(10, 2) NOT NULL DEFAULT 0,
  `total_bv_earned` DECIMAL(10, 2) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE
) COMMENT='Stores the individual line items for each order.';

CREATE TABLE `delivery_agents` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `full_name` VARCHAR(255) NOT NULL,
  `phone_number` VARCHAR(15) NOT NULL UNIQUE,
  `password` VARCHAR(255) NOT NULL COMMENT 'Store a securely hashed password',
  `is_active` BOOLEAN DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) COMMENT='Stores login and details for delivery personnel.';


ALTER TABLE `orders` 
ADD COLUMN `delivery_agent_id` INT NULL AFTER `shipping_address_id`,
ADD FOREIGN KEY (`delivery_agent_id`) REFERENCES `delivery_agents`(`id`) ON DELETE SET NULL;



CREATE TABLE seller_product_pincodes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    seller_product_id INT NOT NULL,
    pincode VARCHAR(10) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- This ensures a seller can't add the same pincode twice to the same offer
    UNIQUE KEY `unique_offer_pincode` (`seller_product_id`, `pincode`),
    -- This automatically removes pincode entries if the main product offer is deleted
    FOREIGN KEY (seller_product_id) REFERENCES seller_products(id) ON DELETE CASCADE
);

CREATE TABLE `admin_notifications` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `admin_id` INT, -- Optional: to target a specific admin
  `type` VARCHAR(50) NOT NULL, -- e.g., 'low_stock', 'new_order'
  `message` TEXT NOT NULL,
  `link` VARCHAR(255), -- A URL to the relevant page, e.g., /inventory/edit/123
  `is_read` BOOLEAN NOT NULL DEFAULT FALSE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
);



-- CHanges 


-- Step 1.1: REMOVE incorrect binary columns if they existed
ALTER TABLE `users`
DROP COLUMN IF EXISTS `binary_placement_id`,
DROP COLUMN IF EXISTS `binary_position`,
DROP COLUMN IF EXISTS `left_leg_bv`,
DROP COLUMN IF EXISTS `right_leg_bv`;

-- Step 1.2: ADD and UPDATE the user table with all new columns
-- THIS IS THE FIX: Changed from MODIFY to ADD for the 'rank' column
ALTER TABLE `users` ADD COLUMN `rank` ENUM(
    'CUSTOMER', 'DISTRIBUTOR_SILVER', 'DISTRIBUTOR_GOLD', 'DISTRIBUTOR_DIAMOND',
    'LEADER', 'TEAM_LEADER', 'ASSISTANT_SUPERVISOR', 'SUPERVISOR',
    'ASSISTANT_MANAGER', 'MANAGER', 'SR_MANAGER', 'DIRECTOR'
) NOT NULL DEFAULT 'CUSTOMER' AFTER `user_type`;

ALTER TABLE `users`
ADD COLUMN `current_monthly_qualified_rank` ENUM(
    'CUSTOMER', 'DISTRIBUTOR_SILVER', 'DISTRIBUTOR_GOLD', 'DISTRIBUTOR_DIAMOND',
    'LEADER', 'TEAM_LEADER', 'ASSISTANT_SUPERVISOR', 'SUPERVISOR',
    'ASSISTANT_MANAGER', 'MANAGER', 'SR_MANAGER', 'DIRECTOR'
) NULL COMMENT 'The rank they are qualified to be paid as this month.' AFTER `rank`,
ADD COLUMN `last_purchase_date` DATE NULL COMMENT 'To track the 6-month activity rule' AFTER `current_monthly_qualified_rank`,
ADD COLUMN `aggregate_personal_bv` DECIMAL(20, 2) NOT NULL DEFAULT 0.00 COMMENT 'Total personal BV since joining' AFTER `last_purchase_date`,
ADD COLUMN `last_12_months_repurchase_bv` DECIMAL(20, 2) NOT NULL DEFAULT 0.00 COMMENT 'Rolling 12-month repurchase BV' AFTER `aggregate_personal_bv`,
ADD COLUMN `is_blocked` BOOLEAN NOT NULL DEFAULT FALSE AFTER `is_active`,
ADD COLUMN `has_graduation_degree` BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'For Director qualification' AFTER `is_blocked`;

-- Step 1.3: CREATE the monthly company pools table (if it doesn't exist)
CREATE TABLE IF NOT EXISTS `monthly_company_pools` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `year_month` INT NOT NULL COMMENT 'e.g., 202309 for Sep 2023',
    `total_company_bv` DECIMAL(20, 2) NOT NULL DEFAULT 0.00,
    `cash_back_fund` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `performance_bonus_fund` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `royalty_fund` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `binary_income_fund` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `gift_reward_fund` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `leadership_fund` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `travel_fund` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `bike_fund` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `car_fund` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `house_fund` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `insurance_fund` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `bonus_relief_fund` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `company_tour_fund` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `company_programme_fund` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `company_misc_expenses_fund` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `retailer_fund` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    UNIQUE KEY `year_month_unique` (`year_month`)
);

-- Step 1.4: CREATE the new commission ledger table (if it doesn't exist)
CREATE TABLE IF NOT EXISTS `commission_ledger` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT NOT NULL,
    `source_user_id` INT NULL COMMENT 'The user whose action generated this commission',
    `source_order_id` INT NULL,
    `commission_type` VARCHAR(50) NOT NULL COMMENT 'e.g., SELF_CASHBACK, PERFORMANCE_BONUS, ROYALTY_BONUS, TRAVEL_FUND',
    `base_bv` DECIMAL(10, 2) NOT NULL,
    `percentage_applied` DECIMAL(5, 2) NULL,
    `amount_credited` DECIMAL(10, 2) NOT NULL,
    `transaction_date` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `notes` VARCHAR(255) NULL,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
    FOREIGN KEY (`source_user_id`) REFERENCES `users`(`id`),
    FOREIGN KEY (`source_order_id`) REFERENCES `orders`(`id`)
);
