import { buildInboundBoxLabelData } from './box-label-pdf.util'

describe('buildInboundBoxLabelData', () => {
  it('prints one packing list per carton', () => {
    const labels = buildInboundBoxLabelData({
      inboundNo: 'IN-20260707001',
      warehouseCode: 'WMS-JHB-01',
      items: [{ sku: 'HX6', expectedQty: 80 }],
      cartons: [
        { boxSeq: 1, items: [{ sku: 'HX6', qty: 40 }] },
        { boxSeq: 2, items: [{ sku: 'HX6', qty: 40 }] },
      ],
    })

    expect(labels).toHaveLength(2)
    expect(labels[0]).toMatchObject({ boxNo: 1, boxTotal: 2, lines: [{ sku: 'HX6', qty: 40 }] })
    expect(labels[1]).toMatchObject({ boxNo: 2, boxTotal: 2, lines: [{ sku: 'HX6', qty: 40 }] })
  })
})
