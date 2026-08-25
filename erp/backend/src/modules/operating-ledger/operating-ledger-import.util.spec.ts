import { parseOperatingLedgerImportCsv } from './operating-ledger-import.util'

describe('parseOperatingLedgerImportCsv', () => {
  it('parses Chinese headers and income/expense rows', () => {
    const result = parseOperatingLedgerImportCsv(
      '收支类型,类别,金额,币种,发生日期,备注\n支出,办公费,120.50,CNY,2026-08-21,打印纸\n收入,服务收入,500,ZAR,2026-08-20,服务费',
    )
    expect(result.errors).toEqual([])
    expect(result.rows).toMatchObject([
      { line: 2, direction: 'expense', category: '办公费', amount: 120.5, currency: 'CNY' },
      { line: 3, direction: 'income', category: '服务收入', amount: 500, currency: 'ZAR' },
    ])
  })

  it('reports invalid rows without accepting them', () => {
    const result = parseOperatingLedgerImportCsv(
      '收支类型,类别,金额,发生日期\n未知,,0,2026/08/21',
    )
    expect(result.rows).toEqual([])
    expect(result.errors[0]).toMatchObject({ line: 2 })
  })
})
