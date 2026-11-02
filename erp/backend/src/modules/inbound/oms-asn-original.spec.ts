import { InboundService } from './inbound.service'
import { omsAsnControl, omsAsnCreateControl } from './oms-asn-control.util'
import { OmsAsnOriginalDto } from './dto/oms-asn.dto'

const no = 'RVTKL9069-ORIGINAL'
const original = { inboundNo: no, customerCode: 'TKL9069', clientRequestId: '4b9f78d8-4688-47a3-a46d-222222222222', expectedVersion: 'a'.repeat(64), items: [{ sku: 'A', qty: 1 }] }
function fixture(exists = true) {
  const receipts: any[] = [], events: string[] = []
  const order: any = { id: 1n, inboundNo: no, omsCustomerCode: 'TKL9069', status: 'arrived', items: [], cartons: [] }
  const tx: any = {
    $queryRaw: jest.fn(async (parts: TemplateStringsArray) => { events.push(parts.join('?')); return [] }),
    customer: { findUnique: jest.fn(async () => ({ status: 1 })) },
    warehouse: { findUnique: jest.fn(async () => ({ warehouseType: 'wms' })) },
    inboundOrder: { findUnique: jest.fn(async () => exists ? order : null), create: jest.fn(), update: jest.fn() },
    operationLog: { findFirst: jest.fn(async ({ where }) => receipts.find(row => row.detail.clientRequestId === where.AND[1].detail.equals) || null),
      create: jest.fn(async ({ data }) => { receipts.push(data); return data }) },
  }
  const db: any = { $transaction: jest.fn(async fn => fn(tx)), $queryRawUnsafe: jest.fn(async () => []) }
  const service = new InboundService(db, null as any, null as any, null as any, null as any, null as any)
  jest.spyOn(service as any, 'mapInboundForOms').mockImplementation((row: any) => ({ inboundNo: row.inboundNo, status: row.status }))
  jest.spyOn(service as any, 'resolveOmsAsnLines').mockRejectedValue(new Error('不应写商品'))
  return { service, tx, db, order, receipts, events }
}
const input = (kind: OmsAsnOriginalDto['kind'] = 'create'): OmsAsnOriginalDto => ({ customerCode: 'TKL9069', kind,
  original: kind === 'cancel' ? { customerCode: original.customerCode, clientRequestId: original.clientRequestId, expectedVersion: original.expectedVersion } : { ...original } })

describe('原入库请求服务器核对和阻止迟到执行', () => {
  it('只查不到回执时不声称未执行，也不写取消记录', async () => {
    const f = fixture(false)
    await expect(f.service.resolveAsnOriginal(no, input())).resolves.toMatchObject({ outcome: 'unresolved', order: null, message: expect.stringContaining('不能据此认定未执行') })
    expect(f.tx.operationLog.create).not.toHaveBeenCalled(); expect(f.tx.inboundOrder.create).not.toHaveBeenCalled()
  })
  it('取消未执行创建后，迟到的原创建被拒绝；重复取消只保留一条记录', async () => {
    const f = fixture(false)
    await expect(f.service.resolveAsnOriginal(no, input(), true)).resolves.toMatchObject({ outcome: 'cancelled', order: null })
    await expect(f.service.resolveAsnOriginal(no, input(), true)).resolves.toMatchObject({ outcome: 'cancelled' })
    await expect(f.service.createAsnFromOms(original)).rejects.toThrow('已确认取消')
    expect(f.tx.operationLog.create).toHaveBeenCalledTimes(1)
    expect(f.tx.inboundOrder.create).not.toHaveBeenCalled(); expect((f.service as any).resolveOmsAsnLines).not.toHaveBeenCalled()
    expect(f.events[0]).toContain('customer')
  })
  it.each(['update', 'reactivate', 'cancel'] as const)('%s 取消记录也阻止原业务入口，不触及仓库结果', async kind => {
    const f = fixture(), body = input(kind)
    await expect(f.service.resolveAsnOriginal(no, body, true)).resolves.toMatchObject({ outcome: 'cancelled', order: { status: 'arrived' } })
    const execute = kind === 'cancel' ? () => f.service.cancelAsnFromOms(no, body.original as any)
      : kind === 'update' ? () => f.service.updateAsnFromOms(no, body.original as any) : () => f.service.reactivateAsnFromOms(no, body.original as any)
    await expect(execute()).rejects.toThrow('已确认取消')
    expect(f.tx.inboundOrder.update).not.toHaveBeenCalled(); expect((f.service as any).resolveOmsAsnLines).not.toHaveBeenCalled()
    expect(f.events[0]).toContain('customer'); expect(f.events[1]).toContain('inbound_order')
  })
  it.each(['create', 'update', 'reactivate', 'cancel'] as const)('已完成 %s 时只返回执行回执和最新仓库进度，不写取消或再次执行', async kind => {
    const f = fixture(), body = input(kind)
    const request = kind === 'create' ? omsAsnCreateControl(no, body.original) : omsAsnControl(no, kind, body.original)
    f.receipts.push({ action: kind === 'cancel' ? 'oms_asn_cancel' : `oms_asn_${kind}`, targetId: no, detail: { customerCode: 'TKL9069', ...request } })
    await expect(f.service.resolveAsnOriginal(no, body, true)).resolves.toMatchObject({ outcome: 'completed', order: { status: 'arrived' } })
    if (kind === 'create') await expect(f.service.createAsnFromOms(original)).resolves.toMatchObject({ idempotent: true, status: 'arrived' })
    expect(f.tx.operationLog.create).not.toHaveBeenCalled(); expect(f.tx.inboundOrder.update).not.toHaveBeenCalled()
    expect((f.service as any).resolveOmsAsnLines).not.toHaveBeenCalled()
  })
  it('同操作标识更换内容或单号不能取消另一条请求', async () => {
    const f = fixture()
    await f.service.resolveAsnOriginal(no, input(), true)
    await expect(f.service.resolveAsnOriginal(no, { ...input(), original: { ...original, items: [{ sku: 'A', qty: 2 }] } }, true)).rejects.toThrow('不要修改后重试')
    await expect(f.service.resolveAsnOriginal('OTHER', { ...input(), original: { ...original, inboundNo: 'OTHER' } }, true)).rejects.toThrow('不要修改后重试')
    expect(f.tx.operationLog.create).toHaveBeenCalledTimes(1)
  })
  it.each([
    { ...input(), kind: 'unknown' },
    { ...input(), original: [] },
    { ...input(), original: { ...original, customerCode: 'OTHER' } },
    { ...input(), original: { ...original, inboundNo: 'OTHER' } },
    { ...input(), original: { ...original, clientRequestId: 'bad-id' } },
    { ...input('update'), original: { ...original, expectedVersion: '' } },
    { ...input(), original: { ...original, items: [{ sku: 'A', qty: 0 }] } },
    { ...input('cancel'), original: { ...input('cancel').original, items: [] } },
  ])('非法原请求不创建取消回执 %p', async body => {
    const f = fixture()
    await expect(f.service.resolveAsnOriginal(no, body as OmsAsnOriginalDto, true)).rejects.toThrow()
    expect(f.db.$transaction).not.toHaveBeenCalled(); expect(f.tx.operationLog.create).not.toHaveBeenCalled()
  })
  it('不暴露其他客户单据，不给停用客户写入取消回执', async () => {
    const f = fixture(); f.order.omsCustomerCode = 'OTHER'
    await expect(f.service.resolveAsnOriginal(no, input(), true)).rejects.toThrow('当前客户的入库单不存在')
    f.tx.customer.findUnique.mockResolvedValue({ status: 0 })
    await expect(f.service.resolveAsnOriginal(no, input(), true)).rejects.toThrow('客户已停用')
    expect(f.tx.operationLog.create).not.toHaveBeenCalled()
  })
  it('取消回执提交失败必须抛出，不返回已取消', async () => {
    const f = fixture(false); f.tx.operationLog.create.mockRejectedValue(new Error('数据库提交失败'))
    await expect(f.service.resolveAsnOriginal(no, input(), true)).rejects.toThrow('数据库提交失败')
    expect(f.tx.inboundOrder.create).not.toHaveBeenCalled()
  })
  it('等待单据锁期间客户归属变化，重新读取后拒绝返回其他客户明细', async () => {
    const f = fixture()
    f.tx.inboundOrder.findUnique.mockResolvedValueOnce(f.order).mockResolvedValueOnce({ ...f.order, omsCustomerCode: 'OTHER' })
    await expect(f.service.resolveAsnOriginal(no, input(), true)).rejects.toThrow('当前客户的入库单不存在')
    expect(f.tx.operationLog.create).not.toHaveBeenCalled(); expect((f.service as any).mapInboundForOms).not.toHaveBeenCalled()
  })
})
