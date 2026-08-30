/**
 * OMS Prisma @@map 实际表名（Linux MySQL 区分大小写，须用小写）。
 * @see oms/prisma/schema.prisma
 */
export const OMS_TABLE = {
  customerAccount: 'oms_customeraccount',
  billingAccount: 'oms_billingaccount',
  portalUser: 'oms_portaluser',
  inventoryItem: 'oms_inventoryitem',
  product: 'oms_product',
  inboundOrder: 'oms_inboundorder',
  outboundOrder: 'oms_outboundorder',
  returnOrder: 'oms_returnorder',
  order: 'oms_order',
  feeRecord: 'oms_feerecord',
  storeAccount: 'oms_storeaccount',
  platformSkuMapping: 'oms_platformskumapping',
  logisticsRecord: 'oms_logisticsrecord',
  qcReport: 'oms_qcreport',
  systemMessage: 'oms_systemmessage',
  webhookEvent: 'oms_webhookevent',
  announcement: 'oms_announcement',
  priceTemplate: 'oms_pricetemplate',
  storageRentTemplate: 'oms_storagerenttemplate',
  regionDispatchRule: 'oms_regiondispatchrule',
  catalogPurchase: 'oms_catalogpurchase',
  paymentMethod: 'oms_paymentmethod',
  codeMapping: 'oms_codemapping',
} as const
