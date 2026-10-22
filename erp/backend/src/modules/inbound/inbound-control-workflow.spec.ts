import 'reflect-metadata'
import { randomUUID } from 'crypto'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { InboundControlDto } from './dto/inbound-control.dto'
import { runInboundControl, type InboundControlKind } from './inbound-control-transaction.util'
import { inboundReceivingVersion } from './inbound-receiving-version.util'
import { inboundCartonReadiness } from './inbound-carton-readiness.util'
import { runInboundReceiving } from './inbound-receiving-transaction.util'
import { InventoryMutationService } from '../../common/inventory/inventory-mutation.service'

function fixture(status = 'pending_putaway', actualQty = 3) {
  let state: any = { order: { id: 1n, inboundNo: 'RV-CONTROL', warehouseCode: 'WMS-JHB-01', status, receivedCartonCount: 2,
    items: [{ id: 1n, productId: 11n, sku: 'SKU-1', expectedQty: 3, actualQty, putawayQty: 0 }, { id: 2n, productId: 12n, sku: 'SKU-2', expectedQty: 2, actualQty: 0, putawayQty: 0 }],
    cartons: [1, 2].map(id => ({ id: BigInt(id), boxCode: `BOX-${id}`, status: 'received', receivedAt: new Date(2026, 9, 22, 10, id) })), putawayItems: [] }, operations: [], inventory: { id: 1n, productId: 11n, sku: 'SKU-1', warehouseCode: 'WMS-JHB-01', totalQty: 0, availableQty: 0, lockedQty: 0 }, lot: { id: 1n, productId: 11n, sku: 'SKU-1', warehouseCode: 'WMS-JHB-01', locationId: 1n, locationCode: 'A-01', inboundNo: 'RV-CONTROL', batchNo: 'RV-CONTROL', qty: 0, unitCostRmb: 13 }, inventoryLogs: [] }
  let queue = Promise.resolve(), fail = false
  const prisma: any = { $transaction: (callback: any) => {
    const result = queue.then(async () => {
      const draft = structuredClone(state)
      const tx: any = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        warehouse: { findUnique: async () => ({ status: 1, warehouseType: 'wms' }) },
        inboundOrder: { findUnique: async () => draft.order, update: async ({ data }: any) => Object.assign(draft.order, data) },
        inboundOrderItem: { update: async ({ where, data }: any) => Object.assign(draft.order.items.find((item: any) => item.id === where.id), data) },
        inboundCarton: { update: async ({ where, data }: any) => Object.assign(draft.order.cartons.find((box: any) => box.id === where.id), data) },
        inboundPutawayItem: { update: async ({ where, data }: any) => { const item = draft.order.putawayItems.find((row: any) => row.id === where.id); item.qty -= data.qty.decrement; return item } },
        inventory: {
          findUnique: async () => draft.inventory,
          update: async ({ data }: any) => Object.assign(draft.inventory, data),
          updateMany: async ({ data }: any) => { Object.assign(draft.inventory, data); return { count: 1 } },
        },
        inventoryLocation: {
          findFirst: async () => draft.lot,
          findMany: async () => draft.lot.qty > 0 ? [draft.lot] : [],
          updateMany: async ({ where, data }: any) => { if (draft.lot.id !== where.id || draft.lot.qty < where.qty.gte) return { count: 0 }; draft.lot.qty -= data.qty.decrement; return { count: 1 } },
        },
        inventoryLog: { create: async ({ data }: any) => { draft.inventoryLogs.push(data); return data } },
        productPricing: { findFirst: async () => null },
        operationLog: {
          findFirst: async ({ where }: any) => [...draft.operations].reverse().find((row: any) => row.module === where.module && (!where.targetId || row.targetId === where.targetId) && (!where.operatorId || row.operatorId === where.operatorId) && (!where.action || (typeof where.action === 'string' ? row.action === where.action : where.action.in.includes(row.action))) && (!where.detail || row.detail?.clientRequestId === where.detail.equals)) || null,
          create: async ({ data }: any) => { if (fail) throw new Error('末尾记录失败'); const row = { id: BigInt(draft.operations.length + 1), ...data }; draft.operations.push(row); return row },
        },
      }
      const result = await callback(tx); state = draft; return result
    })
    queue = result.then(() => undefined, () => undefined); return result
  } }
  const payload = (extra: any = {}) => ({ clientRequestId: randomUUID(), expectedVersion: inboundReceivingVersion({ ...state.order, workflowRevision: String(state.operations.at(-1)?.id || '0') }), reason: '实际核对更正原因', ...extra })
  const inventory = new InventoryMutationService()
  const run = (kind: InboundControlKind, input = payload(), actor = 1) => runInboundControl(prisma, inventory, 1, kind, input, actor)
  function seedPutaway(qty = 1) {
    state.order.items[0].putawayQty = qty; state.order.putawayItems = [{ id: 1n, inboundItemId: 1n, locationId: 1n, locationCode: 'A-01', qty }]
    Object.assign(state.inventory, { totalQty: qty, availableQty: qty }); state.lot.qty = qty
  }
  return { prisma, inventory, payload, run, state: () => state, seedPutaway, fail: (value: boolean) => { fail = value } }
}

describe('仓库异常、减少数量和零收货的事务与恢复', () => {
  it('异常放行保留实收数量与原因，原请求在后续状态重放不再次修改', async () => {
    const f = fixture('exception'), input = f.payload()
    expect(await f.run('resolve-exception', input)).toMatchObject({ status: 'pending_putaway' })
    const before = structuredClone(f.state())
    expect(await f.run('resolve-exception', input)).toMatchObject({ duplicate: true })
    expect(f.state()).toEqual(before); expect(f.state().order.items[0].actualQty).toBe(3)
    expect(f.state().operations[0].detail.reason).toBe('实际核对更正原因')
  })
  it('放行末尾日志失败时不能留下已放行状态', async () => {
    const f = fixture('exception'), before = structuredClone(f.state())
    f.fail(true); await expect(f.run('resolve-exception')).rejects.toThrow('末尾记录失败'); expect(f.state()).toEqual(before)
  })
  it('没有明确实际清点的异常不能直接放行', async () => {
    const f = fixture('exception', null as any)
    await expect(f.run('resolve-exception')).rejects.toThrow('实际清点')
    expect(f.state().operations).toHaveLength(0)
  })
  it('更正清点返回收货中并清除旧完成信息，保留实收供重新核对', async () => {
    const f = fixture(); f.state().order.confirmedBy = 1n
    expect(await f.run('reopen-count')).toMatchObject({ status: 'receiving' })
    expect(f.state().order.items[0].actualQty).toBe(3); expect(f.state().order.confirmedBy).toBeNull()
    expect(f.state().inventoryLogs).toHaveLength(0)
  })
  it('已有上架记录不能更正清点或零收货结束', async () => {
    const f = fixture(); f.seedPutaway()
    await expect(f.run('reopen-count')).rejects.toThrow('上架记录')
    await expect(f.run('close-zero')).rejects.toThrow('上架记录')
    expect(f.state().inventory.totalQty).toBe(1)
  })
  it('明确全零才可结束且不加库存，原结束请求在重新更正后重放不会再次结束', async () => {
    const f = fixture('pending_putaway', 0), input = f.payload()
    expect(await f.run('close-zero', input)).toMatchObject({ status: 'completed', inventoryChanged: false })
    await f.run('reopen-count'); const before = structuredClone(f.state())
    expect(await f.run('close-zero', input)).toMatchObject({ duplicate: true })
    expect(f.state()).toEqual(before); expect(f.state().order.status).toBe('receiving'); expect(f.state().inventory.totalQty).toBe(0)
  })
  it.each([null, undefined, 1, -1])('零收货结束拒绝不明确或非零数量 %p', async actual => {
    const f = fixture('pending_putaway', actual as any)
    await expect(f.run('close-zero')).rejects.toThrow('明确清点为 0')
    expect(f.state().operations).toHaveLength(0)
  })
  it('相同状态数量经历处理循环后，旧页面版本仍被拒绝', async () => {
    const f = fixture('pending_putaway', 0), stale = f.payload()
    await f.run('close-zero'); await f.run('reopen-count')
    // Another completed count can restore identical visible fields; the latest
    // committed operation revision must still invalidate the old form.
    f.state().order.status = 'pending_putaway'
    await expect(f.run('close-zero', stale)).rejects.toThrow('已变更')
    expect(f.state().order.status).toBe('pending_putaway')
  })
  it('减少清点只改指定明细，原请求换数量或原因重试会冲突', async () => {
    const f = fixture('receiving'), input = f.payload({ inboundItemId: 1, quantity: 1, expectedCurrent: 3 })
    expect(await f.run('reduce-qc', input)).toMatchObject({ before: 3, after: 2 })
    expect(f.state().order.items[0]).toMatchObject({ actualQty: 2, expectedQty: 3, diffQty: -1 })
    await expect(f.run('reduce-qc', { ...input, reason: '另一个原因' })).rejects.toThrow('内容不同')
    await expect(f.run('reduce-qc', { ...input, quantity: 2 })).rejects.toThrow('内容不同')
    expect(f.state().order.items[0].actualQty).toBe(2)
  })
  it('减少箱数撤回最后箱标，旧的差异确认不能自动沿用', async () => {
    const f = fixture('receiving')
    expect(await f.run('reduce-carton', f.payload({ quantity: 1, expectedCurrent: 2 }))).toMatchObject({ after: 1, boxes: ['BOX-2'] })
    expect(f.state().order.cartons[1].status).toBe('pending')
    const db = { operationLog: { findFirst: async () => f.state().operations.at(-1) } }
    expect(await inboundCartonReadiness(db, f.state().order)).toMatchObject({ ready: false })
    await runInboundReceiving(f.prisma, 1, 'carton-count', { clientRequestId: randomUUID(), receivedCartonCount: 1, differenceReason: '实际少收一箱' }, 1)
    expect(await inboundCartonReadiness(db, f.state().order)).toMatchObject({ ready: true })
  })
  it('撤回最近上架同时减少单据、库位和仓级库存，不改变实际清点数量', async () => {
    const f = fixture(); f.seedPutaway(2)
    const input = f.payload({ inboundItemId: 1, quantity: 1, expectedCurrent: 2 })
    expect(await f.run('reduce-putaway', input)).toMatchObject({ before: 2, after: 1, inventoryChanged: true, locationCode: 'A-01' })
    expect(f.state().order.items[0]).toMatchObject({ putawayQty: 1, actualQty: 3 }); expect(f.state().inventory.totalQty).toBe(1); expect(f.state().lot.qty).toBe(1); expect(f.state().order.putawayItems[0].qty).toBe(1)
    const before = structuredClone(f.state()); await f.run('reduce-putaway', input); expect(f.state()).toEqual(before)
  })
  it('撤回上架的末尾记录失败时全部库存和单据进度回滚', async () => {
    const f = fixture(); f.seedPutaway(2); const input = f.payload({ inboundItemId: 1, quantity: 1, expectedCurrent: 2 }), before = structuredClone(f.state())
    f.fail(true); await expect(f.run('reduce-putaway', input)).rejects.toThrow('末尾记录失败'); expect(f.state()).toEqual(before)
    f.fail(false); await f.run('reduce-putaway', input); expect(f.state().inventory.totalQty).toBe(1)
  })
  it('库存锁定、实际批次不足或已完结时禁止撤回', async () => {
    for (const change of [(state: any) => { state.inventory.lockedQty = 1 }, (state: any) => { state.lot.qty = 0 }, (state: any) => { state.order.status = 'completed' }]) {
      const f = fixture(); f.seedPutaway(); change(f.state()); const before = structuredClone(f.state())
      await expect(f.run('reduce-putaway', f.payload({ inboundItemId: 1, quantity: 1, expectedCurrent: 1 }))).rejects.toThrow(); expect(f.state()).toEqual(before)
    }
  })
  it('撤回最多最近一笔数量；重复更正基于旧版本不能覆盖新进度', async () => {
    const f = fixture(); f.seedPutaway(1); f.state().order.items[0].putawayQty = 2
    await expect(f.run('reduce-putaway', f.payload({ inboundItemId: 1, quantity: 2, expectedCurrent: 2 }))).rejects.toThrow('最近一笔')
    const g = fixture('receiving'), a = g.payload({ inboundItemId: 1, quantity: 1, expectedCurrent: 3 }), b = g.payload({ inboundItemId: 1, quantity: 1, expectedCurrent: 3 })
    const results = await Promise.allSettled([g.run('reduce-qc', a, 1), g.run('reduce-qc', b, 2)])
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1); expect(g.state().order.items[0].actualQty).toBe(2)
  })
  it.each([false, [], 1.2, 0, -1])('减少数量拒绝无效值 %p', async quantity => {
    const f = fixture('receiving')
    await expect(f.run('reduce-qc', f.payload({ inboundItemId: 1, quantity, expectedCurrent: 3 }))).rejects.toThrow('正整数')
  })
  it('原因、操作标识、版本、明细和当前数量均严格校验', async () => {
    const f = fixture('receiving')
    for (const values of [{ reason: '短' }, { reason: true }, { clientRequestId: 'old-key' }, { expectedVersion: '' }, { inboundItemId: true }, { expectedCurrent: true }]) await expect(f.run('reduce-qc', f.payload({ inboundItemId: 1, quantity: 1, expectedCurrent: 3, ...values }))).rejects.toThrow()
    expect(validateSync(plainToInstance(InboundControlDto, f.payload({ quantity: false }))).length).toBeGreaterThan(0)
  })
})
