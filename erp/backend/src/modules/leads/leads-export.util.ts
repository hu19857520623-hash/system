import { toCsv } from '../../common/csv.util'

export const LEADS_EXPORT_LIMIT = 10_000
const STATUS_LABELS: Record<string, string> = {
  new: '新线索', following: '跟进中', recall: '需要再次跟进', hot: '意向高',
  nurture: '暂无意向', deal: '已成交', lost: '已流失',
}

function exportTime(value: unknown) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(date)
}

function textCell(value: unknown) {
  const text = value == null ? '' : String(value)
  // Treat user-entered text as text even when a spreadsheet would interpret a formula.
  return /^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? "'" + text : text
}

export function leadsExportCsv(items: Record<string, any>[]) {
  const headers = ['线索编号', '客户名称', '联系人/微信', '联系电话', '来源', '状态',
    '归属运营', '跟进销售', '创建时间', '最近跟进时间', '最近跟进内容', '下次跟进时间', '下一步计划', '备注']
  const rows = items.map(row => {
    const latest = row.followUps?.[0]
    return [row.leadNo, row.companyName, row.contactName,
      row.contactPhone ? "'" + row.contactPhone : '', row.source,
      STATUS_LABELS[row.status] || row.status, row.assigneeName, row.followSales,
      exportTime(row.createdAt), exportTime(latest?.createdAt), latest?.content,
      exportTime(latest?.nextFollowAt), latest?.nextPlan, row.remark].map(textCell)
  })
  return toCsv(headers, rows)
}
