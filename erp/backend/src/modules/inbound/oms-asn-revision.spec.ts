import { InboundService } from './inbound.service'
import { omsAsnControl, omsAsnVersion } from './oms-asn-control.util'

function fixture(status = 'pending_receipt') {
  const events: string[] = []
  const order: any = { id: 1n, inboundNo: 'TEST-ASN', status, omsCustomerCode: 'TKL9069', warehouseCode: 'WMS-JHB-01', receivedCartonCount: 0, items: [{ id: 1n, sku: 'A', productId: 1n, expectedQty: 1, actualQty: 0, putawayQty: 0 }], cartons: [] }
  const tx: any = {
    $queryRaw: jest.fn(async (parts: TemplateStringsArray) => { events.push(parts.join('?')); return [] }),
    warehouse: { findUnique: jest.fn(async () => ({ warehouseType: 'wms' })) },
    inboundOrder: { findUnique: jest.fn(async () => { events.push('read'); return order }), update: jest.fn(async ({ data }) => ({ ...order, ...data, items: order.items })), findUniqueOrThrow: jest.fn(async () => ({ ...order, status: 'pending_receipt' })) },
    inboundCarton: { deleteMany: jest.fn() }, inboundOrderItem: { deleteMany: jest.fn() }, operationLog: { create: jest.fn(), findFirst: jest.fn(async () => null) },
  }
  const db: any = { $transaction: jest.fn(async fn => fn(tx)) }
  const service: any = new InboundService(db, null as any, null as any, null as any, null as any, null as any)
  jest.spyOn(service, 'resolveOmsAsnLines').mockResolvedValue([{ productId: 1n, sku: 'A', qty: 1, productName: '商品A', boxNo: 1 }])
  jest.spyOn(service, 'persistCartons').mockResolvedValue(undefined)
  jest.spyOn(service, 'saveOmsAsnAttachments').mockResolvedValue(undefined)
  jest.spyOn(service, 'mapInboundForOms').mockImplementation((value: any) => ({ status: value.status }))
  jest.spyOn(service, 'pushInboundStatusToOms').mockResolvedValue(true)
  return { service, db, tx, order, events, body: { customerCode: 'TKL9069', clientRequestId: '4b9f78d8-4688-47a3-a46d-222222222222', expectedVersion: omsAsnVersion(order), items: [{ sku: 'A', qty: 1 }] } }
}

describe('客户修改、重新下单与作废的事务边界', () => {
  it.each(['update', 'reactivate'])('%s 在读取状态前锁定单据，商品、箱明细、附件和日志使用同一事务', async mode => {
    const f = fixture(mode === 'reactivate' ? 'cancelled' : 'pending_receipt')
    await f.service.saveOmsAsnRevision('TEST-ASN', f.body, mode)
    expect(f.events[0]).toContain('customer'); expect(f.events[1]).toContain('inbound_order'); expect(f.events[2]).toBe('read')
    expect(f.service.resolveOmsAsnLines).toHaveBeenCalledWith(f.body.items, 'TKL9069', f.tx)
    expect(f.service.saveOmsAsnAttachments).toHaveBeenCalledWith(1n, undefined, f.tx, [], true)
    expect(f.tx.operationLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: mode === 'update' ? 'oms_asn_update' : 'oms_asn_reactivate' }) }))
  })

  it.each(['arrived', 'receiving', 'completed'])('仓库已到达 %s 时不能修改或作废', async status => {
    const f = fixture(status)
    await expect(f.service.saveOmsAsnRevision('TEST-ASN', f.body, 'update')).rejects.toThrow('仅在途状态')
    await expect(f.service.cancelAsnFromOms('TEST-ASN', f.body)).rejects.toThrow('仅在途状态')
    expect(f.tx.inboundOrder.update).not.toHaveBeenCalled(); expect(f.service.resolveOmsAsnLines).not.toHaveBeenCalled()
  })

  it('即使状态仍显示在途，有已收箱数也不能改写或作废', async () => {
    const f = fixture(); f.order.receivedCartonCount = 1
    await expect(f.service.saveOmsAsnRevision('TEST-ASN', f.body, 'update')).rejects.toThrow('已开始收货')
    await expect(f.service.cancelAsnFromOms('TEST-ASN', f.body)).rejects.toThrow('已开始收货')
    expect(f.tx.inboundOrder.update).not.toHaveBeenCalled()
  })

  it('已作废的重复请求只重发通知，失败时明确返回待同步', async () => {
    const f = fixture('cancelled'); f.service.pushInboundStatusToOms.mockResolvedValue(false)
    f.tx.operationLog.findFirst.mockResolvedValue({ targetId: 'TEST-ASN', detail: omsAsnControl('TEST-ASN', 'cancel', f.body) })
    await expect(f.service.cancelAsnFromOms('TEST-ASN', f.body)).resolves.toMatchObject({ status: 'cancelled', idempotent: true, syncPending: true })
    expect(f.tx.inboundOrder.update).not.toHaveBeenCalled(); expect(f.tx.operationLog.create).not.toHaveBeenCalled()
    expect(f.service.pushInboundStatusToOms).toHaveBeenCalledWith('TEST-ASN')
  })
})
