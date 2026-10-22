import { buildInboundPipelineQtyMap } from './inbound-pipeline.util'

describe('两端共用入库途存口径', () => {
  const order = (status: string, warehouseCode = 'JHB', actualQty: number | null = null, putawayQty = 0) =>
    ({ status, warehouseCode, items: [{ sku: 'SKU-A', expectedQty: 5, actualQty, putawayQty }] })

  it('草稿、作废和已完成单据不累加在途数量', () => {
    expect(buildInboundPipelineQtyMap(['draft', 'oms_draft', 'cancelled', 'completed', 'confirmed'].map(s => order(s))).size).toBe(0)
  })

  it('已提交及兼容推送状态都保留在途数量', () => {
    const map = buildInboundPipelineQtyMap(['pending_receipt', 'pending_push', 'push_failed', 'pushed'].map(s => order(s)))
    expect(map.get('SKU-A::JHB')).toEqual({ inTransit: 20, pendingPutaway: 0 })
  })

  it('清点及部分上架各使用对应剩余数量，并按仓库隔离', () => {
    const map = buildInboundPipelineQtyMap([order('receiving', 'JHB', 2), order('pending_putaway', 'JHB', 5, 2), order('pending_receipt', 'DBN')])
    expect(map.get('SKU-A::JHB')).toEqual({ inTransit: 3, pendingPutaway: 3 })
    expect(map.get('SKU-A::DBN')).toEqual({ inTransit: 5, pendingPutaway: 0 })
  })
})
