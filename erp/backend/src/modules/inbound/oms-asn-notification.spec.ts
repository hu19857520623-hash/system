import { InboundService } from './inbound.service'
import { notifyOms } from '../../common/oms-notify.util'
jest.mock('../../common/oms-notify.util', () => ({ notifyOms: jest.fn() }))

describe('入库通知真实失败状态', () => {
  beforeEach(() => jest.resetAllMocks())
  it.each([['completed', 2, 'shelved'], ['confirmed', 2, 'shelved'], ['completed', 3, 'shelved'], ['pending_putaway', 2, 'completed'], ['pending_putaway', 3, 'completed'], ['pending_putaway', 0, 'completed'], ['receiving', 2, 'receiving'], ['receiving', 3, 'receiving']])('仓库%s实收%s映射为%s，保留短收数量', (status, actualQty, expectedStatus) => {
    const service: any = Object.create(InboundService.prototype)
    const result = service.mapInboundForOms({ id: 127n, inboundNo: 'AUDIT-SHORT', status, warehouseCode: 'WMS-JHB-01', omsCustomerCode: 'TKL9069', remark: null, trackingNo: null,
      createdAt: new Date('2026-11-02T00:00:00Z'), updatedAt: new Date('2026-11-02T00:00:00Z'),
      items: [{ id: 1n, productId: 696n, sku: 'A', expectedQty: 3, actualQty }] })
    expect(result.omsStatus).toBe(expectedStatus);expect(result.totalExpectedQty).toBe(3);expect(result.totalReceivedQty).toBe(actualQty)
    expect(result.deliveryMethod).toBe('self')
  })
  it('非严格通知也必须将状态推送失败返回给调用方', async () => {
    const db: any = { inboundOrder: { findUnique: async () => ({ omsCustomerCode: 'TKL9069', items: [] }) } }
    const service: any = new InboundService(db, null as any, null as any, null as any, null as any, null as any)
    jest.spyOn(service, 'mapInboundForOms').mockReturnValue({ omsStatus: 'on_the_way' })
    jest.mocked(notifyOms).mockResolvedValue(false)
    expect(await service.pushInboundStatusToOms('TEST')).toBe(false)
    await expect(service.pushInboundStatusToOms('TEST', true)).rejects.toThrow('OMS入库状态待同步')
  })
  it('库存通知失败不能因状态通知成功而误报全部同步成功', async () => {
    const db: any = { inboundOrder: { findUnique: async () => ({ omsCustomerCode: 'TKL9069', items: [], warehouseCode: 'WMS-JHB-01' }) }, inventory: { findMany: async () => [] } }
    const service: any = new InboundService(db, null as any, null as any, null as any, null as any, null as any)
    jest.spyOn(service, 'mapInboundForOms').mockReturnValue({ omsStatus: 'shelved' })
    jest.mocked(notifyOms).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    expect(await service.pushInboundStatusToOms('TEST')).toBe(false)
  })
})
