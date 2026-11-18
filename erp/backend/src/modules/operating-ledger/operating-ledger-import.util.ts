import { normalizeImportHeader, parseNumberedImportCsv } from '../../common/csv.util'

export type OperatingLedgerImportRow = {
  line: number
  entryNo?: string
  direction: 'income' | 'expense'
  category: string
  amount: number
  currency: string
  paymentMethod?: string
  accountName?: string
  counterparty?: string
  referenceNo?: string
  occurredOn: string
  remark?: string
}

export type OperatingLedgerImportError = { line: number; field?: string; message: string }

const HEADER_ALIASES: Record<string, string> = {
  流水号: 'entryNo', entryno: 'entryNo', entry_no: 'entryNo',
  收支类型: 'direction', 类型: 'direction', direction: 'direction',
  类别: 'category', category: 'category',
  金额: 'amount', amount: 'amount',
  币种: 'currency', currency: 'currency',
  支付方式: 'paymentMethod', paymentmethod: 'paymentMethod', payment_method: 'paymentMethod',
  账户: 'accountName', 收付款账户: 'accountName', accountname: 'accountName', account_name: 'accountName',
  往来方: 'counterparty', counterparty: 'counterparty',
  关联单号: 'referenceNo', referenceno: 'referenceNo', reference_no: 'referenceNo',
  发生日期: 'occurredOn', 日期: 'occurredOn', occurredon: 'occurredOn', occurred_on: 'occurredOn',
  备注: 'remark', remark: 'remark',
}

export function parseOperatingLedgerImportCsv(content: string) {
  const table = parseNumberedImportCsv(content)
  if (!table.length) return { rows: [] as OperatingLedgerImportRow[], errors: [{ line: 1, message: '文件为空' }] }
  const headers = table[0].cells.map(header => HEADER_ALIASES[normalizeImportHeader(header).toLowerCase()] || '')
  const required = ['direction', 'category', 'amount', 'occurredOn']
  const missing = required.filter((field) => !headers.includes(field))
  if (missing.length) {
    return {
      rows: [] as OperatingLedgerImportRow[],
      errors: missing.map(field => ({ line: table[0].lineNo, field: fieldLabel(field), message: '缺少必填列' })),
    }
  }

  const rows: OperatingLedgerImportRow[] = []
  const errors: OperatingLedgerImportError[] = []
  for (const { cells, lineNo: line } of table.slice(1)) {
    const raw: Record<string, string> = {}
    headers.forEach((field, column) => {
      if (field) raw[field] = String(cells[column] || '').trim()
    })
    const direction = normalizeDirection(raw.direction)
    const amount = Number(raw.amount)
    const before = errors.length
    const fail = (field: string, message: string) => { errors.push({ line, field, message }) }
    if (!direction) fail('收支类型', '必须是收入或支出')
    if (!raw.category) fail('类别', '不能为空')
    if (!Number.isFinite(amount) || amount <= 0) fail('金额', '必须大于 0')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.occurredOn || '')) fail('发生日期', '无效，请按年-月-日填写，例如 2026-11-11')
    if (errors.length > before) continue
    rows.push({
      line,
      entryNo: raw.entryNo || undefined,
      direction: direction!,
      category: raw.category,
      amount,
      currency: (raw.currency || 'CNY').toUpperCase(),
      paymentMethod: raw.paymentMethod || undefined,
      accountName: raw.accountName || undefined,
      counterparty: raw.counterparty || undefined,
      referenceNo: raw.referenceNo || undefined,
      occurredOn: raw.occurredOn,
      remark: raw.remark || undefined,
    })
  }
  return { rows, errors }
}

function normalizeDirection(value?: string): 'income' | 'expense' | null {
  const normalized = String(value || '').trim().toLowerCase()
  if (['收入', 'income', 'in'].includes(normalized)) return 'income'
  if (['支出', 'expense', 'out'].includes(normalized)) return 'expense'
  return null
}

function fieldLabel(field: string) {
  return ({ direction: '收支类型', category: '类别', amount: '金额', occurredOn: '发生日期' } as Record<string, string>)[field] || field
}
