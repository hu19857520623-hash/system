import { BadRequestException } from '@nestjs/common'

const FILTERS: Record<string, string[]> = {
  inventory: ['keyword', 'warehouseCode', 'warehouseCodes', 'warehouseType', 'onlyAvailable', 'supplierKeyword', 'skuCodes', 'productCode', 'exactSku', 'barcode', 'category', 'qtyType', 'qtyMin', 'qtyMax', 'lowStockOnly', 'customerKeyword', 'dataSource'],
  logistics_inventory: ['keyword', 'warehouseCode', 'onlyAvailable'],
  cost: ['keyword', 'costType', 'startDate', 'endDate', 'minAmount', 'maxAmount'],
  customers: ['keyword', 'status', 'balanceMin', 'balanceMax', 'portalOnly'],
  leads_deals: ['keyword', 'source', 'shopType', 'assigneeId', 'dealStatus', 'dealDateFrom', 'dealDateTo'],
  leads_report: ['range'], sync: [], freight: [], billing: [],
}
const ALIASES: Record<string, string> = {
  '库存': 'inventory', '中转仓库存': 'logistics_inventory', '成本台账': 'cost', '采购货款': 'cost',
  '客户充值': 'customers', '成交客户': 'leads_deals', '获客报表': 'leads_report',
  '同步日志': 'sync', '海运账单': 'freight', '客户结算': 'billing',
}
export function exportScope(module: string, input: unknown = {}) {
  const key = ALIASES[module] || module
  if (!Object.prototype.hasOwnProperty.call(FILTERS, key)) throw new BadRequestException('该模块请在原业务页面导出，暂不支持异步导出')
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('导出筛选条件无效')
  const params: Record<string, string> = {}
  for (const [name, value] of Object.entries(input)) {
    if (!FILTERS[key].includes(name)) throw new BadRequestException('导出包含不支持的筛选条件，请返回原页面重新导出')
    if (value == null || value === '') continue
    if (!['string', 'number', 'boolean'].includes(typeof value) || String(value).length > 1000) throw new BadRequestException('导出筛选条件无效或过长')
    params[name] = String(value).trim()
  }
  for (const name of ['startDate', 'endDate', 'dealDateFrom', 'dealDateTo']) {
    if (params[name] && (!/^\d{4}-\d{2}-\d{2}$/.test(params[name]) || Number.isNaN(Date.parse(params[name])))) throw new BadRequestException('导出日期无效')
  }
  for (const [from, to] of [['startDate', 'endDate'], ['dealDateFrom', 'dealDateTo']]) {
    if (params[from] && params[to] && params[from] > params[to]) throw new BadRequestException('开始日期不能晚于结束日期')
  }
  for (const name of ['minAmount', 'maxAmount', 'balanceMin', 'balanceMax', 'qtyMin', 'qtyMax']) {
    if (params[name] && !Number.isFinite(Number(params[name]))) throw new BadRequestException('导出数量或金额无效')
  }
  if (params.assigneeId && !/^[1-9]\d{0,14}$/.test(params.assigneeId)) throw new BadRequestException('销售人员编号无效')
  if (key === 'leads_report' && params.range && !['all', 'month', 'quarter'].includes(params.range)) throw new BadRequestException('报表时间范围无效')
  return { key, params }
}

export interface ExportReceipt { version: 1; kind: 'export'; attempt: number; params: Record<string, string> }
export function exportReceipt(raw: string | null | undefined): ExportReceipt | null {
  try {
    const receipt = JSON.parse(raw || '')
    return receipt.version === 1 && receipt.kind === 'export' && Number.isSafeInteger(receipt.attempt) && receipt.attempt > 0
      && receipt.params && typeof receipt.params === 'object' && !Array.isArray(receipt.params) ? receipt : null
  } catch { return null }
}

export const IMPORT_MODULE_PERM: Record<string, string> = {
  '线索': 'leads_pool.create', leads: 'leads_pool.create',
  '商品主数据': 'products.import', products: 'products.import',
  '采购订单': 'purchase.create', 'purchase-orders': 'purchase.create',
}
