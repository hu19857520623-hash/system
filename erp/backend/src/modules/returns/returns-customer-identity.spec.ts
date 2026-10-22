import { ReturnsService } from './returns.service'

describe('OMS return number ownership', () => {
  it.each(['pending_arrival', 'cancelled'])('rejects a different customer reusing an existing %s return number', async status => {
    const prisma = { customer: { findUnique: jest.fn().mockResolvedValue({ id: 1n, status: 1 }) },
      returnOrder: { findUnique: jest.fn().mockResolvedValue({ id: 2n, status, omsCustomerCode: 'TKL9002' }) } }
    const service = new ReturnsService(prisma as any, null as any, null as any, null as any, null as any, null as any)
    await expect(service.createFromOms({ customerCode: 'TKL9001', returnNo: 'RT-EXISTING', orderNo: 'O1', returnReason: '平台退货', requestedProcess: 'restock', returnWarehouse: 'JHB3', items: [{ sku: 'A', quantity: 1 }] }))
      .rejects.toThrow('客户编码与退件单不匹配，请刷新核对单号')
    expect(prisma.returnOrder.findUnique).toHaveBeenCalledTimes(1)
  })
  it('uses Chinese decision validation instead of internal enum names', async () => {
    const service = new ReturnsService(null as any, null as any, null as any, null as any, null as any, null as any)
    await expect(service.decideFromOms('RT-ONE', { decision: 'invalid' as any })).rejects.toThrow('请选择留货或不留货的处理决定')
  })
  it.each(['receive', 'reReceive'] as const)('%s rejects fractional and invalid quantities before writing or clearing charges', async method => {
    const prisma = { returnOrder: { findUnique: jest.fn().mockResolvedValue({ id: 1n, status: method === 'receive' ? 'pending_arrival' : 'received' }) }, returnOrderItem: { aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 2 } }) } }
    const service = new ReturnsService(prisma as any, null as any, null as any, null as any, null as any, null as any)
    for (const value of [1.5, NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(service[method](1, { receivedQty: value, receivedCartonCount: 1 }, 1)).rejects.toThrow('实收件数须为大于零的整数')
      await expect(service[method](1, { receivedQty: 2, receivedCartonCount: value }, 1)).rejects.toThrow('实收箱数须为大于零的整数')
    }
  })
})
