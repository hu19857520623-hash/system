import { BadRequestException } from '@nestjs/common'
import { PrePurchaseService } from './pre-purchase.service'
import { infoCsv, validInfoRow } from './pre-purchase-info.test-helper'

function setup() {
  let rows: any[] = [1, 2, 3].map(id => ({ ...validInfoRow(id), id: BigInt(id), devId: BigInt(id + 10), status: 'assigned', purchaserId: 7n, supplierId: 1n }))
  let devs: any[] = [1, 2, 3].map(id => ({ id: BigInt(id + 10), sku: `SKU-${id}` }))
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    prePurchaseOrder: {
      findUnique: jest.fn(async ({ where }) => {
        const row = rows.find(row => where.id ? row.id === where.id : row.prePoNo === where.prePoNo)
        return row ? { ...row } : null
      }),
      findMany: jest.fn(async ({ where }) => rows.filter(row => where.id.in.includes(row.id) && (!where.purchaserId || where.purchaserId === row.purchaserId))),
      update: jest.fn(async ({ where, data }) => { const row = rows.find(row => row.id === where.id)!; Object.assign(row, data); return { ...row } }),
      create: jest.fn(),
    },
    supplier: { findFirst: jest.fn().mockResolvedValue({ id: 1n, status: 1 }), create: jest.fn(), update: jest.fn() },
    warehouse: { findUnique: jest.fn().mockResolvedValue({ status: 1, warehouseType: 'logistics' }) },
    product: { findFirst: jest.fn().mockResolvedValue(null) },
    productDev: {
      findFirst: jest.fn(async ({ where }) => devs.find(dev => dev.sku === where.sku && dev.id !== where.NOT.id) || null),
      update: jest.fn(async ({ where, data }) => Object.assign(devs.find(dev => dev.id === where.id)!, data)),
    },
  }
  const prisma: any = { ...tx, $transaction: jest.fn(async callback => {
    const beforeRows = structuredClone(rows), beforeDevs = structuredClone(devs)
    try { return await callback(tx) } catch (error) { rows = beforeRows; devs = beforeDevs; throw error }
  }) }
  const service = new PrePurchaseService(prisma, { log: jest.fn() } as any)
  jest.spyOn(service as any, 'enrich').mockImplementation(async (items: any[]) => items)
  return { service, tx, prisma, rows: () => rows, devs: () => devs }
}
const viewer = { userId: 7, roleCode: 'purchaser' }

describe('预采购勾选导出和上传审核', () => {
  it('只导出选中的两单，不包含第三单', async () => {
    const { service, tx } = setup()
    const result = await service.exportInfo([1, 3], viewer)
    expect(result.total).toBe(2)
    expect(result.rows.slice(1).map(row => row[0])).toEqual(['PRE-1', 'PRE-3'])
    expect(tx.prePurchaseOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: [1n, 3n] }, purchaserId: 7n }) }))
  })

  it.each([[], [1, 1], [0], [-1], [1.5], Array.from({ length: 501 }, (_, index) => index + 1)].map(ids => [ids]))('无效选择不能回退为导出全部', async ids => {
    const { service, tx } = setup()
    await expect(service.exportInfo(ids, viewer)).rejects.toThrow()
    expect(tx.prePurchaseOrder.findMany).not.toHaveBeenCalled()
  })

  it('无权导出的所选单据不能静默跳过', async () => {
    const { service, rows } = setup()
    rows()[1].purchaserId = 8n
    await expect(service.exportInfo([1, 2], viewer)).rejects.toThrow('无权导出')
  })

  it('一次审核并更新三张已有单据，不新建采购单', async () => {
    const { service, tx, prisma, rows } = setup()
    const result = await service.importInfo(infoCsv([
      { ...validInfoRow(3), unitPrice: 12, plannedQty: 30, remark: '第三张' },
      { ...validInfoRow(1), unitPrice: 11, plannedQty: 10, remark: '第一张' },
      { ...validInfoRow(2), unitPrice: 22, plannedQty: 20, remark: '第二张' },
    ]), viewer)
    expect(result).toEqual({ updated: 3, failed: 0, failures: [] })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(rows().map(row => [row.unitPrice, row.plannedQty, row.remark, row.status])).toEqual([
      [11, 10, '第一张', 'assigned'], [22, 20, '第二张', 'assigned'], [12, 30, '第三张', 'assigned'],
    ])
    expect(tx.prePurchaseOrder.create).not.toHaveBeenCalled()
  })

  it('一次汇总多行多字段格式错误，不开启写入事务', async () => {
    const { service, prisma, rows } = setup()
    const result = await service.importInfo(infoCsv([{ supplierName: '', unitPrice: -1 }, { plannedQty: 1.5 }]), viewer)
    expect(result).toMatchObject({ updated: 0, failed: 2 })
    expect(result.failures).toHaveLength(3)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(rows()[0].unitPrice).toBe(10)
  })

  it('一次返回供应商、仓库、SKU、状态、单据归属的审核错误，全部不写入', async () => {
    const { service, tx, rows } = setup()
    tx.supplier.findFirst.mockResolvedValue({ id: 1n, status: 0 })
    tx.warehouse.findUnique.mockResolvedValue(null)
    tx.product.findFirst.mockResolvedValue({ id: 99n })
    rows()[0].status = 'confirmed'
    rows()[1].purchaserId = 8n
    const result = await service.importInfo(infoCsv([{ warehouseCode: 'BAD' }, { warehouseCode: 'BAD' }]), viewer)
    expect(result).toMatchObject({ updated: 0, failed: 2 })
    expect(result.failures.map(item => item.field)).toEqual(['状态', '供应商', 'SKU', '目标中转仓编码', '预采购单号'])
    expect(tx.prePurchaseOrder.update).not.toHaveBeenCalled()
    expect(tx.supplier.create).not.toHaveBeenCalled()
  })

  it('不存在的单号会提示行号，并且不会创建或修改其他单据', async () => {
    const { service, tx } = setup()
    const result = await service.importInfo(infoCsv([{}, { prePoNo: 'PRE-9' }]), viewer)
    expect(result.failures[0]).toMatchObject({ lineNo: 3, prePoNo: 'PRE-9', field: '预采购单号', reason: expect.stringContaining('不存在') })
    expect(tx.prePurchaseOrder.update).not.toHaveBeenCalled()
    expect(tx.prePurchaseOrder.create).not.toHaveBeenCalled()
  })

  it('写入阶段发生业务校验错误，已写行和关联选品资料也回滚', async () => {
    const { service, rows, devs, tx } = setup()
    const update = tx.prePurchaseOrder.update.getMockImplementation()
    tx.prePurchaseOrder.update.mockImplementation(async args => {
      if (args.where.id === 2n) throw new BadRequestException('资料状态已变化')
      return update(args)
    })
    const result = await service.importInfo(infoCsv([{ sku: 'NEW-1', unitPrice: 11 }, { sku: 'NEW-2', unitPrice: 22 }]), viewer)
    expect(result).toMatchObject({ updated: 0, failed: 1 })
    expect(rows()[0]).toMatchObject({ sku: 'SKU-1', unitPrice: 10 })
    expect(devs()[0].sku).toBe('SKU-1')
    expect(result.failures[0]).toMatchObject({ lineNo: 3, prePoNo: 'PRE-2', reason: '资料状态已变化' })
  })

  it('系统异常不可误报为校验失败，事务仍回滚', async () => {
    const { service, tx, rows } = setup()
    tx.prePurchaseOrder.update.mockRejectedValue(new Error('database unavailable'))
    await expect(service.importInfo(infoCsv([{}]), viewer)).rejects.toThrow('database unavailable')
    expect(rows()[0].unitPrice).toBe(10)
  })

  it('退回待修改单据可以更新，保留退回状态及空白选填项', async () => {
    const { service, rows } = setup()
    rows()[0].status = 'returned'; rows()[0].remark = '原备注'
    await service.importInfo(infoCsv([{ remark: '' }]), viewer)
    expect(rows()[0]).toMatchObject({ status: 'returned', remark: '原备注' })
  })
})
