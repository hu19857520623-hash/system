import { parseProductsImportCsv } from './products-import.util'

describe('parseProductsImportCsv', () => {
  it('parses columns aligned with manual product creation form', () => {
    const csv = [
      'SKU,SPU,商品名称,规格,采购成本(RMB),长(cm),宽(cm),高(cm),重量(kg),条码,开发人,采购员,供应商,状态',
      'TK-001,SPU-A,测试商品,红色,12.5,30,20,15,0.5,690123,张三,李四,示例供应商,已生效',
      'TK-002,,另一商品,,,,,,,,,,,',
    ].join('\n')
    const rows = parseProductsImportCsv(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      sku: 'TK-001',
      spu: 'SPU-A',
      productName: '测试商品',
      spec: '红色',
      costRmb: 12.5,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
      weightKg: 0.5,
      barcode: '690123',
      developerKey: '张三',
      purchaserKey: '李四',
      supplierKey: '示例供应商',
      status: 'active',
    })
    expect(rows[1]).toMatchObject({
      sku: 'TK-002',
      productName: '另一商品',
      status: 'active',
    })
  })

  it('requires SKU column', () => {
    expect(() => parseProductsImportCsv('商品名称\n测试')).toThrow('SKU')
  })

  it('requires 商品名称 column', () => {
    expect(() => parseProductsImportCsv('SKU\nTK-001')).toThrow('商品名称')
  })

  it('skips rows without sku or product name', () => {
    const csv = 'SKU,商品名称\n,仅名称\nTK-003,\nTK-004,有效商品'
    expect(parseProductsImportCsv(csv)).toHaveLength(1)
    expect(parseProductsImportCsv(csv)[0].sku).toBe('TK-004')
  })
})
