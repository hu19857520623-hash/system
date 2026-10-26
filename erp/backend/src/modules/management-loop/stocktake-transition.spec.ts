import { Reflector } from '@nestjs/core'
import { PERMS_KEY } from '../../common/decorators/require-perms.decorator'
import { ManagementLoopController } from './management-loop.controller'
import { ManagementLoopService } from './management-loop.service'
import { stocktakePlanVersion, stocktakeTransitionInput } from './stocktake-request.util'
import { InventoryMutationService } from '../../common/inventory/inventory-mutation.service'

function fixture() {
  const receipts: any[] = []
  const line: any = { id: 4n, planId: 3n, productId: 7n, locationId: 8n, sku: 'AUDIT', locationCode: 'A', bookQty: 10, firstQty: 9, status: 'recount' }
  const plan: any = { id: 3n, stocktakeNo: 'PD-OLD', warehouseCode: 'AUDIT', mode: 'spot', status: 'counting', blindCount: true, scopeJson: { customerCode: 'OWN', resolvedInboundNos: ['RV-OWN'] }, lines: [line] }
  const plans = new Map([[3, plan]])
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 31n }]),
    operationLog: { findFirst: jest.fn(async ({ where }) => receipts.find(r => r.operatorId === where.operatorId && r.detail.clientRequestId === where.detail.equals)), create: jest.fn(async ({ data }) => { receipts.push(data) }) },
    stocktakePlan: {
      findUnique: jest.fn(async ({ where }) => plans.get(Number(where.id))),
      update: jest.fn(async ({ where, data }) => Object.assign(plans.get(Number(where.id)), data)),
      create: jest.fn(async ({ data }) => {
        const result = { ...data, id: 5n, lines: data.lines.createMany.data.map((l: any, i: number) => ({ ...l, id: BigInt(20 + i), planId: 5n, status: 'pending', firstQty: null })) }
        plans.set(5, result); return result
      }),
    },
    warehouse: { findFirst: jest.fn().mockResolvedValue({}) }, product: { count: jest.fn().mockResolvedValue(1) },
    warehouseLocation: { count: jest.fn().mockResolvedValue(1) },
    inboundOrder: { findMany: jest.fn().mockResolvedValue([{ inboundNo: 'RV-LEGACY-OWN' }]) },
    inventoryLocation: { groupBy: jest.fn().mockResolvedValue([{ productId: 7n, locationId: 8n, _sum: { qty: 8 }, _min: { qty: 8 } }]) },
  }
  tx.$transaction = jest.fn((work: any) => work(tx))
  const mutation = { adjustLocationToTarget: jest.fn() }
  return { plan, line, plans, tx, receipts, mutation, service: new ManagementLoopService(tx, {} as any, mutation as any), body: () => ({ clientRequestId: 'audit-transition-36', reason: '库存已变化', expectedVersion: stocktakePlanVersion(plan) }) }
}

describe('盘点取消与原明细重盘', () => {
  it('keeps counts and inventory unchanged on cancel; a retry recovers the original receipt', async () => {
    const f = fixture(), body = f.body()
    const result = await f.service.transitionStocktake(3, 'cancel', body, 31)
    expect(result.status).toBe('cancelled'); expect(f.line.firstQty).toBe(9)
    expect(result.scope.cancelReason).toBe(body.reason)
    await f.service.transitionStocktake(3, 'cancel', body, 31)
    expect(f.tx.stocktakePlan.update).toHaveBeenCalledTimes(1); expect(f.receipts).toHaveLength(1)
    expect(f.mutation.adjustLocationToTarget).not.toHaveBeenCalled(); expect(f.tx.inventoryLocation.groupBy).not.toHaveBeenCalled()
    expect(f.tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(f.tx.stocktakePlan.findUnique.mock.invocationCallOrder[0])
    await expect(f.service.transitionStocktake(3, 'cancel', { ...body, reason: '改过' }, 31)).rejects.toThrow('不能更改内容')
  })
  it.each(['cancel', 'replan'] as const)('rejects stale count state for %s even when plan status has not changed', async action => {
    const f = fixture(), body = f.body(); f.line.firstQty = 8
    await expect(f.service.transitionStocktake(3, action, body, 31)).rejects.toThrow('结果已变化')
    expect(f.tx.stocktakePlan.update).not.toHaveBeenCalled(); expect(f.tx.stocktakePlan.create).not.toHaveBeenCalled()
  })
  it.each(['completed', 'cancelled'])('cannot cancel or replan an ended task %s', async status => {
    const f = fixture(); f.plan.status = status
    for (const action of ['cancel', 'replan'] as const) await expect(f.service.transitionStocktake(3, action, f.body(), 31)).rejects.toThrow('已完成或已取消')
    expect(f.tx.stocktakePlan.update).not.toHaveBeenCalled(); expect(f.mutation.adjustLocationToTarget).not.toHaveBeenCalled()
  })
  it('copies only original product/location pairs and frozen batches, reads a fresh book and recovers the new plan once', async () => {
    const f = fixture(), body = f.body()
    const result = await f.service.transitionStocktake(3, 'replan', body, 31)
    expect(result).toMatchObject({ id: 5, mode: 'recount', status: 'counting', bookQtyHidden: true, scope: { replannedFromId: 3 } })
    expect(f.plans.get(5).lines[0]).toMatchObject({ bookQty: 8, firstQty: null, status: 'pending' })
    expect(f.plan).toMatchObject({ status: 'cancelled', scopeJson: { replacementPlanId: 5 } }); expect(f.line.firstQty).toBe(9)
    expect(f.tx.inventoryLocation.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { warehouseCode: 'AUDIT', OR: [{ productId: 7n, locationId: 8n }], inboundNo: { in: ['RV-OWN'] } } }))
    await f.service.transitionStocktake(3, 'replan', body, 31)
    expect(f.tx.stocktakePlan.create).toHaveBeenCalledTimes(1); expect(f.receipts[0]).toMatchObject({ targetId: 'PD-OLD', action: 'replan', detail: { planId: 5, sourcePlanId: 3 } })
    expect(await f.service.stocktakeRequest(body.clientRequestId, 31)).toMatchObject({ action: 'replan', plan: { id: 5 } })
    expect(await f.service.stocktakeRequest(body.clientRequestId, 32)).toEqual({ found: false })
    expect(f.mutation.adjustLocationToTarget).not.toHaveBeenCalled()
  })
  it('legacy scope is resolved only for the new snapshot, and zero original lines remain countable', async () => {
    const f = fixture(); delete f.plan.scopeJson.resolvedInboundNos; f.tx.inventoryLocation.groupBy.mockResolvedValue([])
    await f.service.transitionStocktake(3, 'replan', f.body(), 31)
    expect(f.tx.inboundOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { warehouseCode: 'AUDIT', omsCustomerCode: 'OWN' } }))
    expect(f.plans.get(5).scopeJson.resolvedInboundNos).toEqual(['RV-LEGACY-OWN'])
    expect(f.plans.get(5).lines[0].bookQty).toBe(0)
  })
  it('missing original product/location or invalid current quantity cannot cancel the old task', async () => {
    const f = fixture(); f.tx.product.count.mockResolvedValue(0)
    await expect(f.service.transitionStocktake(3, 'replan', f.body(), 31)).rejects.toThrow('商品或库位')
    expect(f.tx.stocktakePlan.update).not.toHaveBeenCalled()
    f.tx.product.count.mockResolvedValue(1); f.tx.inventoryLocation.groupBy.mockResolvedValue([{ productId: 7n, locationId: 8n, _sum: { qty: 8 }, _min: { qty: -1 } }])
    await expect(f.service.transitionStocktake(3, 'replan', f.body(), 31)).rejects.toThrow('数量异常')
    expect(f.plan.status).toBe('counting')
  })
  it('version does not depend on line ordering or JSON key ordering but changes with scope or count', () => {
    const f = fixture(), version = stocktakePlanVersion(f.plan)
    f.plan.scopeJson = { resolvedInboundNos: ['RV-OWN'], customerCode: 'OWN' }
    expect(stocktakePlanVersion(f.plan)).toBe(version)
    f.plan.scopeJson.customerCode = 'OTHER'; expect(stocktakePlanVersion(f.plan)).not.toBe(version)
  })
  it.each([{}, { expectedVersion: 'old', reason: 'x' }, { expectedVersion: `st1-${'a'.repeat(64)}`, reason: '' }, { expectedVersion: `st1-${'a'.repeat(64)}`, reason: true }])('requires a version and a meaningful reason %j', body => {
    expect(() => stocktakeTransitionInput(body)).toThrow()
  })
  it('replan requires both permissions, cancel requires approval permission', () => {
    const reflector = new Reflector()
    // The controller guard reads this metadata; creating a new plan must not grant approval rights.
    expect(reflector.get(PERMS_KEY, ManagementLoopController.prototype.replan)).toEqual(['stocktake.create', 'stocktake.approve'])
    expect(reflector.get(PERMS_KEY, ManagementLoopController.prototype.cancel)).toEqual(['stocktake.approve'])
  })
  it('a vanished zero batch can approve zero without inventing an owner lot, but cannot approve positive stock', async () => {
    const tx: any = { $queryRaw: jest.fn(), inventoryLocation: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() } }
    const params = { productId: 7n, sku: 'AUDIT', warehouseCode: 'AUDIT', locationId: 8n, locationCode: 'A', targetQty: 0, expectedQty: 0, inboundNos: ['RV-OWN'], referenceNo: 'PD' }
    await new InventoryMutationService().adjustLocationToTarget(tx, params)
    await expect(new InventoryMutationService().adjustLocationToTarget(tx, { ...params, targetQty: 1 })).rejects.toThrow('已不存在')
    expect(tx.inventoryLocation.update).not.toHaveBeenCalled()
  })
})
