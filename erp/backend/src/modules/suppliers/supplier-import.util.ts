import { normalizeImportHeader, parseNumberedImportCsv } from '../../common/csv.util'
import type { ImportRowFailure } from '../../common/import-row-result.util'

export const SUPPLIER_IMPORT_MAX_ROWS = 500

export type ParsedSupplierImportRow = {
  lineNo: number
  supplierCode?: string
  supplierName: string
  companyName?: string
  contactName: string
  contactPhone: string
  email?: string
  address?: string
  city?: string
  country?: string
  paymentTerms?: string
  leadTimeDays?: number
  remark?: string
}

function cell(cols: string[], index: number) {
  return index >= 0 ? String(cols[index] ?? '').trim() : ''
}

function colIdx(header: string[], names: string[]) {
  const wanted = names.map((name) => name.toLowerCase())
  return header.findIndex((item) => wanted.includes(item.trim().toLowerCase()))
}

function optional(value: string, max: number, label: string, fail: (field: string, reason: string) => void) {
  if (!value) return undefined
  if (value.length > max) {
    fail(label, `不能超过 ${max} 字`)
    return undefined
  }
  return value
}

export function parseSupplierImportCsv(content: string): { rows: ParsedSupplierImportRow[]; failures: ImportRowFailure[]; failureCount: number } {
  const table = parseNumberedImportCsv(content)
  if (table.length < 2) return { rows: [], failures: [], failureCount: 0 }
  const header = table[0].cells.map(normalizeImportHeader)
  const codeIdx = colIdx(header, ['供应商代码', '供应商编码', '编码', 'supplierCode', 'code'])
  const nameIdx = colIdx(header, ['供应商名称', '名称', 'supplierName', 'name'])
  const companyIdx = colIdx(header, ['公司名称', '公司', 'companyName'])
  const contactIdx = colIdx(header, ['联系人', 'contactName', 'contact'])
  const phoneIdx = colIdx(header, ['电话', '联系电话', 'contactPhone', 'phone'])
  const emailIdx = colIdx(header, ['邮箱', 'email'])
  const addressIdx = colIdx(header, ['地址', 'address'])
  const cityIdx = colIdx(header, ['城市', 'city'])
  const countryIdx = colIdx(header, ['国家', 'country'])
  const termsIdx = colIdx(header, ['结算方式', '结算', 'paymentTerms'])
  const leadIdx = colIdx(header, ['账期天数', '账期', 'leadTimeDays'])
  const remarkIdx = colIdx(header, ['备注', 'remark'])
  if (nameIdx < 0) throw new Error('CSV 需包含「供应商名称」列')
  if (contactIdx < 0) throw new Error('CSV 需包含「联系人」列')
  if (phoneIdx < 0) throw new Error('CSV 需包含「电话」列')

  const rows: ParsedSupplierImportRow[] = []
  const failures: ImportRowFailure[] = []
  let failureCount = 0
  const seenCodes = new Set<string>()
  const seenNames = new Set<string>()
  for (const { cells: cols, lineNo } of table.slice(1)) {
    const supplierCode = cell(cols, codeIdx)
    const supplierName = cell(cols, nameIdx)
    const companyName = cell(cols, companyIdx)
    const contactName = cell(cols, contactIdx)
    const contactPhone = cell(cols, phoneIdx)
    const email = cell(cols, emailIdx)
    const address = cell(cols, addressIdx)
    const city = cell(cols, cityIdx)
    const country = cell(cols, countryIdx)
    const paymentTerms = cell(cols, termsIdx)
    const leadRaw = cell(cols, leadIdx)
    const remark = cell(cols, remarkIdx)
    if (![supplierCode, supplierName, companyName, contactName, contactPhone, email, address, city, country, paymentTerms, leadRaw, remark].some(Boolean)) continue

    const before = failures.length
    const fail = (field: string, reason: string) => { failures.push({ lineNo, field, reason }) }
    if (!supplierName) fail('供应商名称', '不能为空')
    else if (supplierName.length > 200) fail('供应商名称', '不能超过 200 字')
    if (supplierCode && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,29}$/.test(supplierCode)) fail('供应商代码', '仅支持字母、数字、下划线和短横线，最长 30 位')
    if (!contactName) fail('联系人', '不能为空')
    else if (contactName.length > 50) fail('联系人', '不能超过 50 字')
    if (!contactPhone) fail('电话', '不能为空')
    else if (contactPhone.length > 30) fail('电话', '不能超过 30 字')
    const company = optional(companyName, 200, '公司名称', fail)
    const mail = optional(email, 100, '邮箱', fail)
    if (mail && !mail.includes('@')) fail('邮箱', '格式无效')
    const addr = optional(address, 500, '地址', fail)
    const cityValue = optional(city, 50, '城市', fail)
    const countryValue = optional(country, 50, '国家', fail)
    const terms = optional(paymentTerms, 100, '结算方式', fail)
    const note = optional(remark, 2000, '备注', fail)
    let leadTimeDays: number | undefined
    if (leadRaw) {
      if (!/^\d+$/.test(leadRaw) || Number(leadRaw) > 9999) fail('账期天数', '须为 0 至 9999 的整数')
      else leadTimeDays = Number(leadRaw)
    }
    const nameKey = supplierName.toLowerCase()
    const codeKey = supplierCode.toLowerCase()
    if (supplierName && seenNames.has(nameKey)) fail('供应商名称', '文件中重复')
    if (supplierCode && seenCodes.has(codeKey)) fail('供应商代码', '文件中重复')
    if (failures.length > before) {
      failureCount++
      continue
    }
    seenNames.add(nameKey)
    if (codeKey) seenCodes.add(codeKey)
    rows.push({
      lineNo,
      supplierCode: supplierCode || undefined,
      supplierName,
      companyName: company,
      contactName,
      contactPhone,
      email: mail,
      address: addr,
      city: cityValue,
      country: countryValue,
      paymentTerms: terms,
      leadTimeDays,
      remark: note,
    })
  }
  return { rows, failures, failureCount }
}
