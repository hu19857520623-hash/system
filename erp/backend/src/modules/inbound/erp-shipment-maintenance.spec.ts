import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { ApplyShipmentFreightDto, ShipmentFreightMutationDto } from './dto/erp-shipment.dto'
import { shipmentSeaFreightVersion } from './erp-shipment-edit.util'
import { removeErpShipment, writeErpShipmentFreight } from './erp-shipment-maintenance.util'
import { InboundService } from './inbound.service'

const key = 'e7714067-6229-44db-8a49-c7af45605814'
function setup() {
  let order: any = { id: 1n, inboundNo: 'RVAUDIT-P14', sourceWarehouseCode: 'LW-A', warehouseCode: 'WMS-A', omsCustomerCode: null, status: 'pending_receipt', remark: '客户备注',
    items: [{ id: 2n, inboundId: 1n, productId: 3n, sku: 'AUDIT', expectedQty: 2, actualQty: null, seaFreightPerUnit: 0, costRmb: 10, domesticFeePerUnit: 1 }], cartons: [{ id: 8n, items: [{ sku: 'AUDIT', qty: 2 }] }] }
  const product: any = { id: 3n, sku: 'AUDIT', productName: '虚构商品', lengthCm: 10, widthCm: 20, heightCm: 30, weightKg: 1, seaFreightPerUnit: 0 }
  const stock: any = { id: 4n, totalQty: 3, availableQty: 3, lockedQty: 0 }
  const pricing: any = { id: 5n, sku: 'TKL-AUDIT', inboundNo: order.inboundNo, inboundQty: 2, seaFreight: 0, soldQty: 0, visibleStockQty: 9, visibleOnOms: false }
  const allocations: any[] = [{ productId: 3n, changeQty: -2 }], operations: any[] = []
  const lot: any = { id: 6n, costRmb: 10, seaFreightPerUnit: 0, domesticFeePerUnit: 1, unitCostRmb: 11 }
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]), $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    inboundOrder: { findUnique: jest.fn(async () => order), update: jest.fn(async ({ data }) => { Object.assign(order, data); return order }), delete: jest.fn(async () => { order = null }) },
    inboundOrderItem: { update: jest.fn(async ({ where, data }) => { Object.assign(order.items.find((item: any) => item.id === where.id), data) }), deleteMany: jest.fn(), findFirst: jest.fn(async ({ where }) => where.order.id ? null : { ...order.items[0], order }) },
    product: { findMany: jest.fn(async () => [product]), update: jest.fn(async ({ data }) => Object.assign(product, data)) },
    inventory: { findUnique: jest.fn(async () => stock), update: jest.fn(async ({ data }) => { stock.totalQty += data.totalQty.increment; stock.availableQty += data.availableQty.increment; return stock }), create: jest.fn() },
    inventoryLog: { findMany: jest.fn(async () => allocations), create: jest.fn().mockResolvedValue({}) },
    productPricing: { findFirst: jest.fn(async ({ where }) => where.inboundNo && where.inboundNo !== pricing.inboundNo ? null : pricing), update: jest.fn(async ({ data }) => Object.assign(pricing, data)) },
    productPricingHistory: { create: jest.fn().mockResolvedValue({}) },
    inventoryLocation: { findMany: jest.fn(async () => [lot]), update: jest.fn(async ({ data }) => Object.assign(lot, data)) },
    inboundArrivalScan: { deleteMany: jest.fn(), create: jest.fn() }, inboundPutawayItem: { deleteMany: jest.fn() }, inboundCartonItem: { deleteMany: jest.fn() }, inboundCarton: { deleteMany: jest.fn() },
    operationLog: { findFirst: jest.fn(async ({ where }) => operations.find(row => (!where.operatorId || row.operatorId === where.operatorId) && (typeof where.action === 'string' ? row.action === where.action : where.action.in.includes(row.action)) && row.detail[where.detail.path === '$.inboundId' ? 'inboundId' : 'clientRequestId'] === where.detail.equals) || null), create: jest.fn(async ({ data }) => { operations.push(data); return data }) },
  }
  let queue = Promise.resolve()
  const prisma: any = { ...tx, $transaction: jest.fn(callback => { const result = queue.then(() => callback(tx)); queue = result.catch(() => undefined); return result }) }
  const body = (totalAmount = 12): ApplyShipmentFreightDto => ({ clientRequestId: key, expectedVersion: shipmentSeaFreightVersion(order, [product]), mode: 'lcl', totalAmount })
  return { prisma, tx, getOrder: () => order, product, stock, pricing, allocations, operations, lot, body }
}

describe('发运维护事务与幂等', () => {
  it('删除并发重放只返还一次良品，保留可复制快照且不清除销售与可见库存设置', async () => {
    const { prisma, stock, pricing, tx } = setup()
    const results = await Promise.all([removeErpShipment(prisma, 1, 1), removeErpShipment(prisma, 1, 2)])
    expect(results.map(row => row.duplicate).sort()).toEqual([false, true]); expect(results[1].deletedOrder.items[0].productName).toBe('虚构商品')
    expect(stock).toMatchObject({ totalQty: 5, availableQty: 5, lockedQty: 0 }); expect(tx.inventoryLog.create).toHaveBeenCalledTimes(1)
    expect(pricing).toMatchObject({ inboundNo: null, inboundQty: 0, soldQty: 0, visibleStockQty: 9 })
  })
  it.each(['receiving', 'pending_putaway', 'completed', 'confirmed', 'exception', 'cancelled'])('状态%s不能删除', async status => {
    const { prisma, tx, getOrder } = setup(); getOrder().status = status
    await expect(removeErpShipment(prisma, 1, 1)).rejects.toThrow('已开始收货')
    expect(tx.inventory.update).not.toHaveBeenCalled(); expect(tx.inboundOrder.delete).not.toHaveBeenCalled()
  })
  it('历史已确认实收箱数也不能删，OMS预约拒绝ERP发运维护', async () => {
    const { prisma, tx, getOrder, body } = setup(); getOrder().status = 'arrived'; getOrder().receivedCartonCount = 1
    await expect(removeErpShipment(prisma, 1, 1)).rejects.toThrow('已开始收货')
    getOrder().receivedCartonCount = 0; getOrder().omsCustomerCode = 'TKL9001'
    await expect(removeErpShipment(prisma, 1, 1)).rejects.toThrow('不是 ERP 中转仓发运单')
    await expect(writeErpShipmentFreight(prisma, 1, body(), false, 1)).rejects.toThrow('不是 ERP 中转仓发运单')
    expect(tx.inventory.update).not.toHaveBeenCalled()
  })
  it('无原始扣减证据不凭空加库存，失败向事务传播', async () => {
    const { prisma, allocations, tx } = setup(); allocations[0].changeQty = -1
    await expect(removeErpShipment(prisma, 1, 1)).rejects.toThrow('原始扣减流水')
    expect(tx.inventory.update).not.toHaveBeenCalled()
    allocations[0].changeQty = -2; tx.operationLog.create.mockRejectedValue(new Error('隔离末尾故障'))
    await expect(removeErpShipment(prisma, 1, 1)).rejects.toThrow('隔离末尾故障')
  })
  it('删除当前关联发运时回退到上一张发运的资料，不保留悬空单号', async () => {
    const { prisma, tx, pricing } = setup(); tx.inboundOrderItem.findFirst.mockResolvedValue({ order: { inboundNo: 'RV-PREV' }, actualQty: null, expectedQty: 3, seaFreightPerUnit: 2, costRmb: 8, domesticFeePerUnit: 1 })
    await removeErpShipment(prisma, 1, 1)
    expect(pricing).toMatchObject({ inboundNo: 'RV-PREV', inboundQty: 3, seaFreight: 2, costRmb: 8 })
  })
  it('补录与清除同时更新原单、批次成本和关联货盘，并记录同一操作', async () => {
    const { prisma, body, getOrder, pricing, lot, product } = setup()
    await writeErpShipmentFreight(prisma, 1, body(), false, 1)
    expect(getOrder().remark).toBe('客户备注 海运:LCL/12'); expect(getOrder().items[0].seaFreightPerUnit).toBe(6)
    expect(pricing.seaFreight).toBe(6); expect(product.seaFreightPerUnit).toBe(6); expect(lot.unitCostRmb).toBe(17)
    await writeErpShipmentFreight(prisma, 1, { ...body(), clientRequestId: 'e7714067-6229-44db-8a49-c7af45605815' }, true, 1)
    expect(getOrder().remark).toBe('客户备注'); expect(pricing.seaFreight).toBe(0); expect(lot.unitCostRmb).toBe(11)
  })
  it('补录并发及后续清除后的原操作重放不重复写历史、不覆盖新值', async () => {
    const { prisma, body, tx, pricing } = setup(); const first = body()
    const results = await Promise.all([writeErpShipmentFreight(prisma, 1, first, false, 1), writeErpShipmentFreight(prisma, 1, first, false, 1)])
    expect(results.map(row => row.duplicate).sort()).toEqual([false, true]); expect(tx.productPricingHistory.create).toHaveBeenCalledTimes(1)
    await writeErpShipmentFreight(prisma, 1, { ...body(), clientRequestId: 'e7714067-6229-44db-8a49-c7af45605815' }, true, 1)
    expect((await writeErpShipmentFreight(prisma, 1, first, false, 1)).duplicate).toBe(true); expect(pricing.seaFreight).toBe(0)
    expect(tx.productPricingHistory.create).toHaveBeenCalledTimes(2)
  })
  it('同标识变更金额拒绝，旧版本不能覆盖另一个操作的新费用', async () => {
    const { prisma, body } = setup(); const first = body(); await writeErpShipmentFreight(prisma, 1, first, false, 1)
    await expect(writeErpShipmentFreight(prisma, 1, { ...first, totalAmount: 13 }, false, 1)).rejects.toThrow('已用于其他内容')
    await expect(writeErpShipmentFreight(prisma, 1, { ...first, clientRequestId: 'e7714067-6229-44db-8a49-c7af45605815' }, true, 1)).rejects.toThrow('已变更')
  })
  it('商品尺寸变更使旧分摊预览失效，即使单据更新时间相同', async () => {
    const { prisma, body, product, tx } = setup(); const first = body(); product.lengthCm = 11
    await expect(writeErpShipmentFreight(prisma, 1, first, false, 1)).rejects.toThrow('已变更')
    expect(tx.inboundOrderItem.update).not.toHaveBeenCalled()
  })
  it('补录旧批次只能更新旧批次，不覆盖最新发运商品或货盘费用', async () => {
    const { prisma, body, tx, pricing, product, lot } = setup(); pricing.inboundNo = 'RV-NEW'; pricing.seaFreight = 9; product.seaFreightPerUnit = 9
    tx.inboundOrderItem.findFirst.mockResolvedValue({ inboundId: 20n })
    await writeErpShipmentFreight(prisma, 1, body(), false, 1)
    expect(pricing.seaFreight).toBe(9); expect(product.seaFreightPerUnit).toBe(9); expect(lot.seaFreightPerUnit).toBe(6)
  })
  it('货盘同步失败必须传播到事务，不能忽略后返回成功', async () => {
    const { prisma, body, tx } = setup(); tx.productPricing.update.mockRejectedValue(new Error('隔离货盘写入故障'))
    await expect(writeErpShipmentFreight(prisma, 1, body(), false, 1)).rejects.toThrow('隔离货盘写入故障')
    expect(tx.operationLog.create).not.toHaveBeenCalled()
  })
})

describe('海运费维护输入边界', () => {
  it.each([0, -1, true, [1], 1.001, 10000000000])('拒绝金额%s且无有效版本或标识不能提交', async totalAmount => {
    const { body } = setup(); const errors = await validate(plainToInstance(ApplyShipmentFreightDto, { ...body(), totalAmount }))
    expect(errors.length).toBeGreaterThan(0)
  })
  it('数字文字合法，运输方式与版本仍严格校验', async () => {
    const { body } = setup()
    expect(await validate(plainToInstance(ApplyShipmentFreightDto, { ...body(), totalAmount: '12.00' }))).toHaveLength(0)
    expect(await validate(plainToInstance(ApplyShipmentFreightDto, { ...body(), mode: 'OTHER' }))).not.toHaveLength(0)
    expect(await validate(plainToInstance(ShipmentFreightMutationDto, {}))).not.toHaveLength(0)
  })
})

describe('发运删除与到仓收货状态衔接', () => {
  function receivingSetup() {
    const fixture = setup(), { tx, prisma, getOrder } = fixture
    tx.warehouse = { findUnique: jest.fn().mockResolvedValue({ warehouseType: 'wms', status: 1 }) }
    tx.inboundOrder.findFirst = jest.fn(async () => getOrder())
    const service = new InboundService(prisma, null as any, null as any, null as any, null as any, null as any)
    jest.spyOn(service as any, 'pushInboundStatusToOms').mockResolvedValue(undefined)
    return { ...fixture, service }
  }
  it('并发到仓只登记一次，开始收货后的到仓重试不回退作业状态', async () => {
    const { service, tx, getOrder } = receivingSetup()
    const results = await Promise.all([service.arrivalScan({ scanCode: 'RVAUDIT-P14', warehouseCode: 'WMS-A' }, 1), service.arrivalScan({ scanCode: 'RVAUDIT-P14', warehouseCode: 'WMS-A' }, 2)])
    expect(results.map(row => row.alreadyScanned).sort()).toEqual([false, true]); expect(tx.inboundArrivalScan.create).toHaveBeenCalledTimes(1)
    await service.startReceive(1, 1); await service.arrivalScan({ scanCode: 'RVAUDIT-P14', warehouseCode: 'WMS-A' }, 1)
    expect(getOrder().status).toBe('receiving'); expect(tx.inboundArrivalScan.create).toHaveBeenCalledTimes(1)
  })
  it('开始收货先取得单据后，删除不能返还库存或删除作业', async () => {
    const { service, prisma, getOrder, stock, tx } = receivingSetup(); getOrder().status = 'arrived'
    const results = await Promise.allSettled([service.startReceive(1, 1), removeErpShipment(prisma, 1, 2)])
    expect(results[0].status).toBe('fulfilled'); expect(results[1].status).toBe('rejected'); expect(stock.totalQty).toBe(3)
    expect(tx.inboundOrder.delete).not.toHaveBeenCalled()
  })
  it('已删除的单据不能再次开始收货，停用海外仓拒绝到仓', async () => {
    const { service, prisma, tx } = receivingSetup(); await removeErpShipment(prisma, 1, 1)
    await expect(service.startReceive(1, 1)).rejects.toThrow('已删除或不存在')
    tx.warehouse.findUnique.mockResolvedValue({ warehouseType: 'wms', status: 0 })
    await expect(service.arrivalScan({ scanCode: 'RVAUDIT-P14', warehouseCode: 'WMS-A' }, 1)).rejects.toThrow('启用的海外仓')
  })
})
