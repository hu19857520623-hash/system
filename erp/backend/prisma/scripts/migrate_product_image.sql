-- 商品多图：product_image 表
CREATE TABLE IF NOT EXISTS product_image (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT NOT NULL,
  image_url VARCHAR(500) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_product_image_product (product_id),
  CONSTRAINT fk_product_image_product FOREIGN KEY (product_id) REFERENCES product(id) ON DELETE CASCADE
);
