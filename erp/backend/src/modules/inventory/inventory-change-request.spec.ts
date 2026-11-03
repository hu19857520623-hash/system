import { InventoryService } from './inventory.service'

describe('stable inventory change batch requests', () => {
  const uuid = '1e619e86-031c-4ed8-b758-c78b39b1b9bd'
  const row = { customerCode: 'TKL', sku: 'SKU-A', warehouseCode: 'WMS-A', toLocationCode: 'BIN-A', qty: 2 }
  it('retains the same per-row UUID across partial batch retries and distinguishes rows', async () => {
    const service = new InventoryService({ $transaction: (work: any) => work({ $queryRaw: jest.fn(), operationLog: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() }, sysUser: { findUnique: jest.fn().mockResolvedValue({}) } }) } as any, {} as any, {} as any)
    const apply = jest.spyOn(service, 'applyLocationChange').mockResolvedValue({} as any)
    apply.mockRejectedValueOnce(new Error('目标库位不存在'))
    const first = await service.batchApplyLocationChange({ clientRequestId: uuid, rows: [row, { ...row, toLocationCode: 'BIN-B' }] }, 7)
    expect(first).toMatchObject({ ok: 1, fail: 1 })
    const original = apply.mock.calls.map(call => call[0].clientRequestId)
    await service.batchApplyLocationChange({ clientRequestId: uuid, rows: [row, { ...row, toLocationCode: 'BIN-B' }] }, 7)
    expect(apply.mock.calls.slice(2).map(call => call[0].clientRequestId)).toEqual(original)
    expect(original[0]).not.toBe(original[1])
    expect(original.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/i.test(id!))).toBe(true)
  })
  it('rejects invalid batch identities without applying a row', async () => {
    const service = new InventoryService({ $transaction: (work: any) => work({ $queryRaw: jest.fn(), operationLog: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() }, sysUser: { findUnique: jest.fn().mockResolvedValue({}) } }) } as any, {} as any, {} as any)
    const apply = jest.spyOn(service, 'applyLocationChange')
    await expect(service.batchApplyLocationChange({ clientRequestId: 'bad', rows: [row] }, 7)).rejects.toThrow('原请求标识无效')
    expect(apply).not.toHaveBeenCalled()
  })
  it('rejects changed batch content before running any row', async () => {
    const tx = { $queryRaw: jest.fn(), operationLog: { findFirst: jest.fn().mockResolvedValue({ detail: { batchFingerprint: 'original' } }) } }
    const service = new InventoryService({ $transaction: (work: any) => work(tx) } as any, {} as any, {} as any)
    const apply = jest.spyOn(service, 'applyLocationChange')
    await expect(service.batchApplyLocationChange({ clientRequestId: uuid, rows: [row, row] }, 7)).rejects.toThrow('勿更改、追加或重排行')
    expect(apply).not.toHaveBeenCalled()
  })

})
