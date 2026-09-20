import { downloadCsv } from './csvImportExport'
import type { FeeRecord, InventoryItem } from './mockData'
import { STOCK_SOURCE_LABELS, warehouseLabel, getInventoryStatus, statusLabels } from './mockData'

export function exportInventoryCsv(items: InventoryItem[]) {
  const rows = [[
    'SKU', '商品名称', '规格', 'EAN', '自定义编号', '仓库', '库存来源',
    '可用', '待上架', '待出库', '锁定', '在途', '不良品', '已出库', '状态',
  ]]
  for (const item of items) {
    const st = getInventoryStatus(item)
    rows.push([
      item.sku,
      item.name,
      item.spec ?? '',
      item.ean ?? '',
      item.customCode ?? '',
      warehouseLabel(item.warehouse),
      STOCK_SOURCE_LABELS[item.stockSource],
      String(item.available),
      String(item.pendingShelving),
      String(item.pendingOutbound),
      String(item.locked),
      String(item.inTransit),
      String(item.defective),
      String(item.shipped),
      statusLabels[st] ?? st,
    ])
  }
  downloadCsv('OMS-库存导出.csv', rows)
}

export function exportFeeRecordsCsv(records: FeeRecord[]) {
  const rows = [['日期', '类型', '关联单号', '说明', '金额', '方式', '客户代码']]
  for (const f of records) {
    rows.push([
      f.date,
      f.type,
      f.refNo ?? '—',
      f.desc,
      String(f.amount),
      f.method ?? '',
      f.customerCode ?? '',
    ])
  }
  downloadCsv('OMS-费用流水.csv', rows)
}
