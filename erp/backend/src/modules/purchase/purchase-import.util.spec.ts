import {
  buildPurchaseImportPoNo,
  groupPurchaseImportLines,
  parsePurchaseImportCsv,
  resolveLogisticsWarehouseCode,
} from './purchase-import.util'

const header = '供应商,目标中转仓,预计到货,国内运费,备注,SKU,商品名称,采购数量,单价,行备注'

describe('parsePurchaseImportCsv', () => {
  it('把相同表头的行合并成一张采购单，并保留另一张单', () => {
    const csv = [
      header,
      '示例供应商,深圳集运物流仓,2026-11-01,80,补货,FIT-001,扶手椅,10,120.75,',
      '示例供应商,深圳集运物流仓,2026/11/1,80.00,补货,FUR-002,婴儿床,5,283.4,加急',
      '另一供应商,义乌集运物流仓,,,,TK-99001,,2,15,',
    ].join('\n')

    const parsed = parsePurchaseImportCsv(csv)
    expect(parsed.failures).toEqual([])
    const groups = groupPurchaseImportLines(parsed.lines)
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({
      supplierName: '示例供应商',
      warehouseKey: '深圳集运物流仓',
      expectedArrival: '2026-11-01',
      domesticFreight: 80,
      orderRemark: '补货',
    })
    expect(groups[0].lines.map((line) => line.sku)).toEqual(['FIT-001', 'FUR-002'])
    expect(groups[0].lines[1]).toMatchObject({ unitPrice: 283.4, lineRemark: '加急', quantity: 5 })
    expect(groups[1].lines[0]).toMatchObject({ sku: 'TK-99001', productName: undefined, quantity: 2 })
  })

  it('缺少必填列时拒绝整份文件', () => {
    expect(() => parsePurchaseImportCsv('SKU,采购数量,单价\nA,1,2')).toThrow('供应商')
    expect(() => parsePurchaseImportCsv('供应商,SKU,采购数量,单价\n甲,A,1,2')).toThrow('目标中转仓')
    expect(() => parsePurchaseImportCsv('供应商,目标中转仓,采购数量,单价\n甲,仓,1,2')).toThrow('SKU')
  })

  it('无效行记入失败明细，空行跳过，有效行仍可导入', () => {
    const csv = [
      header,
      ',,,,,,',
      ',深圳集运物流仓,,, ,FIT-001,,1,10,',
      '示例供应商,深圳集运物流仓,2026-02-31,,,FIT-002,,0,0,',
      '示例供应商,深圳集运物流仓,,,,FIT-003,商品,3,12.5,',
    ].join('\n')
    const parsed = parsePurchaseImportCsv(csv)
    expect(parsed.lines).toHaveLength(1)
    expect(parsed.lines[0].sku).toBe('FIT-003')
    expect(parsed.failures.map((failure) => failure.lineNo)).toEqual([3, 4])
    expect(parsed.failures[0].reason).toContain('供应商不能为空')
    expect(parsed.failures[1].reason).toContain('预计到货')
    expect(parsed.failures[1].reason).toContain('采购数量')
    expect(parsed.failures[1].reason).toContain('单价')
  })
})

describe('resolveLogisticsWarehouseCode', () => {
  const warehouses = [
    { warehouseCode: 'LW-SZ', warehouseName: '深圳集运物流仓' },
    { warehouseCode: 'LW-YW', warehouseName: '义乌集运物流仓' },
  ]

  it('优先按仓库代码匹配，否则按名称匹配', () => {
    expect(resolveLogisticsWarehouseCode('lw-sz', warehouses)).toEqual({ code: 'LW-SZ' })
    expect(resolveLogisticsWarehouseCode('义乌集运物流仓', warehouses)).toEqual({ code: 'LW-YW' })
    expect(resolveLogisticsWarehouseCode('不存在', warehouses)).toEqual({})
  })

  it('同名仓库要求改填代码', () => {
    const duplicated = [
      ...warehouses,
      { warehouseCode: 'LW-SZ-2', warehouseName: '深圳集运物流仓' },
    ]
    expect(resolveLogisticsWarehouseCode('深圳集运物流仓', duplicated)).toEqual({ ambiguous: true })
    expect(resolveLogisticsWarehouseCode('LW-SZ-2', duplicated)).toEqual({ code: 'LW-SZ-2' })
  })
})

describe('buildPurchaseImportPoNo', () => {
  it('生成不超过 30 字且互不相同的采购单号', () => {
    const numbers = new Set(Array.from({ length: 20 }, (_, index) => buildPurchaseImportPoNo(index + 1, 1_700_000_000_000)))
    expect(numbers.size).toBe(20)
    for (const poNo of numbers) {
      expect(poNo.startsWith('PO-')).toBe(true)
      expect(poNo.length).toBeLessThanOrEqual(30)
    }
  })
})
