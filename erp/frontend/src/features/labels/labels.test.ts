import { describe, expect, it } from 'vitest'
import { buildBoxLabelData, buildInboundLabelInputs } from './inboundLabelPrint'
import { buildPurchaseBoxLabelOrder } from './purchaseBoxLabel'
import { buildBoxLabelsPdf } from './boxLabelPdf'
import { buildBoxLabelArticle, buildBoxLabelsHtml, BOX_LABEL_STYLE } from './boxLabelTemplate'
import {
  BARCODE_LABEL_STYLE,
  buildBarcodeLabelArticle,
  buildBarcodeLabelHtml,
  resolveBarcodeLabelCode,
} from './barcodeLabelTemplate'

describe('boxLabelPdf', () => {
  it('builds valid pdf bytes for packing list labels', async () => {
    const pdf = await buildBoxLabelsPdf([{
      referenceNo: 'RVAFU0002-260731-0003',
      boxNo: 1,
      warehouseCode: 'AAE938',
      lines: [{ sku: 'AFU0002-9902297558367', qty: 1 }],
      boxIndex: 1,
      boxTotal: 1,
    }])
    const header = new TextDecoder().decode(pdf.slice(0, 5))
    expect(header).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(500)
  })
})

describe('boxLabelTemplate', () => {
  it('matches 100x100 packing list layout from reference pdf', () => {
    const html = buildBoxLabelsHtml([{
      referenceNo: 'RVAFU0002-260731-0003',
      boxNo: 1,
      warehouseCode: 'AAE938',
      lines: [{ sku: 'AFU0002-9902297558367', qty: 1 }],
      boxIndex: 1,
      boxTotal: 1,
    }])

    expect(html).toContain('100mm 100mm')
    expect(html).toContain('Packing List')
    expect(html).toContain('RVAFU0002-260731-0003')
    expect(html).toContain('AAE938')
    expect(html).toContain('AFU0002-9902297558367')
    expect(html).toContain('MADE IN CHINA')
    expect(html).toContain('1/1')
    expect(BOX_LABEL_STYLE).toContain('margin:0')
    expect(buildBoxLabelArticle({
      referenceNo: 'RVAFU0002-260731-0003',
      boxNo: 1,
      warehouseCode: 'AAE938',
      lines: [{ sku: 'AFU0002-9902297558367', qty: 1 }],
    })).toContain('<th>SKU</th>')
  })
})

describe('barcodeLabelTemplate', () => {
  it('builds customerCode-sku barcode value', () => {
    expect(resolveBarcodeLabelCode({ sku: 'SKU-JNB-10105', customerCode: 'TKL0001' }))
      .toBe('TKL0001-SKU-JNB-10105')
    expect(resolveBarcodeLabelCode({ sku: 'TKL0001-SKU-JNB-10105', customerCode: 'TKL0001' }))
      .toBe('TKL0001-SKU-JNB-10105')
    expect(resolveBarcodeLabelCode({ sku: 'TKL-TK-99001' }))
      .toBe('TKL-TK-99001')
    expect(resolveBarcodeLabelCode({ sku: 'TK-99001', customerCode: 'TKL' }))
      .toBe('TKL-TK-99001')
  })

  it('uses 50x30mm page for sku labels', () => {
    const html = buildBarcodeLabelHtml(
      buildBarcodeLabelArticle('TKL0001-SKU-JNB-10105', '<svg></svg>'),
      'test',
    )
    expect(html).toContain('50mm 30mm')
    expect(html).toContain('TKL0001-SKU-JNB-10105')
    expect(BARCODE_LABEL_STYLE).toContain('.barcode-wrap')
  })
})

describe('inboundLabelPrint', () => {
  it('builds one 100x100 box label per carton', () => {
    const labels = buildBoxLabelData({
      inboundNo: 'IN-001',
      referenceNo: 'RVAFU0002-260731-0003',
      warehouse: 'AAE938',
      boxCount: 2,
      lineItems: [
        { sku: 'TKL0001-SKU-1', name: 'Product 1', qty: 10, boxNo: 1 },
        { sku: 'TKL0001-SKU-1', name: 'Product 1', qty: 5, boxNo: 2 },
      ],
    })

    expect(labels).toHaveLength(2)
    expect(labels[0]).toMatchObject({
      referenceNo: 'RVAFU0002-260731-0003',
      boxNo: 1,
      warehouseCode: 'AAE938',
      boxTotal: 2,
      lines: [{ sku: 'TKL0001-SKU-1', qty: 10 }],
    })
    expect(labels[1].lines[0]).toEqual({ sku: 'TKL0001-SKU-1', qty: 5 })
  })

  it('builds sku labels with qty copies', () => {
    const inputs = buildInboundLabelInputs({
      inboundNo: 'IN-002',
      warehouse: 'JHB',
      boxCount: 1,
      lineItems: [{ sku: 'TKL0001-SKU-2', name: 'P2', qty: 3, boxNo: 1 }],
    }, 'SKU 标签')

    expect(inputs).toEqual([{ code: 'TKL0001-SKU-2', copies: 3 }])
  })
})

describe('purchaseBoxLabel', () => {
  it('splits purchase lines into cartons by piecesPerCarton', () => {
    const order = buildPurchaseBoxLabelOrder({
      poNo: 'PO-100',
      warehouseCode: 'AAE938',
      warehouseName: '物流中转仓',
      supplier: '测试供应商',
      purchaseConfirmation: { piecesPerCarton: 20 },
      items: [{ sku: 'TKL0001-TK-001', productName: '测试商品', quantity: 45 }],
    })

    expect(order.boxCount).toBe(3)
    expect(order.referenceNo).toBe('PO-100')
    expect(order.warehouseCode).toBe('AAE938')
    expect(order.lineItems).toHaveLength(3)
    expect(order.lineItems?.[0]).toMatchObject({ boxNo: 1, qty: 20, sku: 'TKL0001-TK-001' })
    expect(order.lineItems?.[2]).toMatchObject({ boxNo: 3, qty: 5 })
  })
})
