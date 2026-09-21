import { buildSkuLabelInputs, buildSkuLabelsHtml } from './sku-label.util'

describe('buildSkuLabelInputs', () => {
  it('prints one label per unit and prefers the bound barcode', () => {
    expect(buildSkuLabelInputs([
      { sku: 'SKU-JNB-10105', barcode: '6970123456789', qty: 2 },
      { sku: 'SKU-JNB-10106', qty: 3 },
    ], 'TKL0001')).toEqual([
      { code: '6970123456789', copies: 2 },
      { code: 'TKL0001-SKU-JNB-10106', copies: 3 },
    ])
  })

  it('keeps at least one label for lines without quantity', () => {
    expect(buildSkuLabelInputs([{ sku: 'TKL-TK-99001', qty: 0 }])).toEqual([
      { code: 'TKL-TK-99001', copies: 1 },
    ])
  })
})

describe('buildSkuLabelsHtml', () => {
  it('uses the 50x30mm barcode template shared with 商品主数据', () => {
    const html = buildSkuLabelsHtml([{ sku: 'SKU-JNB-10105', qty: 1 }], { customerCode: 'TKL0001' })

    expect(html).toContain('50mm 30mm')
    expect(html).toContain('class="barcode"')
    expect(html).toContain('TKL0001-SKU-JNB-10105')
  })

  it('repeats the label article per unit', () => {
    const html = buildSkuLabelsHtml([{ sku: 'TKL-TK-99001', qty: 3 }])

    expect(html.match(/<article class="label">/g)).toHaveLength(3)
  })
})
