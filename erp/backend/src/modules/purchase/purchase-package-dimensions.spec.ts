import { PurchaseService } from './purchase.service'

const user = { userId: 5, realName: '采购测试员', username: 'buyer', roleCode: 'purchaser' }
function setup(status = 'finance_approved', paymentStatus = 'paid') {
  const confirmation: any = { id: 8n, devId: 6n, sku: 'BOX-1', status: 'confirmed', convertedPoId: 9n,
    updatedAt: new Date('2026-10-26T06:00:00.000Z'), packageLengthCm: 10, packageWidthCm: 20, packageHeightCm: 30,
    packageVolumeCbm: 0.006, volumetricWeightKg: 1.002 }
  const order: any = { id: 9n, poNo: 'PO-BOX', prePoId: 8n, status, paymentStatus, auditorId: 2n,
    auditedAt: new Date('2026-10-25T06:00:00Z'), totalAmount: 100, items: [{ sku: 'BOX-1', quantity: 10, unitPrice: 10, receivedQty: 10 }] }
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    purchaseOrder: { findUnique: jest.fn(async () => ({ ...order })), update: jest.fn() },
    prePurchaseOrder: { findUnique: jest.fn(async () => ({ ...confirmation })), update: jest.fn(async ({ data }) => {
      Object.assign(confirmation, data, { updatedAt: new Date(confirmation.updatedAt.getTime() + 1) }); return confirmation
    }) },
    product: { update: jest.fn().mockResolvedValue({}) }, productDev: { update: jest.fn().mockResolvedValue({}) },
    operationLog: { create: jest.fn().mockResolvedValue({}) },
    purchasePayment: { create: jest.fn(), deleteMany: jest.fn() }, costLedger: { create: jest.fn(), deleteMany: jest.fn() },
  }
  let queue = Promise.resolve()
  const prisma: any = { $transaction: jest.fn(callback => {
    const result = queue.then(() => callback(tx)); queue = result.catch(() => undefined); return result
  }) }
  const service = new PurchaseService(prisma, {} as any)
  jest.spyOn(service, 'detail').mockImplementation(async () => ({ ...order, purchaseConfirmation: { ...confirmation } }) as any)
  const body = () => ({ packageLengthCm: 40, packageWidthCm: 30, packageHeightCm: 20, expectedUpdatedAt: '2026-10-26T06:00:00.000Z', reason: '供应商复核尺寸' })
  return { service, order, confirmation, tx, prisma, body }
}

describe('采购主管审核后的箱子尺寸修改', () => {
  it.each(['finance_approved', 'approved', 'at_logistics_wh', 'received'])('%s 状态且已付款也可保存，不触发重新审核或重复费用', async status => {
    const { service, order, confirmation, tx, body } = setup(status)
    const before = { ...order }
    const result: any = await service.updatePackageDimensions(9, body(), user)
    expect(order).toEqual(before)
    expect(result.status).toBe(status); expect(result.paymentStatus).toBe('paid')
    expect(confirmation).toMatchObject({ packageLengthCm: 40, packageWidthCm: 30, packageHeightCm: 20, packageVolumeCbm: 0.024, volumetricWeightKg: 4.008 })
    expect(tx.purchaseOrder.update).not.toHaveBeenCalled(); expect(tx.purchasePayment.create).not.toHaveBeenCalled()
    expect(tx.purchasePayment.deleteMany).not.toHaveBeenCalled(); expect(tx.costLedger.create).not.toHaveBeenCalled(); expect(tx.costLedger.deleteMany).not.toHaveBeenCalled()
    expect(tx.product.update).toHaveBeenCalledWith({ where: { sku: 'BOX-1' }, data: { lengthCm: 40, widthCm: 30, heightCm: 20, syncStatus: 'pending' } })
    expect(tx.operationLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      operatorId: 5n, action: 'po_package_dimensions', targetId: 'PO-BOX', detail: expect.objectContaining({ reason: '供应商复核尺寸',
        before: expect.objectContaining({ packageLengthCm: 10, packageWidthCm: 20, packageHeightCm: 30 }),
        after: expect.objectContaining({ packageVolumeCbm: 0.024, volumetricWeightKg: 4.008 }),
      }),
    }) })
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.purchaseOrder.findUnique.mock.invocationCallOrder[0])
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(tx.prePurchaseOrder.findUnique.mock.invocationCallOrder[0])
  })
  it.each(['draft', 'pending_actual_qty', 'pending_po_audit', 'rejected', 'voided'])('不允许 %s 绕过审核', async status => {
    const { service, tx, body } = setup(status)
    await expect(service.updatePackageDimensions(9, body(), user)).rejects.toThrow('审核通过后')
    expect(tx.prePurchaseOrder.update).not.toHaveBeenCalled()
  })
  it('并发保存拒绝旧表单覆盖已更新尺寸，失败后不能重复写日志', async () => {
    const { service, tx, body, confirmation } = setup()
    const results = await Promise.allSettled([service.updatePackageDimensions(9, body(), user), service.updatePackageDimensions(9, { ...body(), packageLengthCm: 50 }, user)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(confirmation.packageLengthCm).toBe(40)
    expect(tx.prePurchaseOrder.update).toHaveBeenCalledTimes(1); expect(tx.operationLog.create).toHaveBeenCalledTimes(1)
  })
  it('不接受变更采购价格、数量或付款字段', async () => {
    const { service, order, body, tx } = setup()
    await service.updatePackageDimensions(9, { ...body(), totalAmount: 1, quantity: 1, unitPrice: 1, paymentStatus: 'unpaid', status: 'pending_po_audit' } as any, user)
    expect(order).toMatchObject({ totalAmount: 100, paymentStatus: 'paid', status: 'finance_approved', items: [expect.objectContaining({ quantity: 10, unitPrice: 10 })] })
    expect(Object.keys(tx.prePurchaseOrder.update.mock.calls[0][0].data).sort()).toEqual(['packageLengthCm', 'packageWidthCm', 'packageHeightCm', 'packageVolumeCbm', 'volumetricWeightKg'].sort())
  })
  it('不一致的采购确认记录不能串单修改', async () => {
    const { service, confirmation, tx, body } = setup(); confirmation.convertedPoId = 10n
    await expect(service.updatePackageDimensions(9, body(), user)).rejects.toThrow('不一致')
    expect(tx.prePurchaseOrder.update).not.toHaveBeenCalled()
  })
  it.each([0, -1, NaN, Infinity, 1.234, 1000000])('服务层同样拒绝无效尺寸 %s', async packageLengthCm => {
    const { service, prisma, body } = setup()
    await expect(service.updatePackageDimensions(9, { ...body(), packageLengthCm }, user)).rejects.toThrow('长、宽、高')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
  it('超出体积字段范围时不写入', async () => {
    const { service, prisma, body } = setup()
    await expect(service.updatePackageDimensions(9, { ...body(), packageLengthCm: 100000, packageWidthCm: 100000, packageHeightCm: 100000 }, user)).rejects.toThrow('体积超出')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
