import { ReturnsService } from './returns.service'

describe('return warehouse action receipts', () => {
  it('returns current state for original receipt after progress and rejects changed content or target', async () => {
    let row: any = { id: 1n, returnNo: 'RT-ONE', status: 'pending_arrival' }
    let receipt: any = null
    const tx: any = { $queryRaw: jest.fn(), syncLog: { create: jest.fn() }, operationLog: { findFirst: jest.fn(async () => receipt) },
      returnOrderItem: { aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 2 } }) }, returnOrder: {
        findUnique: jest.fn(async () => row), findUniqueOrThrow: jest.fn(async () => row),
        update: jest.fn(async ({ data }) => (row = { ...row, ...data })),
      } }
    const log = { log: jest.fn(async (params: any) => { receipt = params }) }
    const service = new ReturnsService({ $transaction: (work: any) => work(tx) } as any, log as any, null as any, null as any, null as any, null as any)
    jest.spyOn(service as any, 'enrichRow').mockImplementation((value: any) => value)
    jest.spyOn(service as any, 'pushReturnStatusToOms').mockResolvedValue(true)
    const body = { clientRequestId: 'a74c7176-47c0-43dc-abbe-f20213d00e39', receivedQty: 2, receivedCartonCount: 1 }
    await service.receive(1, body, 1)
    row.status = 'measured'
    expect((await service.receive(1, body, 1)).status).toBe('measured')
    await expect(service.receive(1, { ...body, receivedQty: 3 }, 1)).rejects.toThrow('内容已变化')
    await expect(service.receive(2, body, 1)).rejects.toThrow('内容已变化')
    expect(tx.returnOrder.update).toHaveBeenCalledTimes(1)
    expect(log.log).toHaveBeenCalledTimes(1)
    expect(tx.syncLog.create).toHaveBeenCalledTimes(1)
  })
})
