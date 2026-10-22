import type { ParsedReturnImport } from './importTemplates'
import { nextReturnNo, type ReturnOrder } from './returnStore'

export function buildImportedReturnDrafts(rows: ParsedReturnImport[], options: {
  customerId: string; customerCode: string; existingNos: string[]; date?: Date
}): ReturnOrder[] {
  if (!options.customerId || !options.customerCode || options.customerCode === '—') throw new Error('请先选择导入客户，再导入退件预约单')
  const date = options.date ?? new Date(), reserved = [...options.existingNos]
  return rows.map(row => {
    const returnNo = nextReturnNo(options.customerCode, date, reserved)
    reserved.push(returnNo)
    const { headerKey: _, ...fields } = row
    return { ...fields, id: `rt-import-${crypto.randomUUID()}`, customerId: options.customerId, returnNo,
      status: 'draft', statusLabel: '草稿', createdAt: `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`,
      totalQty: row.lineItems.reduce((sum, line) => sum + line.qty, 0),
    }
  })
}
