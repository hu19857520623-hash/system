import { ReturnsService } from './returns.service'

describe('return measurement failure recovery', () => {
  it('preserves prior cartons and pending fees on audit failure, then allows the original measurement', async () => {
    let state = { status: 'fee_calculated', cartons: 2, charges: 1 }
    let fail = true
    let active: any
    const root: any = { $transaction: jest.fn(async (work: any) => {
      const draft = { ...state }
      active = {
        $queryRaw: jest.fn(), syncLog: { create: jest.fn().mockResolvedValue({ id: 1n }) },
        $executeRawUnsafe: jest.fn(async () => { draft.charges = 0 }),
        returnOrder: {
          findUnique: jest.fn(async () => ({ id: 1n, returnNo: 'RT-MEASURE', ...draft })),
          update: jest.fn(async ({ data }) => { Object.assign(draft, data); return { id: 1n, returnNo: 'RT-MEASURE', ...draft } }),
        },
        returnCartonMeasure: {
          deleteMany: jest.fn(async () => { draft.cartons = 0 }),
          create: jest.fn(async () => { draft.cartons++ }),
        },
      }
      const result = await work(active)
      state = draft
      return result
    }) }
    const log = { log: jest.fn(async (_params, tx) => {
      expect(tx).toBe(active)
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1)
      expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(1)
      if (fail) throw Error('审计暂不可用')
    }) }
    const service = new ReturnsService(root, log as any, null as any, null as any, null as any, null as any)
    const notify = jest.spyOn(service as any, 'pushReturnStatusToOms').mockResolvedValue(true)
    jest.spyOn(service as any, 'enrichRow').mockImplementation((row: any) => row)
    const body = { cartons: [{ lengthCm: 10, widthCm: 20, heightCm: 30, grossWeightKg: 2 }] }
    const before = { ...state }
    await expect(service.measure(1, body, 1)).rejects.toThrow('审计暂不可用')
    expect(state).toEqual(before)
    expect(notify).not.toHaveBeenCalled()
    fail = false
    await service.measure(1, body, 1)
    expect(state).toMatchObject({ status: 'measured', cartons: 1, charges: 0 })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(root.$transaction).toHaveBeenLastCalledWith(expect.any(Function), { isolationLevel: 'ReadCommitted' })
  })
})
