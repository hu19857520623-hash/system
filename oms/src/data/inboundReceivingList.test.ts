import assert from 'node:assert/strict'
import test from 'node:test'
import { buildInboundReceivingListHtml } from './inboundReceivingList'

test('inbound receiving list prints only the merged-SKU sheet', () => {
  const html = buildInboundReceivingListHtml({
    inboundNo: 'RVTKL005-260924-0001',
    createdAt: '2026-09-24 10:00:00',
    shipWarehouse: 'TKL',
    destWarehouse: 'TKL',
    customerCode: 'CUSTOMER',
    printedAt: '2026-09-24 10:00:00',
    skus: [{
      sku: 'SKU-001',
      name: 'Test product',
      boxes: [
        { boxNo: 1, expectedQty: 10 },
        { boxNo: 2, expectedQty: 10 },
      ],
    }],
  })

  assert.match(html, /<h1 class="title">入库清单<\/h1>/)
  assert.doesNotMatch(html, /Packing List/)
  assert.equal((html.match(/<section class="sheet">/g) || []).length, 1)
})
