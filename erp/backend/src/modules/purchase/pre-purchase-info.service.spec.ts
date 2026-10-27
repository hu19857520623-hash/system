import { PrePurchaseService } from './pre-purchase.service'

function setup() {
  let rows: any[] = [1, 2, 3].map(id => ({ id: BigInt(id), devId: BigInt(id + 10), prePoNo: `PRE-${id}`, sku: `SKU-${id}`, productName: `商品${id}`, plannedQty: id, status: 'assigned', purchaserId: 7n, supplierId: null }))
  let devs: any[] = [1, 2, 3].map(id => ({ id: BigInt(id + 10), sku: `SKU-${id}` }))
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    prePurchaseOrder: {
      findUnique: jest.fn(async ({ where }) => {
        const row = rows.find(row => where.id ? row.id === where.id : row.prePoNo === where.prePoNo)
        return row ? { ...row } : null
      }),
      findMany: jest.fn(async () => rows),
      update: jest.fn(async ({ where, data }) => { const row = rows.find(row => row.id === where.id)!; Object.assign(row, data); return { ...row } }),
      create: jest.fn(),
    },
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

describe('预采购批量信息更新', () => {
  it('一次更新三张已有单据，不新建采购单，保留未提供字段', async () => {
    const { service, tx, prisma, rows } = setup()
    const result = await service.importInfo('预采购单号,单价,计划数量,备注\nPRE-3,12,30,第三张\nPRE-1,0,10,第一张\nPRE-2,22,20,第二张', viewer)
    expect(result).toEqual({ updated: 3 })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(rows().map(row => [row.unitPrice, row.plannedQty, row.remark, row.status, row.sku])).toEqual([
      [0, 10, '第一张', 'assigned', 'SKU-1'], [22, 20, '第二张', 'assigned', 'SKU-2'], [12, 30, '第三张', 'assigned', 'SKU-3'],
    ])
    expect(tx.prePurchaseOrder.create).not.toHaveBeenCalled()
  })

  it.each(['confirmed', 'cancelled', 'pending_assign'])('状态为 %s 时整批回滚，连已写入行与选品 SKU 也恢复', async status => {
    const { service, rows, devs } = setup()
    rows()[2].status = status
    await expect(service.importInfo('预采购单号,SKU,单价\nPRE-1,NEW-1,11\nPRE-2,NEW-2,22\nPRE-3,NEW-3,33', viewer)).rejects.toThrow('第 4 行（PRE-3）')
    expect(rows()[0].unitPrice).toBeUndefined()
    expect(rows()[0].sku).toBe('SKU-1')
    expect(devs()[0].sku).toBe('SKU-1')
  })

  it('无权修改其他采购员的单据，整批回滚', async () => {
    const { service, rows } = setup()
    rows()[1].purchaserId = 8n
    await expect(service.importInfo('预采购单号,单价\nPRE-1,11\nPRE-2,22', viewer)).rejects.toThrow('无权编辑')
    expect(rows()[0].unitPrice).toBeUndefined()
  })

  it('不存在的单号不会新建，并使整批回滚', async () => {
    const { service, rows, tx } = setup()
    await expect(service.importInfo('预采购单号,单价\nPRE-1,11\nPRE-9,99', viewer)).rejects.toThrow('预采购单不存在')
    expect(rows()[0].unitPrice).toBeUndefined()
    expect(tx.prePurchaseOrder.create).not.toHaveBeenCalled()
  })

  it('格式错误先校验，不开启写入事务', async () => {
    const { service, prisma } = setup()
    await expect(service.importInfo('预采购单号,单价\nPRE-1,11\nPRE-2,-1', viewer)).rejects.toThrow('第 3 行')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('批内重复 SKU 同样失败并回滚', async () => {
    const { service, rows } = setup()
    await expect(service.importInfo('预采购单号,SKU\nPRE-1,SHARED\nPRE-2,SHARED', viewer)).rejects.toThrow('已被使用')
    expect(rows()[0].sku).toBe('SKU-1')
  })

  it('退回修改的单据可以更新，但保持原状态', async () => {
    const { service, rows } = setup()
    rows()[0].status = 'returned'
    await service.importInfo('预采购单号,备注\nPRE-1,补充资料', viewer)
    expect(rows()[0]).toMatchObject({ status: 'returned', remark: '补充资料' })
  })

  it('导出使用本人、状态和关键词筛选，包含其他分页', async () => {
    const { service, tx } = setup()
    const result = await service.exportInfo({ status: 'assigned', keyword: 'SKU' }, viewer)
    expect(result.total).toBe(3)
    expect(tx.prePurchaseOrder.findMany).toHaveBeenCalledWith({
      where: { purchaserId: 7n, status: { in: ['assigned', 'returned'] }, OR: [{ sku: { contains: 'SKU' } }, { productName: { contains: 'SKU' } }, { prePoNo: { contains: 'SKU' } }] },
      orderBy: { id: 'desc' }, take: 501,
    })
  })

  it('导出超限时明确提示，避免静默遗漏单据', async () => {
    const { service, tx } = setup()
    tx.prePurchaseOrder.findMany.mockResolvedValue(Array.from({ length: 501 }, () => ({})))
    await expect(service.exportInfo({}, viewer)).rejects.toThrow('最多导出 500')
  })
})
