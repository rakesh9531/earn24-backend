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
  is_default_chain TINYINT(1) DEFAULT 0,
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
  status ENUM('PENDING', 'APPROVED', 'REJECTED') DEFAULT 'PENDING',
  bank_details_snapshot JSON NOT NULL COMMENT 'Snapshot of approved bank info at the time of request',
  utr_number VARCHAR(100) NULL COMMENT 'Bank transaction ID entered by Admin on approval',
  admin_remarks TEXT NULL COMMENT 'Rejection reason or approval notes',
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
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
    `bv_type` ENUM('SELF', 'DOWNLINE') NOT NULL DEFAULT 'SELF',
    `source_user_id` INT DEFAULT NULL,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
    FOREIGN KEY (`product_id`) REFERENCES `products`(`id`),
    FOREIGN KEY (`source_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
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





-- Payment gateway --

CREATE TABLE payment_gateway_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    gateway_name VARCHAR(50) NOT NULL, -- e.g., 'razorpay', 'phonepe'
    is_active BOOLEAN DEFAULT 0,
    encrypted_config TEXT NOT NULL,    -- Stores API keys encrypted
    encryption_iv VARCHAR(255) NOT NULL, -- Needed to decrypt
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Optional: Table to track payment attempts if you don't have one
CREATE TABLE payment_transactions (
    transaction_id VARCHAR(100) PRIMARY KEY,
    user_id INT,
    amount DECIMAL(10,2),
    gateway VARCHAR(50),
    status VARCHAR(20) DEFAULT 'PENDING', -- PENDING, SUCCESS, FAILED
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


--OTP --


-- 1. Table to track OTP limits and blocking
CREATE TABLE otp_records (
    mobile_number VARCHAR(15) PRIMARY KEY,
    otp_code VARCHAR(6),
    attempts_count INT DEFAULT 0, -- Tracks daily attempts
    is_blocked BOOLEAN DEFAULT 0,
    blocked_until TIMESTAMP NULL,
    last_sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Temporary table to hold user data until they verify OTP
CREATE TABLE temp_registrations (
    mobile_number VARCHAR(15) PRIMARY KEY,
    user_data JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NULL 
);



---  Retailers logic start

CREATE TABLE retailers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shop_name VARCHAR(255) NOT NULL,
  owner_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone_number VARCHAR(20) NOT NULL,
  password VARCHAR(255) NOT NULL,
  shop_address TEXT,
  pincode VARCHAR(10) NOT NULL,
  gst_number VARCHAR(50),
  pan_number VARCHAR(50),
  -- 'admin_approval_status' handles the onboarding flow
  admin_approval_status ENUM('PENDING', 'APPROVED', 'REJECTED') DEFAULT 'APPROVED', 
  -- 'is_active' handles the Login permission (Block/Unblock)
  is_active TINYINT DEFAULT 1, 
  is_deleted TINYINT DEFAULT 0,
  created_at DATETIME,
  updated_at DATETIME,
  
  -- Performance Indexes
  UNIQUE KEY unique_email (email),
  UNIQUE KEY unique_phone (phone_number),
  INDEX idx_search (shop_name, owner_name, phone_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;



----------


CREATE TABLE retailer_inventory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  retailer_id INT NOT NULL,
  product_id INT NOT NULL, -- Links to your main 'products' table
  
  stock_quantity INT DEFAULT 0,
  selling_price DECIMAL(10, 2) NOT NULL, -- Retailer might sell at different price than MRP
  is_active TINYINT DEFAULT 1,
  
  created_at DATETIME,
  updated_at DATETIME,

  FOREIGN KEY (retailer_id) REFERENCES retailers(id) ON DELETE CASCADE,
  -- Assuming your master product table is named 'products'
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE, 
  
  -- Ensure a retailer cannot add the same product twice
  UNIQUE KEY unique_retailer_product (retailer_id, product_id) 
);



CREATE TABLE retailer_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  retailer_id INT NOT NULL,
  user_id INT NULL, 
  customer_name VARCHAR(100),
  customer_mobile VARCHAR(20),
  
  total_amount DECIMAL(10, 2) NOT NULL,
  payment_mode ENUM('CASH', 'ONLINE', 'UPI') DEFAULT 'CASH',
  payment_status ENUM('PAID', 'PENDING') DEFAULT 'PAID',
  
  created_at DATETIME,
  FOREIGN KEY (retailer_id) REFERENCES retailers(id) ON DELETE CASCADE
);

CREATE TABLE retailer_order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL,
  price DECIMAL(10, 2) NOT NULL, -- Price at moment of sale
  total DECIMAL(10, 2) NOT NULL,
  
  FOREIGN KEY (order_id) REFERENCES retailer_orders(id) ON DELETE CASCADE
);



ALTER TABLE retailer_order_items 
ADD COLUMN bv_earned DECIMAL(10, 2) DEFAULT 0,
ADD COLUMN total_bv DECIMAL(10, 2) DEFAULT 0;


-- 1. Add 'total_bv' to the main Orders table (Fixes your current error)
ALTER TABLE retailer_orders 
ADD COLUMN total_bv DECIMAL(10,2) DEFAULT 0 AFTER payment_status;

-- 2. Add BV columns to the Items table (Prevents the next error)
ALTER TABLE retailer_order_items 
ADD COLUMN bv_earned DECIMAL(10,2) DEFAULT 0,
ADD COLUMN total_bv DECIMAL(10,2) DEFAULT 0;


ALTER TABLE retailer_order_items 
ADD COLUMN returned_quantity INT DEFAULT 0;



ALTER TABLE orders MODIFY COLUMN order_status VARCHAR(50) DEFAULT 'PENDING';
ALTER TABLE orders MODIFY COLUMN payment_status VARCHAR(50) DEFAULT 'PENDING';



ALTER TABLE payment_transactions ADD COLUMN order_id INT NULL;






-------------------------------------------------------------------------------




ALTER TABLE orders 
ADD COLUMN delivery_otp VARCHAR(6) NULL AFTER order_status,
ADD COLUMN delivery_payment_mode VARCHAR(20) NULL AFTER delivery_otp,
ADD COLUMN delivery_amount_collected DECIMAL(10,2) DEFAULT 0.00 AFTER delivery_payment_mode,
ADD COLUMN delivered_at TIMESTAMP NULL AFTER delivery_amount_collected;


------------------------------------------------------------------------------------


CREATE TABLE shipping_addresses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    address_line_1 VARCHAR(255) NOT NULL,
    address_line_2 VARCHAR(255) NULL,
    landmark VARCHAR(100) NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    pincode VARCHAR(10) NOT NULL,
    address_type ENUM('HOME', 'WORK', 'OTHER') DEFAULT 'HOME',
    is_default TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);






----------------   Add Attribute--------------------


ALTER TABLE order_items 
ADD COLUMN attributes_snapshot JSON NULL AFTER product_name;





-------------------------------------------------------------


-- 1. First, let's add the basic delivery handshake columns that were missing
ALTER TABLE orders 
ADD COLUMN delivery_otp VARCHAR(6) NULL AFTER order_status,
ADD COLUMN delivery_payment_mode VARCHAR(20) NULL AFTER delivery_otp,
ADD COLUMN delivery_amount_collected DECIMAL(10,2) DEFAULT 0.00 AFTER delivery_payment_mode,
ADD COLUMN delivered_at TIMESTAMP NULL AFTER delivery_amount_collected;

-- 2. Now, add the Cash Settlement columns for the Admin verification
ALTER TABLE orders 
ADD COLUMN is_cash_settled TINYINT(1) DEFAULT 0 AFTER delivered_at,
ADD COLUMN cash_settled_at TIMESTAMP NULL AFTER is_cash_settled,
ADD COLUMN settled_by_admin_id INT NULL AFTER cash_settled_at;

-- 3. (Optional but Recommended) Link the admin ID to the users table
ALTER TABLE orders
ADD CONSTRAINT fk_settled_by_admin
FOREIGN KEY (settled_by_admin_id) REFERENCES users(id);



CREATE TABLE admin_settlement_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    admin_id INT NOT NULL,
    agent_id INT NOT NULL,
    order_id INT NOT NULL,
    amount_received DECIMAL(10,2) NOT NULL,
    remarks TEXT,
    settled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);



-------------------------------------------------------------------------------------


CREATE TABLE app_pages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    page_key VARCHAR(50) UNIQUE NOT NULL, 
    title VARCHAR(100) NOT NULL,
    content LONGTEXT NOT NULL,            
    target_app ENUM('USER_APP', 'AGENT_APP', 'BOTH') DEFAULT 'BOTH',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insert starting data
INSERT INTO app_pages (page_key, title, content, target_app) VALUES 
('privacy_policy', 'Privacy Policy', '<h1>Privacy Policy</h1><p>Standard policy...</p>', 'BOTH'),
('terms_conditions', 'Terms & Conditions', '<h1>Terms</h1><p>Standard terms...</p>', 'BOTH'),
('about_us', 'About Earn24', '<h1>About Us</h1><p>Company info...</p>', 'USER_APP'),
('agent_manual', 'Agent Guidelines', '<h1>Guidelines</h1><p>How to deliver...</p>', 'AGENT_APP'),
('contact_us', 'Contact Support', '<h3>Email: support@earn24.in</h3>', 'BOTH');


-------------------------------------------


-- npm install ngx-quill quill --save --legacy-peer-deps  admin panel install



-------        npm install ngx-quill@16.2.1 quill@1.3.7 --save --legacy-peer-deps


-------   npm install @types/quill@1.3.10 --save-dev --legacy-peer-deps





-------------   npm install chart.js


----------------------------------------------------------------------------------------------------------------------



CREATE TABLE IF NOT EXISTS web_landing_content (
    id INT PRIMARY KEY DEFAULT 1,
    app_name VARCHAR(255) NOT NULL,
    page_title VARCHAR(255) NOT NULL,
    page_description TEXT NOT NULL,
    download_link VARCHAR(255),
    main_image_url VARCHAR(255),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS web_landing_gallery (
    id INT PRIMARY KEY AUTO_INCREMENT,
    image_url VARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Crucial: The controller uses UPDATE...WHERE id=1, so we must have a row 1
INSERT IGNORE INTO web_landing_content (id, app_name, page_title, page_description, download_link) 
VALUES (1, 'My App', 'Welcome', 'Description...', 'https://google.com');







-------------------MLM START LOGIC(ANTY)--------------------------------------


-- 1. App Settings Update/Insert
INSERT INTO `app_settings` (`setting_key`, `setting_value`, `description`) VALUES 
('profit_dist_cashback_pct', '29.0', 'Instant Cash Back to Buyer (All)'),
('profit_dist_performance_bonus_pct', '4.5', 'Performance Bonus Fund for all'),
('profit_dist_royalty_pct', '2.0', 'Royalty Fund for Diamond and above'),
('profit_dist_binary_income_pct', '15.0', 'Binary Income Fund for Distributors'),
('profit_dist_gift_reward_pct', '4.0', 'Gift / Reward Fund for all'),
('profit_dist_leadership_pct', '2.0', 'Leadership Fund for Leaders and above'),
('profit_dist_travel_pct', '2.0', 'Travel Fund for Team Leaders and above'),
('profit_dist_bike_pct', '2.0', 'Bike Fund for Assistant Supervisors and above'),
('profit_dist_car_pct', '2.0', 'Car Fund for Supervisors and above'),
('profit_dist_house_pct', '2.0', 'House Fund for Assistant Managers and above'),
('profit_dist_insurance_pct', '5.0', 'Insurance Fund for Managers and above'),
('profit_dist_bonus_relief_pct', '2.0', 'Bonus / Relief Fund for Sr. Managers and Directors'),
('profit_dist_company_tour_pct', '10.0', 'Company Tour Fund for Supervisors and above'),
('profit_dist_company_programme_pct', '10.0', 'Company Programme / Seminar Fund for all'),
('profit_dist_misc_expenses_pct', '0.5', 'Company Miscellaneous Expenses Fund'),
('profit_dist_retailer_merchandise_pct', '7.5', 'Retailer Merchandise Fund for anyone')
ON DUPLICATE KEY UPDATE 
`setting_value` = VALUES(`setting_value`), 
`description` = VALUES(`description`);

-- 2. Monthly Pools Update (Only add if they don't exist)
-- Note: MySQL simple version doesn't support ADD COLUMN IF NOT EXISTS directly.
-- In columns ko check kar lijiye agar aapke table mein nahi hain toh ye run karen:

ALTER TABLE `monthly_company_pools` 
ADD COLUMN IF NOT EXISTS `binary_income_fund` DECIMAL(15,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS `gift_reward_fund` DECIMAL(15,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS `leadership_fund` DECIMAL(15,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS `travel_fund` DECIMAL(15,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS `bike_fund` DECIMAL(15,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS `car_fund` DECIMAL(15,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS `house_fund` DECIMAL(15,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS `insurance_fund` DECIMAL(15,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS `bonus_relief_fund` DECIMAL(15,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS `company_tour_fund` DECIMAL(15,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS `company_programme_fund` DECIMAL(15,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS `company_misc_expenses_fund` DECIMAL(15,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS `retailer_fund` DECIMAL(15,2) DEFAULT 0.00;

-------------------------------------

ALTER TABLE sellers ADD COLUMN gstin VARCHAR(15) NULL, ADD COLUMN address TEXT NULL;
-- Ab Admin (id=1) ke aage ye details bhar dein DBeaver mein.

-- Admin (id=1) ke liye dummy data update karein
UPDATE sellers 
SET gstin = '07AAAAA0000A1Z5', 
    address = 'Earn24 Corporate Hub, Block-B, 4th Floor, Connaught Place, New Delhi - 110001' 
WHERE id = 1;

-- Agar koi aur sellers hain, unke liye ek general update (optional):
UPDATE sellers 
SET gstin = '27ABCDE1234F1Z1', 
    address = 'Seller Distribution Center, Industrial Area, Noida, UP' 
WHERE id > 1 AND gstin IS NULL;

-------------------------------------------------------------------


/* Orders table mein rejection details track karne ke liye */
ALTER TABLE orders 
ADD COLUMN rejection_reason TEXT NULL, 
ADD COLUMN last_rejected_by_agent_id INT NULL;


CREATE TABLE IF NOT EXISTS `user_favorites` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `product_id` INT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_user_product_fav` (`user_id`, `product_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;




----------------------------------------------------------------

-- Foreign Key checks ko temporarily disable karein (errors se bachne ke liye)
SET FOREIGN_KEY_CHECKS = 0;

-- 1. Truncate/Clear all transaction, ledger and orders tables
TRUNCATE TABLE user_binary_bv_entries;
TRUNCATE TABLE binary_matching_payouts;
TRUNCATE TABLE commission_ledger;
TRUNCATE TABLE user_business_volume;
TRUNCATE TABLE profit_distribution_ledger;
TRUNCATE TABLE order_items;
TRUNCATE TABLE user_wallet_transactions;
TRUNCATE TABLE user_favorites;
TRUNCATE TABLE user_addresses;
DELETE FROM orders;

-- 2. Wallets clear karke sirf Admin aur Mohd ka fresh wallet create karein
TRUNCATE TABLE user_wallets;
INSERT INTO user_wallets (user_id, balance) VALUES (1, 0.00), (12, 0.00);

-- 3. Users ka data clean karein (Mohd ID 12 aur Admin ID 1 ko chhodkar baki sab delete karein)
DELETE FROM users WHERE id NOT IN (1, 12);

-- 4. Mohd (ID 12) ke binary parameters aur accumulated BV ko fresh 0 par reset karein
UPDATE users 
SET binary_placement_id = NULL, 
    binary_position = NULL, 
    left_leg_bv = 0.00, 
    right_leg_bv = 0.00, 
    total_matched_bv = 0.00, 
    binary_level_matched = 0 
WHERE id = 12;

-- Foreign Key checks ko wapas enable karein
SET FOREIGN_KEY_CHECKS = 1;



-------------------------------------------



-- Foreign Key checks ko temporarily disable karein
SET FOREIGN_KEY_CHECKS = 0;

-- 1. Sabhi transactions, ledgers, wallets aur orders tables ko empty karein
TRUNCATE TABLE user_binary_bv_entries;
TRUNCATE TABLE binary_matching_payouts;
TRUNCATE TABLE commission_ledger;
TRUNCATE TABLE user_business_volume;
TRUNCATE TABLE profit_distribution_ledger;
TRUNCATE TABLE order_items;
TRUNCATE TABLE user_wallet_transactions;
TRUNCATE TABLE user_favorites;
TRUNCATE TABLE user_addresses;
TRUNCATE TABLE user_wallets;
DELETE FROM orders;

-- 2. Users table ko completely empty karein
TRUNCATE TABLE users;

-- Foreign Key checks ko wapas enable karein
SET FOREIGN_KEY_CHECKS = 1;


---------------------------------------------------------

-- Foreign Key checks ko temporarily disable karein
SET FOREIGN_KEY_CHECKS = 0;

-- 1. Sabhi transactions, ledgers, wallets aur orders tables ko empty karein
TRUNCATE TABLE user_binary_bv_entries;
TRUNCATE TABLE binary_matching_payouts;
TRUNCATE TABLE commission_ledger;
TRUNCATE TABLE user_business_volume;
TRUNCATE TABLE profit_distribution_ledger;
TRUNCATE TABLE order_items;
TRUNCATE TABLE user_wallet_transactions;
TRUNCATE TABLE user_favorites;
TRUNCATE TABLE user_addresses;
TRUNCATE TABLE user_wallets;
DELETE FROM orders;

-- 2. Users table ko completely empty karein
TRUNCATE TABLE users;

-- Foreign Key checks ko wapas enable karein
SET FOREIGN_KEY_CHECKS = 1;




------------------------------------


-- 1. Add is_default_chain column to track default-routed registrations
ALTER TABLE users ADD COLUMN is_default_chain TINYINT(1) DEFAULT 0;

-- 2. Initialize the first root user as the start of the default chain
UPDATE users SET is_default_chain = 1 WHERE id = (SELECT id FROM (SELECT id FROM users ORDER BY id ASC LIMIT 1) as tmp);

-- 3. Add leg_user_id column to track direct frontline legs for BV entries
ALTER TABLE user_binary_bv_entries ADD COLUMN leg_user_id INT NULL AFTER source_user_id;

-- 4. Create indexes to optimize multi-leg matching lookup performance
ALTER TABLE user_binary_bv_entries ADD INDEX idx_user_leg_depth (user_id, leg_user_id, depth);

-- 5. Add last_rank_promoted_at column to track user rank promotion timestamps
ALTER TABLE users ADD COLUMN last_rank_promoted_at TIMESTAMP NULL DEFAULT NULL COMMENT 'Date when user was promoted to current rank' AFTER `rank`;
UPDATE users SET last_rank_promoted_at = created_at WHERE last_rank_promoted_at IS NULL;

-- 6. Add fund distribution columns to track payment counts and qualifying sponsor JSON metadata
ALTER TABLE users ADD COLUMN bike_fund_months_paid INT DEFAULT 0;
ALTER TABLE users ADD COLUMN car_fund_months_paid INT DEFAULT 0;
ALTER TABLE users ADD COLUMN house_fund_months_paid INT DEFAULT 0;
ALTER TABLE users ADD COLUMN qualifying_sponsor_ids JSON NULL;

-- 7. Create reward_claims table to manage fund distribution requests
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
);

ALTER TABLE reward_claims ADD INDEX idx_user_status (user_id, status);



--------------------KYC--------------------------------


-- =====================================================
-- KYC Document Upload Columns Migration
-- Run on: earn24 production/staging database
-- Table: user_kyc
-- =====================================================

-- Step 1: Check if columns already exist (optional safety check)
SELECT COLUMN_NAME 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'user_kyc' 
AND TABLE_SCHEMA = DATABASE()
AND COLUMN_NAME IN ('pan_card_doc', 'aadhaar_card_doc', 'bank_passbook_doc');

-- Step 2: Add document path columns (run only if above query returns 0 rows)
ALTER TABLE `user_kyc`
  ADD COLUMN `pan_card_doc` VARCHAR(500) NULL 
    COMMENT 'Server path to uploaded PAN Card image' 
    AFTER `bank_name`,
    
  ADD COLUMN `aadhaar_card_doc` VARCHAR(500) NULL 
    COMMENT 'Server path to uploaded Aadhaar Card image' 
    AFTER `pan_card_doc`,
    
  ADD COLUMN `bank_passbook_doc` VARCHAR(500) NULL 
    COMMENT 'Server path to uploaded Bank Passbook/Cheque image' 
    AFTER `aadhaar_card_doc`;

-- Step 3: Verify columns added successfully
SHOW COLUMNS FROM `user_kyc` LIKE '%doc%';


-- =====================================================
-- Multi-Vendor, Universal Pincode & Order Returns Schema Migration
-- =====================================================

-- 1. Universal Pincode flag on products table
ALTER TABLE `products` ADD COLUMN `is_universal_pincode` TINYINT(1) DEFAULT 0 COMMENT '1 = Pan-India Universal product, 0 = Pincode restricted';

-- 2. Merchant pricing & Admin margin on seller_products table
ALTER TABLE `seller_products` 
  ADD COLUMN `merchant_price` DECIMAL(15,2) NULL COMMENT 'Original price set by merchant',
  ADD COLUMN `admin_margin_percent` DECIMAL(5,2) DEFAULT 10.00 COMMENT 'Admin margin percentage added to user price';

-- 3. Serviceable pincodes list on delivery_agents table
ALTER TABLE `delivery_agents` ADD COLUMN `serviceable_pincodes` TEXT NULL COMMENT 'Comma separated list of operating pincodes';

-- 4. Merchant Document Uploads
ALTER TABLE `merchants`
  ADD COLUMN `pan_card_doc` VARCHAR(500) NULL COMMENT 'Uploaded PAN Document Path',
  ADD COLUMN `gst_cert_doc` VARCHAR(500) NULL COMMENT 'Uploaded GST Certificate Path',
  ADD COLUMN `bank_passbook_doc` VARCHAR(500) NULL COMMENT 'Uploaded Passbook/Cheque Path';

-- 5. Create order_returns table for Return & Replacement workflow
CREATE TABLE IF NOT EXISTS `order_returns` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `order_item_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `merchant_id` INT NOT NULL,
  `return_type` ENUM('RETURN', 'REPLACEMENT') NOT NULL DEFAULT 'RETURN',
  `reason` TEXT NOT NULL,
  `images_json` JSON NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'PICKUP_INITIATED', 'RECEIVED_BY_MERCHANT', 'COMPLETED') DEFAULT 'PENDING',
  `courier_tracking_id` VARCHAR(100) NULL,
  `refund_amount` DECIMAL(15,2) DEFAULT 0.00,
  `admin_notes` TEXT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

