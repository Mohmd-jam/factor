-- ============================================================================
--  فاکتورینو (Factorino) v3.0 — اسکیمای پایگاه داده
--  MySQL 5.7+ / MariaDB 10.3+
--  Charset: utf8mb4 (پشتیبانی کامل از فارسی و ایموجی)
--
--  اجرا:
--    mysql -u root -p < database/schema.sql
--  یا در phpMyAdmin: Import  →  انتخاب همین فایل
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION';

CREATE DATABASE IF NOT EXISTS `factorino_db`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `factorino_db`;

-- ---------------------------------------------------------------------------
-- 1) کاربران
--    role = 'admin'  → دسترسی کامل به پنل مدیریت
--    role = 'user'   → کاربر عادی (صاحب کسب‌وکار)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`            CHAR(36)        NOT NULL,
  `email`           VARCHAR(190)    NOT NULL,
  `password_hash`   VARCHAR(255)    NOT NULL,
  `business_name`   VARCHAR(150)    NOT NULL,
  `owner_name`      VARCHAR(150)         NULL DEFAULT NULL,
  `phone`           VARCHAR(30)          NULL DEFAULT NULL,
  `role`            ENUM('user','admin') NOT NULL DEFAULT 'user',
  `status`          ENUM('active','suspended') NOT NULL DEFAULT 'active',
  `note`            VARCHAR(255)         NULL DEFAULT NULL COMMENT 'یادداشت داخلی ادمین',
  `failed_attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `locked_until`    DATETIME             NULL DEFAULT NULL,
  `last_login_at`   DATETIME             NULL DEFAULT NULL,
  `last_login_ip`   VARCHAR(45)          NULL DEFAULT NULL,
  `password_changed_at` DATETIME         NULL DEFAULT NULL,
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`      DATETIME             NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  UNIQUE KEY `uq_users_uuid`  (`uuid`),
  KEY `idx_users_role_status` (`role`, `status`),
  KEY `idx_users_created`     (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2) نشست‌ها (توکن‌های ورود)
--    توکن هرگز به صورت خام ذخیره نمی‌شود؛ فقط SHA-256 آن.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `sessions`;
CREATE TABLE `sessions` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`      BIGINT UNSIGNED NOT NULL,
  `token_hash`   CHAR(64)        NOT NULL COMMENT 'sha256(token)',
  `scope`        ENUM('app','admin') NOT NULL DEFAULT 'app',
  `ip`           VARCHAR(45)          NULL DEFAULT NULL,
  `user_agent`   VARCHAR(255)         NULL DEFAULT NULL,
  `created_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at`   DATETIME        NOT NULL,
  `revoked_at`   DATETIME             NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sessions_token` (`token_hash`),
  KEY `idx_sessions_user`    (`user_id`, `revoked_at`),
  KEY `idx_sessions_expires` (`expires_at`),
  CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3) تلاش‌های ورود (محدودسازی نرخ / Brute-force)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `login_attempts`;
CREATE TABLE `login_attempts` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email`      VARCHAR(190)         NULL DEFAULT NULL,
  `ip`         VARCHAR(45)     NOT NULL,
  `success`    TINYINT(1)      NOT NULL DEFAULT 0,
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_attempts_ip_time`    (`ip`, `created_at`),
  KEY `idx_attempts_email_time` (`email`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4) تنظیمات هر کاربر (سربرگ فاکتور، شماره‌گذاری، واحد پول ...)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `user_settings`;
CREATE TABLE `user_settings` (
  `user_id`             BIGINT UNSIGNED NOT NULL,
  `business_name`       VARCHAR(150)    NOT NULL DEFAULT '',
  `owner_name`          VARCHAR(150)    NOT NULL DEFAULT '',
  `phone`               VARCHAR(30)     NOT NULL DEFAULT '',
  `tax_id`              VARCHAR(30)     NOT NULL DEFAULT '',
  `email`               VARCHAR(190)    NOT NULL DEFAULT '',
  `address`             VARCHAR(400)    NOT NULL DEFAULT '',
  `logo`                MEDIUMTEXT           NULL DEFAULT NULL COMMENT 'data:image/... base64 (حداکثر ~1MB)',
  `invoice_prefix`      VARCHAR(12)     NOT NULL DEFAULT 'INV-',
  `next_invoice_number` INT UNSIGNED    NOT NULL DEFAULT 1,
  `currency`            VARCHAR(20)     NOT NULL DEFAULT 'تومان',
  `tax_percent`         DECIMAL(5,2)    NOT NULL DEFAULT 0.00,
  `invoice_footer`      VARCHAR(400)    NOT NULL DEFAULT '',
  `voice_enabled`       TINYINT(1)      NOT NULL DEFAULT 1,
  `updated_at`          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_settings_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 5) محصولات
--    uuid توسط کلاینت ساخته می‌شود تا همگام‌سازی آفلاین بدون تداخل انجام شود.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `products`;
CREATE TABLE `products` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`       VARCHAR(64)     NOT NULL,
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `name`       VARCHAR(120)    NOT NULL,
  `sku`        VARCHAR(40)     NOT NULL DEFAULT '',
  `category`   VARCHAR(60)     NOT NULL DEFAULT '',
  `unit`       VARCHAR(20)     NOT NULL DEFAULT 'عدد',
  `price`      DECIMAL(14,2)   NOT NULL DEFAULT 0.00,
  `aliases`    VARCHAR(255)    NOT NULL DEFAULT '' COMMENT 'نام‌های جایگزین برای تشخیص صدا، جدا شده با ویرگول',
  `is_active`  TINYINT(1)      NOT NULL DEFAULT 1,
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME             NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_products_user_uuid` (`user_id`, `uuid`),
  KEY `idx_products_user_name` (`user_id`, `name`),
  KEY `idx_products_updated`   (`user_id`, `updated_at`),
  CONSTRAINT `fk_products_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 6) مشتری‌ها
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `customers`;
CREATE TABLE `customers` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`        VARCHAR(64)     NOT NULL,
  `user_id`     BIGINT UNSIGNED NOT NULL,
  `name`        VARCHAR(150)    NOT NULL,
  `phone`       VARCHAR(30)     NOT NULL DEFAULT '',
  `tax_id`      VARCHAR(30)     NOT NULL DEFAULT '',
  `city`        VARCHAR(60)     NOT NULL DEFAULT '',
  `postal_code` VARCHAR(20)     NOT NULL DEFAULT '',
  `address`     VARCHAR(400)    NOT NULL DEFAULT '',
  `note`        VARCHAR(255)    NOT NULL DEFAULT '',
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`  DATETIME             NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customers_user_uuid` (`user_id`, `uuid`),
  KEY `idx_customers_user_name` (`user_id`, `name`),
  KEY `idx_customers_updated`   (`user_id`, `updated_at`),
  CONSTRAINT `fk_customers_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 7) فاکتورها
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `invoices`;
CREATE TABLE `invoices` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`           VARCHAR(64)     NOT NULL,
  `user_id`        BIGINT UNSIGNED NOT NULL,
  `number`         VARCHAR(40)     NOT NULL,
  `customer_uuid`  VARCHAR(64)     NOT NULL DEFAULT '',
  `customer_name`  VARCHAR(150)    NOT NULL DEFAULT '',
  `place`          VARCHAR(255)    NOT NULL DEFAULT '',
  `issue_date`     DATE            NOT NULL,
  `status`         ENUM('draft','final')            NOT NULL DEFAULT 'final',
  `payment_status` ENUM('unpaid','partial','paid')  NOT NULL DEFAULT 'unpaid',
  `subtotal`       DECIMAL(14,2)   NOT NULL DEFAULT 0.00,
  `discount`       DECIMAL(14,2)   NOT NULL DEFAULT 0.00,
  `tax_percent`    DECIMAL(5,2)    NOT NULL DEFAULT 0.00,
  `tax_amount`     DECIMAL(14,2)   NOT NULL DEFAULT 0.00,
  `shipping`       DECIMAL(14,2)   NOT NULL DEFAULT 0.00,
  `total`          DECIMAL(14,2)   NOT NULL DEFAULT 0.00,
  `notes`          VARCHAR(500)    NOT NULL DEFAULT '',
  `created_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`     DATETIME             NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_invoices_user_uuid` (`user_id`, `uuid`),
  KEY `idx_invoices_user_date`   (`user_id`, `issue_date`),
  KEY `idx_invoices_user_status` (`user_id`, `status`, `payment_status`),
  KEY `idx_invoices_number`      (`user_id`, `number`),
  KEY `idx_invoices_updated`     (`user_id`, `updated_at`),
  CONSTRAINT `fk_invoices_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 8) اقلام فاکتور
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `invoice_items`;
CREATE TABLE `invoice_items` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `invoice_id`   BIGINT UNSIGNED NOT NULL,
  `product_uuid` VARCHAR(64)     NOT NULL DEFAULT '',
  `name`         VARCHAR(150)    NOT NULL,
  `unit`         VARCHAR(20)     NOT NULL DEFAULT 'عدد',
  `unit_price`   DECIMAL(14,2)   NOT NULL DEFAULT 0.00,
  `qty`          DECIMAL(12,3)   NOT NULL DEFAULT 1.000,
  `discount`     DECIMAL(14,2)   NOT NULL DEFAULT 0.00,
  `line_total`   DECIMAL(14,2)   NOT NULL DEFAULT 0.00,
  `sort_order`   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_items_invoice` (`invoice_id`, `sort_order`),
  KEY `idx_items_product` (`product_uuid`),
  CONSTRAINT `fk_items_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 9) گزارش رویدادها (audit log) — برای نظارت ادمین
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `activity_logs`;
CREATE TABLE `activity_logs` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    BIGINT UNSIGNED      NULL DEFAULT NULL COMMENT 'کاربری که رویداد برای اوست',
  `actor_id`   BIGINT UNSIGNED      NULL DEFAULT NULL COMMENT 'انجام‌دهنده (ادمین یا خود کاربر)',
  `action`     VARCHAR(60)     NOT NULL,
  `entity`     VARCHAR(40)     NOT NULL DEFAULT '',
  `entity_id`  VARCHAR(64)     NOT NULL DEFAULT '',
  `message`    VARCHAR(400)    NOT NULL DEFAULT '',
  `ip`         VARCHAR(45)     NOT NULL DEFAULT '',
  `user_agent` VARCHAR(255)    NOT NULL DEFAULT '',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_logs_user_time`   (`user_id`, `created_at`),
  KEY `idx_logs_action_time` (`action`, `created_at`),
  CONSTRAINT `fk_logs_user`  FOREIGN KEY (`user_id`)  REFERENCES `users`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_logs_actor` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 10) تنظیمات کلی برنامه (کنترل‌شده از پنل ادمین)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `app_settings`;
CREATE TABLE `app_settings` (
  `key`        VARCHAR(80)  NOT NULL,
  `value`      TEXT             NULL,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `app_settings` (`key`, `value`) VALUES
  ('app_name',            'فاکتورینو'),
  ('registration_open',   '1'),
  ('maintenance_mode',    '0'),
  ('max_products_per_user', '5000'),
  ('max_invoices_per_user', '100000'),
  ('announcement',        '')
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`);

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================================
--  حساب ادمین چگونه ساخته می‌شود؟
--  با باز کردن install.php در مرورگر (روش امن و پیشنهادی) — رمز را خودتان
--  انتخاب می‌کنید و هش bcrypt ساخته می‌شود.
--
--  اگر ترجیح می‌دهید دستی بسازید، هش را با این دستور بگیرید:
--     php -r "echo password_hash('رمز-دلخواه', PASSWORD_BCRYPT), PHP_EOL;"
--  و سپس:
--
--  INSERT INTO `users` (`uuid`,`email`,`password_hash`,`business_name`,`role`,`status`)
--  VALUES (UUID(), 'admin@example.com', '$2y$10$...هش...', 'مدیر سیستم', 'admin', 'active');
--  INSERT INTO `user_settings` (`user_id`,`business_name`)
--  VALUES (LAST_INSERT_ID(), 'مدیر سیستم');
-- ============================================================================
