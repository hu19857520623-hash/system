import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { LogisticsReceiptService } from './logistics-receipt.service'
import { CreateLogisticsReceiptDto } from './logistics-receipt.dto'
import { logisticsReceiptProgress } from './logistics-receipt-progress.util'
import { logisticsReceiptNumber, logisticsReceiptRequest, receiptStoredRemark } from './logistics-receipt-request.util'
import { validationFeedback } from '../../common/pipes/validation-feedback.util'

const requestId = 'a9d75ac7-f78c-4d2d-9bdb-7b39bfb1d008'
function setup(quantity = 10) {
  const po: any = { id: 1n, poNo: 'PO-AUDIT', warehouseCode: 'LW-A', status: 'finance_approved', items: [{ id: 2n, productId: 3n, sku: 'AUDIT', productName: '虚构商品', quantity, receivedQty: 0 }] }
  const receipts: any[] = [], inventories: any[] = []
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    purchaseOrder: { findUnique: jest.fn(async () => po), findUniqueOrThrow: jest.fn(async () => po), update: jest.fn(async ({ data }) => Object.assign(po, data)) },
    warehouse: { findUnique: jest.fn().mockResolvedValue({ warehouseType: 'logistics', status: 1 }) },
    product: { findUnique: jest.fn().mockResolvedValue({ id: 3n, sku: 'AUDIT' }) },
    logisticsReceipt: {
      findUnique: jest.fn(async ({ where }) => receipts.find(receipt => receipt.receiptNo === where.receiptNo) || null),
      findMany: jest.fn(async () => receipts),
      create: jest.fn(async ({ data }) => { const row = { ...data, id: BigInt(receipts.length + 1), receivedAt: new Date(), items: data.items.create.map((item: any, index: number) => ({ ...item, id: BigInt(index + 1) })) }; receipts.push(row); return row }),
    },
    purchaseOrderItem: { update: jest.fn(async ({ where, data }) => { const line = po.items.find(item => item.id === where.id); line.receivedQty = typeof data.receivedQty === 'number' ? data.receivedQty : (line.receivedQty || 0) + data.receivedQty.increment; return line }) },
    inventory: {
      findUnique: jest.fn(async () => inventories[0] || null),
      create: jest.fn(async ({ data }) => { const row = { ...data, id: 1n }; inventories.push(row); return row }),
      update: jest.fn(async ({ data }) => { const row = inventories[0]; row.totalQty += data.totalQty.increment; row.availableQty += data.availableQty.increment; return row }),
    },
    inventoryLog: { create: jest.fn().mockResolvedValue({}) }, operationLog: { create: jest.fn().mockResolvedValue({}) },
  }
  let queue = Promise.resolve()
  const prisma: any = { ...tx, $transaction: jest.fn(callback => { const result = queue.then(() => callback(tx)); queue = result.catch(() => undefined); return result }) }
  const log = { log: jest.fn().mockResolvedValue({}) }
  const service = new LogisticsReceiptService(prisma, log as any)
  const body = (actualQty = 8, damagedQty = 2, clientRequestId = requestId): CreateLogisticsReceiptDto => ({ poId: 1, clientRequestId, items: [{ poItemId: 2, sku: 'AUDIT', actualQty, damagedQty, qcStatus: 'pass' }], remark: '原始备注' })
  return { service, tx, po, body, receipts, inventories, log }
}

describe('中转仓收货规范', () => {
  it('采购10、良品8、破损2即收齐，库存只增加8，破损强制记为质检异常', async () => {
    const { service, po, body, inventories, tx } = setup()
    const result = await service.create(body())
    expect(po.items[0].receivedQty).toBe(10); expect(po.status).toBe('received')
    expect(inventories[0]).toMatchObject({ totalQty: 8, availableQty: 8 })
    expect(result.items[0].qcStatus).toBe('fail'); expect(result.remark).toBe('原始备注')
    expect(tx.inventoryLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ changeQty: 8 }) }))
  })
  it('同一操作并发及收齐后重放都返回原单，不重复增库或日志', async () => {
    const { service, body, tx, log, inventories } = setup()
    const results = await Promise.all([service.create(body()), service.create(body())])
    const replay = await service.create(body())
    expect(results[0].receiptNo).toBe(results[1].receiptNo); expect(replay.duplicate).toBe(true)
    expect(tx.logisticsReceipt.create).toHaveBeenCalledTimes(1); expect(log.log).toHaveBeenCalledTimes(1)
    expect(inventories[0].totalQty).toBe(8)
  })
  it('同一操作标识不能改数量后再次使用', async () => {
    const { service, body, tx } = setup(); await service.create(body())
    await expect(service.create(body(9, 1))).rejects.toThrow('已用于其他内容')
    expect(tx.logisticsReceipt.create).toHaveBeenCalledTimes(1)
  })
  it('不同操作竞争剩余数量不能超收，部分后可继续', async () => {
    const { service, body, po, inventories } = setup(3)
    const results = await Promise.allSettled([service.create(body(1, 1)), service.create(body(2, 0, 'a9d75ac7-f78c-4d2d-9bdb-7b39bfb1d009'))])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(po.status).toBe('at_logistics_wh'); expect(po.items[0].receivedQty).toBe(2)
    await service.create(body(1, 0, 'a9d75ac7-f78c-4d2d-9bdb-7b39bfb1d010'))
    expect(po.status).toBe('received'); expect(inventories[0].totalQty).toBe(2)
  })
  it('仅破损也完成收货，但不创建库存和库存变更流水', async () => {
    const { service, body, po, tx } = setup(2); await service.create(body(0, 2))
    expect(po.items[0].receivedQty).toBe(2); expect(po.status).toBe('received')
    expect(tx.inventory.create).not.toHaveBeenCalled(); expect(tx.inventoryLog.create).not.toHaveBeenCalled()
  })
  it.each([[-1, 2], [1.5, 0], [Infinity, 0], [2147483648, 0], [0, 0]])('无效数量%s/%s不写收货记录', async (good, damaged) => {
    const { service, body, tx } = setup()
    await expect(service.create(body(good, damaged))).rejects.toThrow()
    expect(tx.logisticsReceipt.create).not.toHaveBeenCalled()
  })
  it('禁止明细重复、编号与SKU不一致、跨采购单明细', async () => {
    const { service, body, tx } = setup()
    const duplicate = body(); duplicate.items.push({ ...duplicate.items[0] })
    await expect(service.create(duplicate)).rejects.toThrow('重复')
    const mismatch = body(); mismatch.items[0].sku = 'OTHER'
    await expect(service.create(mismatch)).rejects.toThrow('不一致')
    const foreign = body(); foreign.items[0].poItemId = 999
    await expect(service.create(foreign)).rejects.toThrow('不一致')
    expect(tx.logisticsReceipt.create).not.toHaveBeenCalled()
  })
  it('仓库停用或与目标不一致时不允许入仓', async () => {
    const { service, body, tx } = setup()
    await expect(service.create({ ...body(), warehouseCode: 'OTHER' })).rejects.toThrow('不一致')
    tx.warehouse.findUnique.mockResolvedValue({ warehouseType: 'logistics', status: 0 })
    await expect(service.create(body())).rejects.toThrow('启用的物流中转仓')
    expect(tx.inventory.create).not.toHaveBeenCalled()
  })
  it('历史良品计数按原记录补齐破损，不二次增加库存', async () => {
    const { service, body, po, receipts, inventories } = setup(10)
    po.items[0].receivedQty = 8; inventories.push({ id: 1n, totalQty: 8, availableQty: 8 })
    receipts.push({ poId: 1n, remark: '旧记录', items: [{ productId: 3n, sku: 'AUDIT', actualQty: 8, damagedQty: 1 }] })
    await service.create(body(1, 0))
    expect(po.items[0].receivedQty).toBe(10); expect(inventories[0].totalQty).toBe(9)
  })
  it('历史破损修复先预览、确认应用、再次应用不变，不写库存', async () => {
    const { service, po, receipts, tx } = setup(10); po.items[0].receivedQty = 8; po.status = 'at_logistics_wh'
    receipts.push({ poId: 1n, remark: '旧记录', items: [{ productId: 3n, sku: 'AUDIT', actualQty: 8, damagedQty: 2 }] })
    const preview = await service.reconcileDamagedReceipts(); expect(preview.affectedOrders).toBe(1); expect(po.items[0].receivedQty).toBe(8)
    await service.reconcileDamagedReceipts(true); expect(po.items[0].receivedQty).toBe(10); expect(po.status).toBe('received')
    expect((await service.reconcileDamagedReceipts(true)).affectedOrders).toBe(0)
    expect(tx.inventory.update).not.toHaveBeenCalled(); expect(tx.operationLog.create).toHaveBeenCalledTimes(1)
  })
  it('同SKU多明细旧记录无法唯一定位时明确拦截，不能猜测修复', () => {
    const { po } = setup(); po.items.push({ ...po.items[0], id: 4n })
    const result = logisticsReceiptProgress(po.items, [{ remark: null, items: [{ productId: 3n, sku: 'AUDIT', actualQty: 1 }] }])
    expect(result.issues.join()).toContain('无法唯一对应')
  })
  it('请求顺序变化可重放，标识长度满足数据库，原备注不暴露内部元数据', () => {
    const { body } = setup(); const request = logisticsReceiptRequest(body(), 'LW-A')
    expect(logisticsReceiptNumber(body())).toHaveLength(30)
    expect(receiptStoredRemark(request, requestId)).toContain('logistics-receipt-v1')
    const input = body(); input.items.push({ poItemId: 4, sku: 'OTHER', actualQty: 1 })
    const original = logisticsReceiptRequest(input, 'LW-A'); input.items.reverse()
    expect(logisticsReceiptRequest(input, 'LW-A')).toEqual(original)
  })
  it('同SKU多明细按采购明细编号更新，不能串到第一行', async () => {
    const { service, body, po, inventories } = setup(3)
    po.items.push({ ...po.items[0], id: 4n, quantity: 5 })
    const input = body(2, 0); input.items[0].poItemId = 4
    await service.create(input)
    expect(po.items[0].receivedQty).toBe(0); expect(po.items[1].receivedQty).toBe(2)
    expect(inventories[0].totalQty).toBe(2)
  })
  it('HTTP嵌套校验只返回中文字段和明细序号', async () => {
    const { body } = setup(); const input = body(1.5, -1)
    const errors = await validate(plainToInstance(CreateLogisticsReceiptDto, input))
    const messages = validationFeedback(errors).join('；')
    expect(messages).toContain('第 1 条明细'); expect(messages).toContain('良品实收数量'); expect(messages).toContain('破损数量')
    expect(messages).not.toMatch(/items\.|actualQty|damagedQty/)
  })
  it('没有操作标识或固定收货号时拒绝写入，避免部分收货无法安全重试', async () => {
    const { service, body, tx } = setup(); const input = body(); delete input.clientRequestId
    await expect(service.create(input)).rejects.toThrow('收货操作标识')
    expect(tx.logisticsReceipt.create).not.toHaveBeenCalled()
    expect(validationFeedback(await validate(plainToInstance(CreateLogisticsReceiptDto, input))).join()).toContain('收货操作标识')
  })
  it('布尔值和数组不能被自动转换成收货数量1', async () => {
    const { service, body } = setup()
    for (const value of [true, [1]]) {
      const input = body(); input.items[0].actualQty = value as any
      await expect(service.create(input)).rejects.toThrow('有效整数')
      const errors = await validate(plainToInstance(CreateLogisticsReceiptDto, input))
      expect(validationFeedback(errors).join()).toContain('良品实收数量')
    }
  })
  it('兼容使用固定收货号的旧客户端，同号重试也不重复入库', async () => {
    const { service, body, inventories } = setup(); const input = { ...body(), clientRequestId: undefined, receiptNo: 'LR-FIXED-LEGACY' }
    await service.create(input); const replay = await service.create(input)
    expect(replay.duplicate).toBe(true); expect(replay.receiptNo).toBe('LR-FIXED-LEGACY'); expect(inventories[0].totalQty).toBe(8)
  })
})
