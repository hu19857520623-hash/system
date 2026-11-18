CREATE TABLE IF NOT EXISTS `daily_business_code` (
  `prefix` VARCHAR(3) NOT NULL,
  `business_date` CHAR(8) NOT NULL,
  `current_serial` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`prefix`, `business_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
