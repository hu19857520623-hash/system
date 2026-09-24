import {
  buildInboundReceivingListHtml,
  groupReceivingListSkus,
  printInboundWarehouseCode,
} from '@erp/shared/inbound-receiving-list'

describe('inbound receiving list', () => {
  it('prints only the merged-SKU receiving list page', () => {
    const html = buildInboundReceivingListHtml({
      inboundNo: 'RVAFU0430-260910-0002',
      createdAt: '2026-09-10 11:49:59',
      shipWarehouse: 'TKL',
      destWarehouse: 'TKL',
      customerCode: 'AFU0430',
      trackingNo: 'SR110',
      printedAt: '2026-09-10 15:51:54',
      skus: groupReceivingListSkus({
        inboundNo: 'RVAFU0430-260910-0002',
        items: [{
          sku: 'AFU0430-719110',
          name: '40件套扭矩扳手',
          firstArrival: true,
          weightKg: 1.4,
          lengthCm: 35,
          widthCm: 12,
          heightCm: 6.5,
        }],
        cartons: [1, 2, 3, 4].map((boxSeq) => ({
          boxSeq,
          boxCode: `RVAFU0430-260910-${String(boxSeq).padStart(4, '0')}`,
          items: [{ sku: 'AFU0430-719110', qty: 8 }],
        })),
      }),
    })

    expect(html).toContain('入库清单')
    expect(html).toContain('RVAFU0430-260910-0002')
    expect(html).toContain('aria-label="RVAFU0430-260910-0002"')
    expect(html).not.toContain('RO:RVAFU0430-260910-0001')
    expect(html).not.toContain('aria-label="RVAFU0430-260910-0001"')
    expect(html).not.toContain('4pack')
    expect(html).toContain('首次到货')
    expect(html).toContain('1.400')
    expect(html).toContain('35.00*12.00*6.50')
    expect(printInboundWarehouseCode('jhb1')).toBe('TKL')
  })
})
