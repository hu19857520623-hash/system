import { createHash } from 'crypto'
import { InventoryService } from './inventory.service'

describe('close original stock batch under actor lock', () => {
  const input = { clientRequestId: '1e619e86-031c-4ed8-b758-c78b39b1b9bd', rows: [{ customerCode: 'TKL', sku: 'A', warehouseCode: 'WMS-A', toLocationCode: 'BIN-A', qty: 2 }, { customerCode: 'TKL', sku: 'B', warehouseCode: 'WMS-A', toLocationCode: 'BIN-B', qty: 3 }] }
  function fixture() {
    let closed: any = null
    let row = 0
    const tx: any = { $queryRaw: jest.fn(), sysUser: { findUnique: jest.fn().mockResolvedValue({ realName: '仓库员' }) }, operationLog: {
      findFirst: jest.fn(async ({ where }) => {
        if (where.action === 'location_batch_closed') return closed
        if (where.action === 'location_batch_request') return { detail: { batchFingerprint: createHash('sha256').update(JSON.stringify(input.rows)).digest('hex') } }
        return ++row === 1 ? { detail: { result: {} } } : null
      }),
      create: jest.fn(async ({ data }) => { closed = data; return data }),
    } }
    const service = new InventoryService({ $transaction: (work: any) => work(tx) } as any, {} as any, {} as any)
    return { service, tx }
  }
  it('reports applied rows, closes once and returns the same closure on retry', async () => {
    const f = fixture()
    const result = await f.service.closeLocationChangeBatch(input, 7)
    expect(result).toMatchObject({ status: 'closed', appliedIndices: [0], unappliedIndices: [1] })
    expect(await f.service.closeLocationChangeBatch(input, 7)).toEqual(result)
    expect(f.tx.operationLog.create).toHaveBeenCalledTimes(1)
    await expect(f.service.batchApplyLocationChange(input, 7)).rejects.toThrow('原批次已结束')
  })
  it('rejects altered original rows before writing closure', async () => {
    const f = fixture()
    await expect(f.service.closeLocationChangeBatch({ ...input, rows: [input.rows[1]] }, 7)).rejects.toThrow('与原批次内容不同')
    expect(f.tx.operationLog.create).not.toHaveBeenCalled()
  })
  it('blocks a late uncommitted row after closure', async () => {
    const f = fixture(); await f.service.closeLocationChangeBatch(input, 7)
    await expect(f.service.applyLocationChange({ ...input.rows[1], clientRequestId: '2e619e86-031c-4ed8-b758-c78b39b1b9bd', batchRequestId: input.clientRequestId }, 7)).rejects.toThrow('原批次已结束')
  })
})
