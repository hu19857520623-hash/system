import { InboundService } from './inbound.service'
import * as receiving from './inbound-receiving-transaction.util'
import * as notifications from '../../common/oms-notify.util'

function fixture(status = 'pending_putaway') {
  const order = { id: 71n, inboundNo: 'RV-OWNED', status, warehouseCode: 'WMS-JHB-01', omsCustomerCode: 'TKL9001', remark: null,
    items: [{ id: 1n, productId: 681n, sku: 'TKL9001-WF1016A', expectedQty: 3, actualQty: 3, putawayQty: 0 }], cartons: [] }
  const prisma = { inboundOrder: { findUnique: jest.fn().mockResolvedValue(order) }, inventory: { findMany: jest.fn().mockResolvedValue([{ productId: 681n, availableQty: 4, lockedQty: 0 }]) } }
  const fees = { recordOperation: jest.fn().mockResolvedValue(null) }
  const service = new InboundService(prisma as any, null as any, null as any, null as any, null as any, fees as any)
  return { order, prisma, fees, service }
}
describe('客户入库作业提交后的OMS状态恢复', () => {
  afterEach(() => jest.restoreAllMocks())
  it.each(['recordReceivedCartonCount', 'receiveBox', 'scanQc', 'qc', 'qcAndMeasure', 'measureDimensions'] as const)('%s在同步失败时保留已提交结果，重放原请求后重新同步最新状态', async method => {
    const f = fixture(), request: any = { clientRequestId: 'original-request' }
    const result = { id: 71, inboundNo: 'RV-OWNED', status: 'pending_putaway', items: [{ actualQty: 3 }], measuredCount: 1 }
    const core = jest.spyOn(receiving, 'runInboundReceiving').mockResolvedValueOnce({ ...result, duplicate: false } as any).mockResolvedValueOnce({ ...result, duplicate: true } as any)
    const notify = jest.spyOn(notifications, 'notifyOms').mockResolvedValueOnce(false).mockResolvedValue(true)
    expect(await f.service[method](71, request, 51)).toMatchObject({ status: 'pending_putaway', syncPending: true, warning: expect.stringContaining('作业已保存') })
    expect(await f.service[method](71, request, 51)).toMatchObject({ duplicate: true, syncPending: false })
    expect(core.mock.calls[0]).toEqual(core.mock.calls[1])
    expect(notify.mock.calls.map(call => call[0])).toEqual(['inbound.status', 'inbound.status', 'inventory.changed'])
    expect(notify.mock.calls[2][2]).toMatchObject({ stockSource: 'owned', items: [{ sku: 'TKL9001-WF1016A', availableQty: 4, lockedQty: 0, pendingShelvingQty: 3 }] })
  })
  it('库存通知失败后原请求重试，不把状态通知成功当作全部同步完成', async () => {
    const f = fixture()
    jest.spyOn(receiving, 'runInboundReceiving').mockResolvedValue({ inboundNo: 'RV-OWNED', measuredCount: 0, items: [{ actualQty: 3 }] } as any)
    const notify = jest.spyOn(notifications, 'notifyOms').mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValue(true)
    expect(await f.service.qc(71, {} as any, 51)).toMatchObject({ syncPending: true })
    expect(await f.service.qc(71, {} as any, 51)).toMatchObject({ syncPending: false })
    expect(notify.mock.calls.map(call => call[0])).toEqual(['inbound.status', 'inventory.changed', 'inbound.status', 'inventory.changed'])
  })
  it('费用失败仍同步客户状态，并分别说明费用和同步的待处理项', async () => {
    const f = fixture()
    jest.spyOn(receiving, 'runInboundReceiving').mockResolvedValue({ inboundNo: 'RV-OWNED', measuredCount: 1, items: [{ actualQty: 3 }] } as any)
    f.fees.recordOperation.mockRejectedValue(new Error('Fee write failed'))
    jest.spyOn(notifications, 'notifyOms').mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false)
    expect(await f.service.qcAndMeasure(71, {} as any, 51)).toMatchObject({ feePending: true, syncPending: false, warning: expect.stringContaining('费用同步未完成') })
    expect(await f.service.qcAndMeasure(71, {} as any, 51)).toMatchObject({ feePending: true, syncPending: true, warning: expect.stringContaining('费用与OMS状态同步未完成') })
  })
  it('核心作业被拒绝时不发送通知，也不把失败包装为已保存', async () => {
    const f = fixture('receiving')
    jest.spyOn(receiving, 'runInboundReceiving').mockRejectedValue(new Error('单据版本已变更'))
    const notify = jest.spyOn(notifications, 'notifyOms').mockResolvedValue(true)
    await expect(f.service.qc(71, {} as any, 51)).rejects.toThrow('单据版本已变更')
    expect(notify).not.toHaveBeenCalled();expect(f.fees.recordOperation).not.toHaveBeenCalled()
  })
})
