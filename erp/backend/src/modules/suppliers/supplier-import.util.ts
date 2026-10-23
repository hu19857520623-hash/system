import { parseCsv } from '../../common/csv.util'
import { MAX_IMPORT_FAILURE_DETAILS, type ImportRowFailure } from '../../common/import-row-result.util'

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

function optional(value: string, max: number, label: string, reasons: string[]) {
  if (!value) return undefined
  if (value.length > max) {
    reasons.push(`${label}不能超过 ${max} 字`)
    return undefined
  }
  return value
}

export function parseSupplierImportCsv(content: string): { rows: ParsedSupplierImportRow[]; failures: ImportRowFailure[]; failureCount: number } {
  const table = parseCsv(content)
  if (table.length < 2) return { rows: [], failures: [], failureCount: 0 }
  const header = table[0].map((item) => item.trim())
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
  const recordFail = (lineNo: number, reason: string) => {
    failureCount++
    if (failures.length < MAX_IMPORT_FAILURE_DETAILS) failures.push({ lineNo, reason })
  }

  for (let i = 1; i < table.length; i++) {
    const cols = table[i]
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
    const lineNo = i + 1
    if (![supplierCode, supplierName, companyName, contactName, contactPhone, email, address, city, country, paymentTerms, leadRaw, remark].some(Boolean)) continue

    const reasons: string[] = []
    if (!supplierName) reasons.push('供应商名称不能为空')
    else if (supplierName.length > 200) reasons.push('供应商名称不能超过 200 字')
    if (supplierCode && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,29}$/.test(supplierCode)) reasons.push('供应商代码仅支持字母、数字、下划线和短横线，最长 30 位')
    if (!contactName) reasons.push('联系人不能为空')
    else if (contactName.length > 50) reasons.push('联系人不能超过 50 字')
    if (!contactPhone) reasons.push('电话不能为空')
    else if (contactPhone.length > 30) reasons.push('电话不能超过 30 字')
    const company = optional(companyName, 200, '公司名称', reasons)
    const mail = optional(email, 100, '邮箱', reasons)
    if (mail && !mail.includes('@')) reasons.push('邮箱格式无效')
    const addr = optional(address, 500, '地址', reasons)
    const cityValue = optional(city, 50, '城市', reasons)
    const countryValue = optional(country, 50, '国家', reasons)
    const terms = optional(paymentTerms, 100, '结算方式', reasons)
    const note = optional(remark, 2000, '备注', reasons)
    let leadTimeDays: number | undefined
    if (leadRaw) {
      if (!/^\d+$/.test(leadRaw) || Number(leadRaw) > 9999) reasons.push('账期天数须为 0 至 9999 的整数')
      else leadTimeDays = Number(leadRaw)
    }
    const nameKey = supplierName.toLowerCase()
    const codeKey = supplierCode.toLowerCase()
    if (supplierName && seenNames.has(nameKey)) reasons.push('文件中供应商名称重复')
    if (supplierCode && seenCodes.has(codeKey)) reasons.push('文件中供应商代码重复')
    if (reasons.length) {
      recordFail(lineNo, reasons.join('；'))
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
