import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateErpShipmentDto, SaveInboundDraftDto } from './dto/erp-shipment.dto'
import { erpShipmentFingerprint, erpShipmentRequest } from './erp-shipment-request.util'
import { InboundService } from './inbound.service'
import { validationFeedback } from '../../common/pipes/validation-feedback.util'

const requestId = 'b22b5145-4520-4dbe-a3a8-fd2a2e04c103'
const body = (): CreateErpShipmentDto => ({ clientRequestId: requestId, sourceWarehouseCode: 'LW-A', warehouseCode: 'WMS-A', warehouseNo: 'WH-1',
  items: [{ productId: 3, sku: 'AUDIT', expectedQty: 2, lengthCm: 10, widthCm: 20, heightCm: 30, weightKg: 1 }],
  cartons: [{ boxSeq: 1, lengthCm: 11, widthCm: 21, heightCm: 31, grossWeightKg: 2.5, remark: '外箱备注', items: [{ sku: 'AUDIT', qty: 2 }] }],
  freightLines: [{ sku: 'AUDIT', inboundQty: 2, costRmb: 11, seaFreightPerUnit: 0 }] })

function setup() {
  const stock = { id: 4n, productId: 3n, totalQty: 3, availableQty: 3, lockedQty: 0 }
  const product = { id: 3n, sku: 'AUDIT', productName: '虚构商品', status: 'active', costRmb: 11, domesticFeePerUnit: 2, seaFreightPerUnit: 5, lengthCm: 10, widthCm: 20, heightCm: 30, weightKg: 1 }
  const orders: any[] = [], logs: any[] = [], cartons: any[] = []
  let nextOrderId = 5n
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]), $queryRawUnsafe: jest.fn().mockResolvedValue([{ operatorId: 1 }]), $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    operationLog: { findMany: jest.fn(async () => logs), findFirst: jest.fn(async ({ where }) => logs.find(log => where.targetId ? log.targetId === where.targetId : log.operatorId === where.operatorId && log.detail[where.detail.path === '$.draftNo' ? 'draftNo' : 'clientRequestId'] === where.detail.equals) || null), create: jest.fn(async ({ data }) => { logs.push(data); return data }) },
    warehouse: { findUnique: jest.fn(async ({ where }) => ({ status: 1, warehouseType: where.warehouseCode === 'LW-A' ? 'logistics' : 'wms' })) },
    product: { findMany: jest.fn().mockResolvedValue([product]), findUnique: jest.fn().mockResolvedValue(product), update: jest.fn(async ({ data }) => ({ ...product, ...data })) },
    inventory: { findUnique: jest.fn(async () => stock), update: jest.fn(async ({ data }) => { stock.totalQty -= data.totalQty.decrement; stock.availableQty -= data.availableQty.decrement; return stock }) },
    inventoryLog: { create: jest.fn().mockResolvedValue({}) },
    inboundOrder: {
      findMany: jest.fn(async () => orders), findUnique: jest.fn(async ({ where }) => orders.find(row => where.id ? row.id === where.id : row.inboundNo === where.inboundNo) || null),
      create: jest.fn(async ({ data }) => { const row = { ...data, id: nextOrderId++, items: data.items.create.map((item: any) => ({ ...item, id: 6n })), cartons: [] }; orders.push(row); return row }),
      findUniqueOrThrow: jest.fn(async () => ({ ...orders[0], cartons })),
    },
    inboundCarton: { count: jest.fn().mockResolvedValue(0), create: jest.fn(async ({ data }) => { cartons.push(data); return data }) }, inboundCartonItem: {},
    productPricing: { findUnique: jest.fn().mockResolvedValue({ id: 7n }), update: jest.fn().mockResolvedValue({ id: 7n }) },
    productDev: { findFirst: jest.fn().mockResolvedValue(null) }, productPricingHistory: { create: jest.fn().mockResolvedValue({}) },
  }
  let queue = Promise.resolve()
  const prisma: any = { ...tx, $transaction: jest.fn(callback => { const next = queue.then(() => callback(tx)); queue = next.catch(() => undefined); return next }) }
  const files: any = { write: jest.fn().mockReturnValue({ relativePath: 'inbound-attachments/test' }) }
  const service = new InboundService(prisma, files, { log: jest.fn() } as any, null as any, null as any, null as any)
  return { service, tx, stock, product, orders, logs, cartons, files, prisma }
}

describe('ERP 中转仓发运事务与恢复', () => {
  it('保存外箱实测规格、扣减良品库存并同步费用，明确零海运费不会回落旧值', async () => {
    const { service, stock, cartons, tx } = setup(); const result = await service.create(body(), 1)
    expect(stock).toMatchObject({ totalQty: 1, availableQty: 1, lockedQty: 0 })
    expect(result.items[0].seaFreightPerUnit).toBe(0)
    expect(cartons[0]).toMatchObject({ lengthCm: 11, widthCm: 21, heightCm: 31, grossWeightKg: 2.5, remark: '外箱备注' })
    expect(tx.productPricingHistory.create).toHaveBeenCalledTimes(1)
    expect(tx.operationLog.create).toHaveBeenCalledTimes(1)
  })
  it('同一操作并发和库存已扣减后的重放返回原单，只发运一次', async () => {
    const { service, tx, stock } = setup()
    const first = await Promise.all([service.create(body(), 1), service.create(body(), 1)])
    const replay = await service.create(body(), 1)
    expect(first[0].inboundNo).toBe(first[1].inboundNo); expect(replay.duplicate).toBe(true)
    expect(tx.inboundOrder.create).toHaveBeenCalledTimes(1); expect(tx.inventory.update).toHaveBeenCalledTimes(1); expect(stock.totalQty).toBe(1)
  })
  it('同一标识更改费用或数量后不能再次发运', async () => {
    const { service, tx } = setup(); await service.create(body(), 1)
    const changed = body(); changed.freightLines![0].seaFreightPerUnit = 3
    await expect(service.create(changed, 1)).rejects.toThrow('已用于其他内容')
    expect(tx.inventory.update).toHaveBeenCalledTimes(1)
  })
  it('不同操作争抢剩余库存，只有一单成功，不能超发', async () => {
    const { service, stock, tx } = setup()
    const results = await Promise.allSettled([service.create(body(), 1), service.create({ ...body(), clientRequestId: 'b22b5145-4520-4dbe-a3a8-fd2a2e04c104' }, 2)])
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1); expect(stock.totalQty).toBe(1); expect(tx.inventoryLog.create).toHaveBeenCalledTimes(1)
  })
  it('商品编号与SKU不一致、非主数据及停用商品都不能发运', async () => {
    const { service, tx, product } = setup(); product.sku = 'OTHER'
    await expect(service.create(body(), 1)).rejects.toThrow('有效的 ERP 商品')
    tx.product.findMany.mockResolvedValue([])
    await expect(service.create(body(), 1)).rejects.toThrow('有效的 ERP 商品')
    expect(tx.inventory.update).not.toHaveBeenCalled()
  })
  it('可用数量为零或库存已锁定时不能发运', async () => {
    const { service, stock, tx } = setup(); stock.availableQty = 0
    await expect(service.create(body(), 1)).rejects.toThrow('可发数量不足')
    stock.availableQty = 3; stock.lockedQty = 2
    await expect(service.create(body(), 1)).rejects.toThrow('可发数量不足')
    expect(tx.inboundOrder.create).not.toHaveBeenCalled()
  })
  it('目的仓停用时不修改商品或库存', async () => {
    const { service, tx } = setup(); tx.warehouse.findUnique.mockResolvedValue({ status: 0, warehouseType: 'wms' })
    await expect(service.create(body(), 1)).rejects.toThrow('启用的物流中转仓')
    expect(tx.product.update).not.toHaveBeenCalled(); expect(tx.inventory.update).not.toHaveBeenCalled()
  })
  it('外箱或定价失败会向事务传播异常，不能返回发运成功', async () => {
    const { service, tx } = setup(); tx.inboundCarton.create.mockRejectedValue(new Error('箱号冲突'))
    await expect(service.create(body(), 1)).rejects.toThrow('箱号冲突'); expect(tx.inventory.update).not.toHaveBeenCalled()
    expect(tx.operationLog.create).not.toHaveBeenCalled()
  })
  it('原发运单被删除后重放不另建单扣库存', async () => {
    const { service, orders, tx } = setup(); await service.create(body(), 1); orders.length = 0
    await expect(service.create(body(), 1)).rejects.toThrow('原发运单已删除')
    expect(tx.inboundOrder.create).toHaveBeenCalledTimes(1)
  })
  it('草稿归属校验在创建和扣减之前，提交成功在事务内绑定附件并删除本人草稿', async () => {
    const { service, tx } = setup(); const request = { ...body(), draftNo: 'DRF-TEST' }
    tx.$queryRawUnsafe.mockResolvedValue([{ operatorId: 2 }])
    await expect(service.create(request, 1)).rejects.toThrow('本人创建的草稿'); expect(tx.inboundOrder.create).not.toHaveBeenCalled()
    tx.$queryRawUnsafe.mockResolvedValue([{ operatorId: 1 }]); await service.create(request, 1)
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('UPDATE inbound_attachment'), 5, 'DRF-TEST')
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM inbound_draft'), 'DRF-TEST', 1)
  })
  it('草稿保存、删除、附件上传均拒绝其他账号，附件拒绝无归属和损坏内容', async () => {
    const { service, tx, files } = setup(); tx.$queryRawUnsafe.mockResolvedValue([{ operatorId: 2 }])
    await expect(service.saveDraft('DRF-TEST', {}, 1)).rejects.toThrow('本人创建的草稿')
    await expect(service.deleteDraft('DRF-TEST', 1)).rejects.toThrow('本人创建的草稿')
    await expect(service.uploadAttachment({ draftNo: 'DRF-TEST', fileName: '验收.txt', contentBase64: 'dGVzdA==' }, 1)).rejects.toThrow('本人创建的草稿')
    await expect(service.uploadAttachment({ fileName: '验收.txt', contentBase64: 'dGVzdA==' }, 1)).rejects.toThrow('保存本人草稿')
    await expect(service.uploadAttachment({ draftNo: 'DRF-TEST', fileName: '验收.txt', contentBase64: 'broken' }, 1)).rejects.toThrow('附件内容无效')
    expect(files.write).not.toHaveBeenCalled(); expect(tx.$executeRawUnsafe).not.toHaveBeenCalled()
  })
  it('发运成功后旧标签页不能重新保存同一草稿，避免再次转单', async () => {
    const { service, tx } = setup(); await service.create({ ...body(), draftNo: 'DRF-TEST' }, 1)
    tx.$executeRawUnsafe.mockClear()
    await expect(service.saveDraft('DRF-TEST', { lines: [] }, 1)).rejects.toThrow('已转为正式入库单')
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled()
  })
  it('删除后的历史单号不能被自动编号或手填复用，旧操作也不能返回新单', async () => {
    const { service, orders, stock } = setup(); const first = await service.create(body(), 1)
    orders.length = 0; stock.totalQty = 3; stock.availableQty = 3
    const second = await service.create({ ...body(), clientRequestId: 'b22b5145-4520-4dbe-a3a8-fd2a2e04c104' }, 1)
    expect(second.inboundNo).not.toBe(first.inboundNo)
    await expect(service.create(body(), 1)).rejects.toThrow('原发运单已删除')
    await expect(service.create({ ...body(), clientRequestId: 'b22b5145-4520-4dbe-a3a8-fd2a2e04c105', inboundNo: first.inboundNo }, 1)).rejects.toThrow('不能重复使用历史单号')
  })
})

describe('发运输入边界与中文校验', () => {
  it.each([0, -1, 1.5, Infinity, true, [], 2147483648])('拒绝无效数量 %s', async quantity => {
    const request = body(); request.items[0].expectedQty = quantity as any
    const errors = await validate(plainToInstance(CreateErpShipmentDto, request))
    expect(errors.length).toBeGreaterThan(0); expect(validationFeedback(errors).join('')).toMatch(/发运数量/)
    expect(() => erpShipmentRequest(request)).toThrow('有效正整数')
  })
  it('数字文字允许，但布尔值、数组与缺失操作标识以中文拒绝', async () => {
    const request = body(); request.items[0].expectedQty = '2' as any
    expect(await validate(plainToInstance(CreateErpShipmentDto, request))).toHaveLength(0)
    delete request.clientRequestId
    expect(validationFeedback(await validate(plainToInstance(CreateErpShipmentDto, request))).join('')).toContain('发运操作标识')
    expect(await validate(plainToInstance(SaveInboundDraftDto, { draftNo: 'DRAFT', form: [] }))).not.toHaveLength(0)
  })
  it('重复同商品明细汇总且指纹不受明细顺序影响，不同档案或规格拒绝合并', () => {
    const request = body(); request.items[0].expectedQty = 1; request.items.push({ ...request.items[0] })
    expect(erpShipmentRequest(request).items[0].expectedQty).toBe(2)
    expect(erpShipmentFingerprint(erpShipmentRequest(request))).toBe(erpShipmentFingerprint(erpShipmentRequest({ ...request, items: [...request.items].reverse() })))
    request.items[1].weightKg = 2
    expect(() => erpShipmentRequest(request)).toThrow('不一致')
    request.items[1].productId = 4
    expect(() => erpShipmentRequest(request)).toThrow('多个商品档案')
  })
  it('拒绝装箱合计不符、箱序重复、外单SKU和费用数量不符', () => {
    const request = body(); request.cartons![0].items[0].qty = 1
    expect(() => erpShipmentRequest(request)).toThrow('装箱合计')
    request.cartons![0].items[0].sku = 'OTHER'
    expect(() => erpShipmentRequest(request)).toThrow('属于本单')
    request.cartons = [body().cartons![0], body().cartons![0]]
    expect(() => erpShipmentRequest(request)).toThrow('箱序号或箱号重复')
    request.cartons = []; request.freightLines![0].inboundQty = 3
    expect(() => erpShipmentRequest(request)).toThrow('分摊数量')
  })
})
