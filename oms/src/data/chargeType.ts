/** ERP billing_charge.charge_type → OMS FeeRecord.type */

export const FEE_TYPE_LABELS: Record<string, string> = {
  storage: '仓储费',
  handling: '操作费',
  shipping: '物流费',
  relabel: '换标费',
  picking: '拣货费',
  inspection: '质检费',
  other: '其他费用',
  recharge: '充值',
  catalog_purchase: '货盘采购',
  repack: '换箱费',
  wms_outbound: 'WMS出库费',
  order_fee: '订单处理费',
  return_receipt: '退件收货费',
  return_measure: '退件测量费',
  return_handling: '退件操作费',
  return_logistics: '退件物流费',
  return_inspection: '退件质检费',
  return_destroy: '退件销毁费',
  return_repack: '退件包装费',
  return_restock: '退件上架费',
  return_relabel: '退件换标费',
  return_extra: '退件附加费',
}

export function mapErpChargeType(chargeType: string): string {
  const raw = String(chargeType || '').trim()
  if (!raw) return 'other'
  if (raw === 'outbound_ship') return 'shipping'
  return raw
}

export function feeTypeLabel(type: string): string {
  return FEE_TYPE_LABELS[type] || type
}
