import { ReturnsService } from './returns.service'

describe('return creation replay', () => {
  it('re-reads the winning request after a unique number collision and retries notification without another audit', async () => {
    const customer = { id: 1n, status: 1 }
    const row = { id: 2n, returnNo: 'RT-ONE', omsCustomerCode: 'TKL', status: 'pending_arrival', orderNo: 'ORDER', returnReason: '退货', returnWarehouse: 'JHB3', requestedProcess: 'restock', items: [{ sku: 'A', quantity: 1, productName: 'A' }], attachments: [] }
    let attempt = 0
    const tx = {
      $queryRaw: jest.fn(), customer: { findUnique: jest.fn().mockResolvedValue(customer) },
      operationLog: { findFirst: jest.fn().mockResolvedValue(null) },
      returnOrder: {
        findUnique: jest.fn(async () => attempt === 1 ? null : row),
        create: jest.fn(async () => { throw Object.assign(Error('unique'), { code: 'P2002' }) }),
      },
    }
    const prisma = { customer: tx.customer, $transaction: async (work: any) => { attempt++; return work(tx) } }
    const log = { log: jest.fn() }
    const service = new ReturnsService(prisma as any, log as any, null as any, null as any, null as any, null as any)
    jest.spyOn(service as any, 'mapReturnForOms').mockImplementation((value: any) => value)
    const notify = jest.spyOn(service as any, 'pushReturnStatusToOms').mockResolvedValue(true)
    const result = await service.createFromOms({ customerCode: 'TKL', returnNo: 'RT-ONE', orderNo: 'ORDER', returnReason: '退货', returnWarehouse: 'JHB3', requestedProcess: 'restock', items: [{ sku: 'A', quantity: 1 }] })
    expect(result.idempotent).toBe(true)
    expect(attempt).toBe(2)
    expect(tx.returnOrder.create).toHaveBeenCalledTimes(1)
    expect(log.log).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith('RT-ONE')
  })
})
