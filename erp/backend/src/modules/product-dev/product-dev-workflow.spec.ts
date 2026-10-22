import { ProductDevService } from './product-dev.service'

function setup(status = 'draft') {
  const row = { id: 17n, applyNo: 'PD-AUDIT', productName: '虚构商品', sku: 'AUDIT-A', status, takealotUrl: 'https://example.com/audit', takealotPriceImageUrl: '/audit.png', estimatedCost: 0, marketPrice: 10 }
  const productDev = { findUnique: jest.fn().mockImplementation(async () => ({ ...row })), findUniqueOrThrow: jest.fn().mockImplementation(async () => ({ ...row })), updateMany: jest.fn().mockImplementation(async ({ data }) => { Object.assign(row, data); return { count: 1 } }), deleteMany: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn() }
  const prisma = { productDev, $transaction: jest.fn(async callback => callback(prisma)) }
  const log = { log: jest.fn().mockResolvedValue({}) }
  const prePurchase = { createFromDev: jest.fn().mockResolvedValue({}) }
  const service = new ProductDevService(prisma as any, log as any, prePurchase as any, {} as any)
  jest.spyOn(service, 'validateSku').mockResolvedValue('AUDIT-A')
  return { service, row, productDev, prePurchase, log }
}

describe('选品状态及采购衔接', () => {
  for (const status of ['approved', 'rejected', 'submitted']) it(`新建不能直接指定 ${status}`, async () => {
    const { service, productDev } = setup()
    await expect(service.create({ productName: '虚构商品', status })).rejects.toThrow('新建选品只能保存为草稿')
    expect(productDev.create).not.toHaveBeenCalled()
  })
  it('编辑不能伪造通过状态', async () => {
    const { service, productDev } = setup()
    await expect(service.update(17, { status: 'approved' })).rejects.toThrow('不能通过编辑修改审核结果')
    expect(productDev.updateMany).not.toHaveBeenCalled()
  })
  for (const status of ['submitted', 'approved']) it(`${status} 不能修改商品资料或删除`, async () => {
    const { service, productDev } = setup(status)
    await expect(service.update(17, { productName: '改写' })).rejects.toThrow('仅草稿或已驳回')
    await expect(service.remove(17)).rejects.toThrow('审核和采购中的申请须保留')
    expect(productDev.deleteMany).not.toHaveBeenCalled()
  })
  it('待审核撤回为草稿后可继续编辑', async () => {
    const { service, row, productDev } = setup('submitted')
    await service.update(17, { status: 'draft' })
    await service.update(17, { productName: '修改后商品' })
    expect(row.status).toBe('draft')
    expect(row.productName).toBe('修改后商品')
    expect(productDev.updateMany.mock.calls[0][0].where.status).toBe('submitted')
  })
  for (const qty of [0, -1, 1.5, NaN, Infinity, 2147483648]) it(`无效计划数量 ${qty} 不产生采购单`, async () => {
    const { service, prePurchase, productDev } = setup('submitted')
    await expect(service.approve(17, 1, '', qty)).rejects.toThrow('计划采购数量须为大于零')
    expect(prePurchase.createFromDev).not.toHaveBeenCalled()
    expect(productDev.updateMany).not.toHaveBeenCalled()
  })
  it('并发审核或撤回改变状态后不会继续创建预采购单', async () => {
    const { service, productDev, prePurchase } = setup('submitted')
    productDev.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(service.approve(17, 1, '', 2)).rejects.toThrow('选品状态已变化')
    expect(prePurchase.createFromDev).not.toHaveBeenCalled()
  })
  it('驳回原因必填，原单据保留待审核', async () => {
    const { service, row, productDev } = setup('submitted')
    await expect(service.reject(17, 1, '   ')).rejects.toThrow('请填写驳回原因')
    expect(row.status).toBe('submitted')
    expect(productDev.updateMany).not.toHaveBeenCalled()
  })
  it('有效审核在事务内衔接预采购，不丢失零采购参考价', async () => {
    const { service, prePurchase, row } = setup('submitted')
    await service.approve(17, 1, '通过', 2)
    expect(row.status).toBe('approved')
    expect(prePurchase.createFromDev).toHaveBeenCalledTimes(1)
    expect(prePurchase.createFromDev.mock.calls[0][0]).toMatchObject({ purchaseQty: 2, estimatedCost: 0 })
  })
})
