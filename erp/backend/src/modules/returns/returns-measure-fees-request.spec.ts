import { ReturnsService, type ReturnMeasureFeesInput } from './returns.service'

const request: ReturnMeasureFeesInput = { clientRequestId: '10000000-0000-4000-8000-000000000001', expectedRevision: 'a'.repeat(64), mode: 'replace', cartons: [{ lengthCm: 10, widthCm: 20, heightCm: 30, grossWeightKg: 1 }] }
function fixture() {
  let state: any = { status: 'received', version: 'a'.repeat(64), measurements: 0, fees: 0, receipts: [] }
  let draft: any
  const faults = { fee: false, audit: false }
  const row = () => ({ id: 1n, returnNo: 'RT-ONE', customerId: 2n, status: draft.status, cartons: request.cartons, estimatedFeeTotal: 8 })
  const tx: any = {
    $queryRaw: jest.fn(),
    returnOrder: { findUnique: jest.fn(async () => row()) },
    operationLog: { findFirst: jest.fn(async ({ where }) => where.detail
      ? draft.receipts.find((r: any) => r.actor === where.operatorId && r.detail.clientRequestId === where.detail.equals) || null : null) },
  }
  const prisma: any = { $transaction: jest.fn(async (work: any) => {
    draft = structuredClone(state)
    const result = await work(tx)
    state = draft
    return result
  }) }
  const log = { log: jest.fn(async (params, client) => {
    expect(client).toBe(tx)
    if (faults.audit) throw Error('审计暂不可用')
    draft.receipts.push({ actor: BigInt(params.operatorId), detail: params.detail })
  }) }
  const billing = { pushCustomerBillingToOms: jest.fn().mockResolvedValue(true) }
  const service = new ReturnsService(prisma, log as any, null as any, billing as any, null as any, null as any)
  const measure = jest.spyOn(service as any, 'measureInTransaction').mockImplementation(async () => { draft.measurements++; draft.status = 'measured'; draft.version = 'b'.repeat(64); return row() })
  const calculate = jest.spyOn(service as any, 'calculateFeesInTransaction').mockImplementation(async () => { draft.fees++; draft.status = 'fee_calculated'; if (faults.fee) throw Error('计费暂不可用'); return row() })
  jest.spyOn(service as any, 'measurementVersion').mockImplementation(async () => draft.version)
  const notify = jest.spyOn(service as any, 'pushReturnStatusToOms').mockResolvedValue(true)
  return { service, faults, measure, calculate, tx, prisma, notify, billing, get state() { return state } }
}

describe('durable combined return measurement and fees', () => {
  it.each(['fee', 'audit'] as const)('rolls back both stages on %s failure and permits the original request to recover exactly once', async fault => {
    const f = fixture(), before = structuredClone(f.state)
    f.faults[fault] = true
    await expect(f.service.measureAndCalculate(1, request, 7)).rejects.toThrow()
    expect(f.state).toEqual(before)
    expect(f.notify).not.toHaveBeenCalled()
    expect(f.billing.pushCustomerBillingToOms).not.toHaveBeenCalled()
    f.faults[fault] = false
    await expect(f.service.measureAndCalculate(1, request, 7)).resolves.toMatchObject({ outcome: 'applied', duplicate: false })
    expect(f.state).toMatchObject({ measurements: 1, fees: 1 })
    const applied = structuredClone(f.state)
    await expect(f.service.measureAndCalculate(1, request, 7)).resolves.toMatchObject({ outcome: 'applied', duplicate: true })
    expect(f.state).toEqual(applied)
    expect(f.notify).toHaveBeenCalledTimes(1)
    expect(f.billing.pushCustomerBillingToOms).toHaveBeenCalledTimes(1)
  })

  it('binds a receipt to actor, return and contents, and replays before checking the current source', async () => {
    const f = fixture()
    await f.service.measureAndCalculate(1, request, 7)
    const applied = structuredClone(f.state)
    await expect(f.service.measureAndCalculate(2, request, 7)).rejects.toThrow('内容或单号已变化')
    await expect(f.service.measureAndCalculate(1, { ...request, cartons: [{ ...request.cartons[0], lengthCm: 99 }] }, 7)).rejects.toThrow('内容或单号已变化')
    await expect(f.service.measureAndCalculate(1, request, 8)).rejects.toThrow('退件记录已变化')
    expect(f.state).toEqual(applied)
    f.tx.returnOrder.findUnique.mockClear().mockResolvedValue(null)
    await expect(f.service.measureAndCalculate(1, request, 7, true)).resolves.toMatchObject({ outcome: 'applied', duplicate: true })
    expect(f.tx.returnOrder.findUnique).not.toHaveBeenCalled()
  })

  it('closes an uncommitted original request before a delayed submission can write either stage', async () => {
    const f = fixture()
    await expect(f.service.measureAndCalculate(1, request, 7, true)).resolves.toMatchObject({ outcome: 'closed', duplicate: false })
    const closed = structuredClone(f.state)
    await expect(f.service.measureAndCalculate(1, request, 7)).resolves.toMatchObject({ outcome: 'closed', duplicate: true })
    expect(f.state).toEqual(closed)
    expect(f.measure).not.toHaveBeenCalled()
    expect(f.calculate).not.toHaveBeenCalled()
    expect(f.notify).not.toHaveBeenCalled()
  })

  it('continues existing measurements without rewriting them, and rejects changes to the recorded version or cartons', async () => {
    const f = fixture(), p = { ...request, mode: 'existing' as const }
    f.state.status = 'measured'
    await expect(f.service.measureAndCalculate(1, { ...p, expectedRevision: 'c'.repeat(64) }, 7)).rejects.toThrow('退件记录已变化')
    await expect(f.service.measureAndCalculate(1, { ...p, cartons: [{ ...request.cartons[0], lengthCm: 99 }] }, 7)).rejects.toThrow('测量记录已变化')
    await expect(f.service.measureAndCalculate(1, p, 7)).resolves.toMatchObject({ outcome: 'applied' })
    expect(f.measure).not.toHaveBeenCalled()
    expect(f.state.measurements).toBe(0)
    expect(f.state.fees).toBe(1)
  })

  it('requires a valid original id and version before entering a transaction', async () => {
    const f = fixture()
    await expect(f.service.measureAndCalculate(1, { ...request, clientRequestId: '' }, 7)).rejects.toThrow('原测量操作标识')
    await expect(f.service.measureAndCalculate(1, { ...request, expectedRevision: '' }, 7)).rejects.toThrow('原退件版本')
    expect(f.prisma.$transaction).not.toHaveBeenCalled()
  })
})
