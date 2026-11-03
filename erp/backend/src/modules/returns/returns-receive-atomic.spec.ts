import { ReturnsService } from './returns.service'

describe('return receipt and correction atomicity', () => {
  it.each(['receive', 'reReceive'] as const)('%s rolls back quantities, measurements and pending charges when audit fails, then retries', async method => {
    let state = { status: method === 'receive' ? 'pending_arrival' : 'fee_calculated', receivedQty: 2, cartons: 1, charges: 1 }
    let fail = true
    const root: any = { $transaction: jest.fn(async (work: any) => {
      const draft = { ...state }
      const tx: any = {
        $queryRaw: jest.fn(),
        $executeRawUnsafe: jest.fn(async () => { draft.charges = 0 }),
        returnOrder: {
          findUnique: jest.fn(async () => ({ id: 1n, returnNo: 'RT-ONE', ...draft })),
          update: jest.fn(async ({ data }) => { Object.assign(draft, data); return { id: 1n, returnNo: 'RT-ONE', ...draft } }),
        },
        returnOrderItem: { aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 2 } }) },
        returnCartonMeasure: { deleteMany: jest.fn(async () => { draft.cartons = 0 }) },
      }
      const result = await work(tx)
      state = draft
      return result
    }) }
    const log = { log: jest.fn(async (_params, tx) => { expect(tx).toBeDefined(); expect(tx.$queryRaw).toHaveBeenCalledTimes(1); if (fail) throw Error('审计暂不可用') }) }
    const service = new ReturnsService(root, log as any, null as any, null as any, null as any, null as any)
    const notify = jest.spyOn(service as any, 'pushReturnStatusToOms').mockResolvedValue(true)
    jest.spyOn(service as any, 'enrichRow').mockImplementation((row: any) => row)
    const before = { ...state }
    await expect(service[method](1, { receivedQty: 3, receivedCartonCount: 1 }, 1)).rejects.toThrow('审计暂不可用')
    expect(state).toEqual(before)
    expect(notify).not.toHaveBeenCalled()
    fail = false
    await service[method](1, { receivedQty: 3, receivedCartonCount: 1 }, 1)
    expect(state.status).toBe('received')
    expect(state.receivedQty).toBe(3)
    expect(state.cartons).toBe(method === 'reReceive' ? 0 : 1)
    expect(state.charges).toBe(method === 'reReceive' ? 0 : 1)
    expect(notify).toHaveBeenCalledTimes(1)
  })
})
