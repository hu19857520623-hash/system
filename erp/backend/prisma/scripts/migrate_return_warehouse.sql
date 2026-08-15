-- 退件单：增加退件仓库（JHB3 / CPT2 / DBN）
ALTER TABLE return_order
  ADD COLUMN return_warehouse VARCHAR(20) NULL AFTER seller_tax_no;

ALTER TABLE oms_ReturnOrder
  ADD COLUMN returnWarehouse VARCHAR(20) NULL AFTER sellerTaxNo;
