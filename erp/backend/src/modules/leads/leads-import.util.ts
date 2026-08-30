import { parseCsv } from '../../common/csv.util'

/** 与前端 LeadsPoolView 新建线索表单列名一致 */
export const LEADS_IMPORT_HEADERS = [
  '线索编号',
  '客户名称',
  '联系方式',
  '电话',
  '来源',
  '归属运营',
  '跟进销售',
  '备注',
] as const

function colIdx(header: string[], aliases: string[]) {
  const lower = aliases.map((a) => a.toLowerCase())
  return header.findIndex((h) => {
    const t = h.trim()
    return lower.includes(t.toLowerCase()) || aliases.includes(t)
  })
}

export interface ParsedLeadImportRow {
  leadNo?: string
  companyName: string
  contactName: string
  contactPhone?: string
  source: string
  assigneeKey?: string
  followSales?: string
  remark?: string
}

export function parseLeadsImportCsv(content: string): ParsedLeadImportRow[] {
  const rows = parseCsv(content)
  if (rows.length < 2) return []
  const header = rows[0].map((h) => h.trim())
  const leadNoIdx = colIdx(header, ['线索编号', 'leadNo', 'lead_no'])
  const nameIdx = colIdx(header, ['客户名称', '公司名称', 'company', 'companyName'])
  const contactIdx = colIdx(header, ['联系方式', '联系人', 'contact', 'contactName'])
  const phoneIdx = colIdx(header, ['电话', '联系电话', 'phone', 'contact_phone', 'contactPhone'])
  const sourceIdx = colIdx(header, ['来源', 'source'])
  const assigneeIdx = colIdx(header, ['归属运营', '归属销售', 'assignee', 'assigneeName'])
  const followSalesIdx = colIdx(header, ['跟进销售', '再次对接销售', 'followSales', 'follow_sales'])
  const remarkIdx = colIdx(header, ['备注', 'remark'])
  if (nameIdx < 0) throw new Error('CSV 需包含「客户名称」列')

  const parsed: ParsedLeadImportRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i]
    const companyName = cols[nameIdx]?.trim()
    if (!companyName) continue
    const contactName = contactIdx >= 0 ? cols[contactIdx]?.trim() : ''
    if (!contactName) continue
    parsed.push({
      leadNo: leadNoIdx >= 0 ? cols[leadNoIdx]?.trim() || undefined : undefined,
      companyName,
      contactName,
      contactPhone: phoneIdx >= 0 ? cols[phoneIdx]?.trim() || undefined : undefined,
      source: sourceIdx >= 0 ? cols[sourceIdx]?.trim() || 'Takealot' : 'Takealot',
      assigneeKey: assigneeIdx >= 0 ? cols[assigneeIdx]?.trim() || undefined : undefined,
      followSales: followSalesIdx >= 0 ? cols[followSalesIdx]?.trim() || undefined : undefined,
      remark: remarkIdx >= 0 ? cols[remarkIdx]?.trim() || undefined : undefined,
    })
  }
  return parsed
}
