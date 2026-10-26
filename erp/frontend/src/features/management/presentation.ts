import { INBOUND_STATUS } from '@/constants'

function label(value: unknown, labels: Record<string, string>, empty = '未提供') {
  if (value == null || value === '') return empty
  const key = String(value)
  return labels[key] || (/^[\u3400-\u9fff\s，。、（）()\d-]+$/.test(key) ? key : '待核对')
}
export const inboundStatus = (value: unknown) => label(value, Object.fromEntries(Object.entries(INBOUND_STATUS).map(([k, v]) => [k, v.label])))
export const outboundStatus = (value: unknown) => label(value, {
  oms_draft: '客户草稿', pending_pick: '待拣货', picking: '拣货中', picked: '已拣货', reviewing: '复核中',
  packed: '待发运', pending_review: '待复核', pending_relabel: '待换标', pending_ship: '待发运', shipped: '已发运', delivered: '已送达',
  partial_delivered: '部分签收', delivery_failed: '派送失败', exception: '异常', cancelled: '已作废', closed: '已关闭',
})
export const planStatus = (value: unknown) => label(value, { draft: '草稿', counting: '盘点中', pending_approval: '待审批', completed: '已完成', cancelled: '已取消' })
export const lineStatus = (value: unknown) => label(value, { pending: '待初盘', recount: '待交接复盘', matched: '数量一致', variance: '已确认差异' })
export const alertLevel = (value: unknown) => label(value, { normal: '正常', warning: '预警', high: '高风险预警', critical: '严重预警', unset: '未设置上限', unknown: '待核对' })
export const stocktakeMode = (value: unknown) => label(value, { full: '全仓', location: '库位', sku: '指定SKU', spot: '抽盘', recount: '原明细重盘' })
export const exceptionType = (value: unknown) => label(value, { shortage: '缺货', damaged: '破损', damage: '破损', missing_label: '缺少标签', label_error: '标签异常', other: '其他异常' }, '无')

/** Read every page before creating a file; never silently truncate an export. */
export async function collectReport(load: (params: any) => Promise<any>, params: Record<string, unknown>, key: string) {
  const rows: any[] = [], seen = new Set<string>()
  let total: number | undefined
  for (let page = 1; ; page++) {
    const response = await load({ ...params, page, pageSize: 5000 })
    if (!Number.isSafeInteger(response.total) || response.total < 0 || !Array.isArray(response.items)) throw new Error('报表数据不完整，请重新查询后导出')
    if (total != null && response.total !== total) throw new Error('导出期间数据已变化，请重新查询后导出')
    total = response.total
    for (const row of response.items) {
      const id = String(row[key] || '')
      if (!id || seen.has(id)) throw new Error('导出期间记录已变化，请重新查询后导出')
      seen.add(id); rows.push(row)
    }
    if (rows.length === total) return rows
    if (!response.items.length || rows.length > total! || page >= 1000) throw new Error('报表范围过大或数据不完整，请缩小范围后重试')
  }
}
