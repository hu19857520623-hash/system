import { ManagementLoopService } from './management-loop.service'
import { stocktakeCountInput } from './stocktake-request.util'
import { parseStocktakeScope } from './management-loop-stocktake.util'
import { InventoryMutationService } from '../../common/inventory/inventory-mutation.service'

function fixture() {
  const receipts: any[] = []
  const line: any = { id: 4n, planId: 3n, productId: 7n, sku: 'AUDIT-SKU', locationId: 8n, locationCode: 'A-01', bookQty: 10, firstQty: null, status: 'pending' }
  const plan: any = { id: 3n, stocktakeNo: 'PD-AUDIT', warehouseCode: 'WMS-AUDIT', status: 'counting', blindCount: true, scopeJson: {}, lines: [line] }
  const db: any = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 31n }]),
    operationLog: {
      findFirst: jest.fn(async ({ where }) => receipts.find(r => r.operatorId === where.operatorId && r.detail.clientRequestId === where.detail.equals)),
      create: jest.fn(async ({ data }) => { receipts.push(data); return data }),
    },
    stocktakePlan: {
      findUnique: jest.fn(async () => plan),
      update: jest.fn(async ({ data }) => Object.assign(plan, data)),
      create: jest.fn(async ({ data }) => { Object.assign(plan, data, { lines: data.lines.create.map((l: any) => ({ ...l, id: 4n, planId: 3n, status: 'pending', firstQty: null })) }); return plan }),
    },
    stocktakeLine: {
      findFirst: jest.fn(async () => line), update: jest.fn(async ({ data }) => Object.assign(line, data)),
      count: jest.fn(async () => ['pending', 'recount'].includes(line.status) ? 1 : 0),
    },
    warehouse: { findFirst: jest.fn().mockResolvedValue({ warehouseCode: 'WMS-AUDIT' }) },
    inboundOrder: { findMany: jest.fn().mockResolvedValue([{ inboundNo: 'RV-OWNED' }]) },
    inventoryLocation: { groupBy: jest.fn().mockResolvedValue([{ productId: 7n, sku: 'AUDIT-SKU', locationId: 8n, locationCode: 'A-01', _sum: { qty: 10 } }]) },
  }
  db.$transaction = jest.fn((work: any) => work(db))
  const mutation = { adjustLocationToTarget: jest.fn().mockResolvedValue(undefined) }
  const service = new ManagementLoopService(db, {} as any, mutation as any)
  return { db, service, plan, line, receipts, mutation }
}
const count = { lineId: 4, qty: 9, expectedStage: 'pending', clientRequestId: 'audit-count-35' }

describe('stocktake current state, receipts and inventory scope', () => {
  it('locks actor and plan before reading mutable count state', async () => {
    const { service, db } = fixture()
    await service.submitCount(3, count, 31)
    expect(db.$queryRaw).toHaveBeenCalledTimes(2)
    expect(db.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(db.stocktakePlan.findUnique.mock.invocationCallOrder[0])
    expect(db.operationLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ detail: expect.objectContaining({ planId: 3, lineId: 4, expectedStage: 'pending' }) }) })
  })
  it('same count retry returns receipt without becoming a second count', async () => {
    const { service, db, line } = fixture()
    await service.submitCount(3, count, 31); await service.submitCount(3, count, 31)
    expect(db.stocktakeLine.update).toHaveBeenCalledTimes(1); expect(line.status).toBe('recount')
    expect(db.operationLog.create).toHaveBeenCalledTimes(1)
    await expect(service.submitCount(3, { ...count, qty: 8 }, 31)).rejects.toThrow('不能更改内容')
  })
  it('stale stage and repeated completed lines cannot overwrite current count', async () => {
    const { service, line } = fixture()
    line.status = 'matched'; line.firstQty = 10
    await expect(service.submitCount(3, count, 32)).rejects.toThrow('阶段已变化')
  })
  it('recount requires a different actor and is accepted once', async () => {
    const { service, line, plan } = fixture()
    await service.submitCount(3, count, 31)
    const recount = { ...count, qty: 8, expectedStage: 'recount', clientRequestId: 'audit-recount-35' }
    await expect(service.submitCount(3, recount, 31)).rejects.toThrow('另一名作业员')
    await service.submitCount(3, recount, 32)
    expect(line.finalQty).toBe(8); expect(plan.status).toBe('pending_approval')
    await expect(service.submitCount(3, { ...recount, qty: 7, clientRequestId: 'audit-third-35' }, 33)).rejects.toThrow('已结束')
  })
  it('create retries preserve original plan and freeze selected inbound batches', async () => {
    const { service, db, plan } = fixture()
    const body = { mode: 'full', warehouseCode: 'WMS-AUDIT', customerCode: 'AUDIT-CUSTOMER', clientRequestId: 'audit-create-35' }
    await service.createStocktake(body, 31); await service.createStocktake(body, 31)
    expect(db.stocktakePlan.create).toHaveBeenCalledTimes(1)
    expect(plan.scopeJson.resolvedInboundNos).toEqual(['RV-OWNED'])
    await expect(service.createStocktake({ ...body, customerCode: 'DIFFERENT' }, 31)).rejects.toThrow('不能更改内容')
  })
  it('approval adjusts only frozen batches and checks the original book quantity', async () => {
    const { service, plan, line, mutation, db } = fixture()
    plan.status = 'pending_approval'; plan.scopeJson = { customerCode: 'AUDIT-CUSTOMER', resolvedInboundNos: ['RV-OWNED'] }; line.finalQty = 8
    const body = { clientRequestId: 'audit-approve-35' }
    await service.approveStocktake(3, 31, body); await service.approveStocktake(3, 31, body)
    expect(mutation.adjustLocationToTarget).toHaveBeenCalledTimes(1)
    expect(mutation.adjustLocationToTarget).toHaveBeenCalledWith(db, expect.objectContaining({ expectedQty: 10, targetQty: 8, inboundNos: ['RV-OWNED'] }))
    expect(db.operationLog.create).toHaveBeenCalledTimes(1)
  })
  it('historical scoped plans lacking batch snapshots cannot modify all customers', async () => {
    const { service, plan, mutation } = fixture()
    plan.status = 'pending_approval'; plan.scopeJson = { customerCode: 'AUDIT-CUSTOMER' }
    await expect(service.approveStocktake(3, 31, { clientRequestId: 'audit-legacy-35' })).rejects.toThrow('批次快照')
    expect(mutation.adjustLocationToTarget).not.toHaveBeenCalled()
  })
  it('blind counts hide book and variance, approval reads expose the figures needed to review', async () => {
    const { service, plan, line } = fixture()
    plan.status = 'counting'; line.varianceQty = -2
    expect((await service.stocktakeDetail(3)).lines[0]).toMatchObject({ bookQty: null, varianceQty: null })
    plan.status = 'pending_approval'
    expect((await service.stocktakeDetail(3)).lines[0]).toMatchObject({ bookQty: 10, varianceQty: -2 })
  })
  it('request recovery reads are bound to the requesting actor', async () => {
    const { service } = fixture()
    await service.submitCount(3, count, 31)
    expect(await service.stocktakeRequest(count.clientRequestId, 31)).toMatchObject({ found: true, action: 'count' })
    expect(await service.stocktakeRequest(count.clientRequestId, 32)).toEqual({ found: false })
  })
  it.each([true, '9', -1, 1.5, 2147483648])('rejects invalid count %s before a mutation', qty => {
    expect(() => stocktakeCountInput({ ...count, qty })).toThrow('非负整数')
  })
  it('switching modes does not retain a previous location or SKU restriction', () => {
    expect(parseStocktakeScope({ mode: 'full', locationIds: [8], skus: ['OLD'] })).toMatchObject({ locationIds: [], skus: [] })
    expect(parseStocktakeScope({ mode: 'sku', locationIds: [8], skus: ['SKU'] })).toMatchObject({ locationIds: [], skus: ['SKU'] })
  })
})

describe('scoped stocktake inventory adjustment', () => {
  it('rejects changed stock before any inventory write', async () => {
    const tx: any = { $queryRaw: jest.fn(), inventoryLocation: { findMany: jest.fn().mockResolvedValue([{ id: 1n, qty: 11 }]), update: jest.fn() } }
    await expect(new InventoryMutationService().adjustLocationToTarget(tx, { productId: 7n, sku: 'AUDIT', warehouseCode: 'WMS-AUDIT', locationId: 8n, locationCode: 'A-01', targetQty: 8, expectedQty: 10, inboundNos: ['RV-OWNED'], referenceNo: 'PD' })).rejects.toThrow('盘点期间变化')
    expect(tx.inventoryLocation.update).not.toHaveBeenCalled()
    expect(tx.inventoryLocation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ inboundNo: { in: ['RV-OWNED'] } }) }))
  })
})
