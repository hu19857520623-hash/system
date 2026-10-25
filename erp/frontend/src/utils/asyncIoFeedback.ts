import { userFacingError } from '@erp/shared/user-facing-error'

const STATES: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'info' }> = {
  completed: { label: '已完成', tone: 'success' }, partial: { label: '部分成功', tone: 'warning' },
  failed: { label: '失败', tone: 'danger' }, pending: { label: '待处理', tone: 'info' },
  processing: { label: '处理中', tone: 'warning' },
}
export const asyncJobState = (status: unknown) => STATES[String(status)] || { label: '状态待核对', tone: 'info' }
export function asyncJobNextStep(job: any) {
  if (job.jobType === 'import') {
    if (job.status === 'partial' || job.status === 'failed') return '请查看失败原因，仅修正失败行后重新导入；成功行无需重复导入。'
    return job.status === 'completed' ? '导入已完成，可返回原业务页面核对记录。' : '请刷新状态核对结果，勿重复上传原文件。'
  }
  if (job.status === 'completed') return '导出已完成，可下载文件。'
  if (job.status === 'failed') return job.canRetry ? '可按原筛选重试；重试会查询当前最新数据。' : '此任务无法直接重试，请返回原业务页面核对筛选条件后重新导出。'
  return '请刷新状态核对结果；处理中请勿重复新建任务。'
}
export const asyncJobError = (value: unknown) => value ? userFacingError(value) : '—'
export const ASYNC_FILTER_LABELS: Record<string, string> = {
  keyword: '关键词', warehouseCode: '仓库', warehouseCodes: '仓库', warehouseType: '仓库类型',
  onlyAvailable: '仅有可用库存', supplierKeyword: '供应商', skuCodes: 'SKU', productCode: '商品', exactSku: '精确匹配',
  barcode: '条码', category: '分类', qtyType: '数量类型', qtyMin: '最低数量', qtyMax: '最高数量', lowStockOnly: '低库存',
  customerKeyword: '客户', dataSource: '来源', costType: '费用类型', startDate: '开始日期', endDate: '结束日期',
  minAmount: '最低金额', maxAmount: '最高金额', status: '客户状态', balanceMin: '最低余额', balanceMax: '最高余额',
  portalOnly: '仅 OMS 客户', source: '来源', shopType: '店铺类型', assigneeId: '销售人员编号', dealStatus: '开通状态',
  dealDateFrom: '成交开始日期', dealDateTo: '成交结束日期', range: '时间范围',
}
const VALUES: Record<string, string> = { true: '是', false: '否', all: '全部', month: '本月', quarter: '本季度', logistics: '中转仓', overseas: '海外仓', erp: 'ERP', oms: 'OMS', catalog_holdings: '货盘持有', pending: '待开通', confirmed: '已开通 OMS', active: '正常', disabled: '停用', locked: '锁定', total: '总库存', available: '可用' }
export function asyncFilterSummary(params: Record<string, unknown> | null) {
  if (!params) return '旧任务未保存筛选条件'
  return Object.entries(params).map(([name, value]) => `${ASYNC_FILTER_LABELS[name] || '筛选项'}：${VALUES[String(value)] || String(value)}`).join('；') || '全部数据（受当前账号权限范围限制）'
}
export function asyncModuleLabel(module: string) {
  const labels: Record<string, string> = { inventory: '库存', logistics_inventory: '中转仓库存', cost: '采购货款', customers: '客户充值', leads_deals: '成交客户', leads_report: '获客报表', sync: '同步日志', freight: '海运账单', billing: '客户结算', leads: '线索', products: '商品主数据', 'purchase-orders': '采购订单' }
  return labels[module] || (/[\u3400-\u9fff]/.test(module) ? module : '历史任务')
}
