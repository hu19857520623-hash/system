ALTER TABLE product
  ADD COLUMN measured_length_cm DECIMAL(8, 2) NULL AFTER height_cm,
  ADD COLUMN measured_width_cm DECIMAL(8, 2) NULL AFTER measured_length_cm,
  ADD COLUMN measured_height_cm DECIMAL(8, 2) NULL AFTER measured_width_cm,
  ADD COLUMN measured_at DATETIME NULL AFTER measured_height_cm;
