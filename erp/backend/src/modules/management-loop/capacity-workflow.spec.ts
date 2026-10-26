import { ManagementLoopService } from './management-loop.service'
import { capacityRequestId, capacityWarehouseCode } from './capacity-request.util'
import { warehouseCapacityInput } from '../warehouse/warehouse-capacity-input.util'
import { WarehouseService } from '../warehouse/warehouse.service'

function fixture() {
  const warehouses = [{ id: 1, warehouseCode: 'A', warehouseName: '甲仓', totalVolumeCbm: 1 }, { id: 2, warehouseCode: 'B', warehouseName: '乙仓', totalVolumeCbm: null }]
  const receipts: any[] = []
  const db: any = {
    warehouse: { findMany: jest.fn(async ({ where }) => warehouses.filter(w => !where.warehouseCode || w.warehouseCode === where.warehouseCode)) },
    warehouseLocation: { findMany: jest.fn().mockResolvedValue([{ id: 5n, warehouseCode: 'A', locationCode: 'A-01', maxVolumeCbm: 1, maxWeightKg: 0, zone: { zoneCode: 'Z', zoneName: '库区' }, inventoryItems: [{ productId: 7n, qty: 1 }] }]) },
    product: { findMany: jest.fn().mockResolvedValue([{ id: 7n, lengthCm: 100, widthCm: 100, heightCm: 100, weightKg: 1 }]) },
    inboundOrder: { findMany: jest.fn().mockResolvedValue([{ warehouseCode: 'B', status: 'pending_putaway', items: [{ productId: 7n, expectedQty: 10, actualQty: 3, putawayQty: 1 }] }]) },
    capacityAlert: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    operationLog: { findFirst: jest.fn(async ({ where }) => receipts.find(r => r.operatorId === where.operatorId && r.detail.clientRequestId === where.detail.equals)), create: jest.fn(async ({ data }) => { receipts.push(data) }) },
    $queryRaw: jest.fn().mockResolvedValue([{ id: 31 }]),
  }
  db.$transaction = jest.fn((work: any) => work(db))
  const service = new ManagementLoopService(db, {} as any, {} as any)
  return { db, service, warehouses, receipts }
}
describe('容量范围及事务刷新', () => {
  it('includes warehouses without locations; scopes rows and pending inbound to submitted overseas records', async () => {
    const f = fixture(), result = await f.service.capacityOverview()
    expect(f.db.warehouse.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { warehouseType: 'wms' } }))
    expect(f.db.warehouseLocation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { warehouseCode: { in: ['A','B'] } } }))
    const where = f.db.inboundOrder.findMany.mock.calls[0][0].where
    expect(where.warehouseCode).toEqual({ in: ['A','B'] }); expect(where.status.in).toContain('pending_putaway'); expect(where.status.in).not.toContain('draft'); expect(where.status.in).not.toContain('oms_draft')
    expect(result.warehouses).toHaveLength(2); expect(result.warehouses[1]).toMatchObject({ locationCount: 0, pendingVolumeCbm: 2 })
    expect(result.summary).toMatchObject({ pendingInboundQty: 2, capacitySet: false, partiallyConfigured: true, usageRate: null, projectedRate: null, alertLevel: 'critical' })
  })
  it('refuses an unknown/non-overseas code before reading unrelated locations', async () => {
    const f = fixture(); await expect(f.service.capacityOverview('UNKNOWN')).rejects.toThrow('海外仓不存在')
    expect(f.db.warehouseLocation.findMany).not.toHaveBeenCalled()
  })
  it('locks before reading the snapshot, writes alerts and the actor-bound receipt in one transaction, and replays once', async () => {
    const f = fixture(), body = { clientRequestId: 'capacity-request-37' }
    const first = await f.service.refreshCapacityAlerts(body,31), again = await f.service.refreshCapacityAlerts(body,31)
    expect(again).toEqual(first); expect(f.db.capacityAlert.createMany).toHaveBeenCalledTimes(1)
    expect(f.db.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(f.db.warehouse.findMany.mock.invocationCallOrder[0])
    expect(f.db.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(f.db.operationLog.findFirst.mock.invocationCallOrder[0])
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead', maxWait: 10000, timeout: 60000 })
    expect(f.db.capacityAlert.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ warehouseCode: { in: ['A','B'] }, status: 'open' }) }))
    expect(await f.service.capacityRequest(body.clientRequestId,31)).toEqual({ found: true, result: first })
    expect(await f.service.capacityRequest(body.clientRequestId,32)).toEqual({ found: false })
    await expect(f.service.refreshCapacityAlerts({ ...body, warehouseCode: 'B' },31)).rejects.toThrow('不能更改仓库')
  })
  it('never touches another warehouse and does not downgrade capacity alarms when dimensions are missing', async () => {
    const f = fixture(); f.db.inboundOrder.findMany.mockResolvedValue([])
    f.db.warehouseLocation.findMany.mockResolvedValue([{ id: 5n, warehouseCode: 'A', locationCode: 'A-01', maxVolumeCbm: 1, maxWeightKg: 0, zone: {}, inventoryItems: [{ productId: 7n, qty: 1 },{ productId: 9n, qty: 2 }] }])
    await f.service.refreshCapacityAlerts({ clientRequestId: 'capacity-only-A', warehouseCode: 'A' },31)
    expect(f.db.capacityAlert.updateMany.mock.calls[0][0].where.warehouseCode).toEqual({ in: ['A'] })
    expect(f.db.capacityAlert.createMany.mock.calls[0][0].data).toEqual(expect.arrayContaining([expect.objectContaining({ locationCode: 'A-01', alertType: 'capacity', alertLevel: 'critical' }),expect.objectContaining({ locationCode: 'A-01', alertType: 'missing_dimensions', alertLevel: 'warning' })]))
  })
  it('no overseas warehouse is an empty result, not permission to close other alerts', async () => {
    const f=fixture(); f.db.warehouse.findMany.mockResolvedValue([]); f.db.warehouseLocation.findMany.mockResolvedValue([]); f.db.inboundOrder.findMany.mockResolvedValue([])
    expect(await f.service.refreshCapacityAlerts({ clientRequestId:'capacity-empty-37' },31)).toMatchObject({ refreshed:0,warehouseCodes:[] })
    expect(f.db.capacityAlert.updateMany).not.toHaveBeenCalled(); expect(f.db.capacityAlert.createMany).not.toHaveBeenCalled()
  })
  it.each([undefined,true,{},'', 'short'])('requires a valid request before mutation %j', input => {
    expect(()=>capacityRequestId(input)).toThrow('请求标识')
  })
  it.each([null,[],3,' '.repeat(2),'x'.repeat(31)])('rejects invalid warehouse scope %j', input => {
    expect(()=>capacityWarehouseCode(input)).toThrow('海外仓')
  })
})
describe('仓级上限输入',()=>{
  it.each([undefined,-1,NaN,Infinity,true,[],{},'500','',100000000,0.00001,0.00000001])('rejects malformed values rather than silently clearing the cap %j', value=>{
    expect(()=>warehouseCapacityInput(value)).toThrow('仓级上限')
  })
  it.each([null,0,0.0001,500,99999999.9999])('accepts an explicit clear or valid target %j', value=>{
    expect(warehouseCapacityInput(value)).toBe(value)
  })
  it('invalid dedicated writes leave existing cap untouched and missing fields cannot claim a successful save', async()=>{
    const db:any={warehouse:{update:jest.fn(),findUnique:jest.fn().mockResolvedValue({id:1,totalVolumeCbm:500})}},cache:any={invalidate:jest.fn()}
    const service=new WarehouseService(db,cache)
    await expect(service.updateCapacity(1,undefined)).rejects.toThrow('仓级上限')
    await expect(service.update(1,{totalVolumeCbm:-1})).rejects.toThrow('仓级上限')
    expect(db.warehouse.update).not.toHaveBeenCalled()
  })
})
