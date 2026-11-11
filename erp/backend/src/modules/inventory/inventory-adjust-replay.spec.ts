import { createHash } from 'crypto'
import { InventoryService } from './inventory.service'

describe('inventory adjustment original receipt', () => {
  const body = { clientRequestId: '1e619e86-031c-4ed8-b758-c78b39b1b9bd', qty: 4, locationCode: 'BIN-B', customerCode: 'TKL', remark: '移库' }
  function fixture(fingerprint?: string) {
    const requestFingerprint = fingerprint ?? createHash('sha256').update(JSON.stringify({ id: 1, qty: 4, locationCode: 'BIN-B', customerCode: 'TKL', remark: '移库' })).digest('hex')
    const result = { id: 1, sku: 'SKU-A', locationCode: 'BIN-B', qty: 4, moved: true }
    const tx = { $queryRaw: jest.fn(), operationLog: { findFirst: jest.fn().mockResolvedValue({ detail: { requestFingerprint, result } }) }, inventoryLocation: { findUnique: jest.fn().mockResolvedValue(null) } }
    const service = new InventoryService({ $transaction: (fn: any) => fn(tx) } as any, {} as any, {} as any)
    return { tx, service, result }
  }
  it('returns original move after source row was deleted, without reading or mutating it', async () => {
    const f = fixture()
    expect(await f.service.updateLocationLine(1, body, 7)).toEqual({ ...f.result, duplicate: true })
    expect(f.tx.inventoryLocation.findUnique).not.toHaveBeenCalled()
    expect(f.tx.operationLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ operatorId: 7n }) }))
  })
  it('rejects altered quantity, target or source identity', async () => {
    const f = fixture()
    await expect(f.service.updateLocationLine(1, { ...body, qty: 5 }, 7)).rejects.toThrow('原库存调整请求内容不同')
    await expect(f.service.updateLocationLine(1, { ...body, locationCode: 'BIN-C' }, 7)).rejects.toThrow('原库存调整请求内容不同')
    await expect(f.service.updateLocationLine(2, body, 7)).rejects.toThrow('原库存调整请求内容不同')
    expect(f.tx.inventoryLocation.findUnique).not.toHaveBeenCalled()
  })
  it('rejects invalid UUID or missing actor before opening a transaction', async () => {
    const f = fixture()
    await expect(f.service.updateLocationLine(1, { ...body, clientRequestId: 'invalid' }, 7)).rejects.toThrow('原请求标识无效')
    await expect(f.service.updateLocationLine(1, body)).rejects.toThrow('原请求标识无效')
    expect(f.tx.$queryRaw).not.toHaveBeenCalled()
  })
})
