import { ProductsService } from './products.service'

describe('选品审核后的 SKU 标签', () => {
  function setup(product: unknown, dev: unknown) {
    const service = Object.create(ProductsService.prototype) as ProductsService
    const prisma = { product: { findUnique: jest.fn().mockResolvedValue(product) }, productDev: { findFirst: jest.fn().mockResolvedValue(dev) } }
    Object.assign(service, { prisma })
    return { service, prisma }
  }
  it('主数据尚未生成的已通过选品可下载标签，不提前创建主数据', async () => {
    const { service, prisma } = setup(null, { sku: 'AUDIT-SELECTED' })
    const file = await service.getSkuLabel('AUDIT-SELECTED')
    expect(file.mimeType).toContain('text/html')
    expect(file.content.toString('utf8')).toContain('AUDIT-SELECTED')
    expect(prisma.productDev.findFirst).toHaveBeenCalledWith({ where: { sku: 'AUDIT-SELECTED', status: 'approved' }, select: { sku: true } })
  })
  it('已有主数据仍使用原商品标签，草稿和不存在的 SKU 返回中文提示', async () => {
    const existing = setup({ sku: 'AUDIT-EXISTING', barcode: '12345' }, null)
    expect((await existing.service.getSkuLabel('AUDIT-EXISTING')).content.toString('utf8')).toContain('AUDIT-EXISTING')
    expect(existing.prisma.productDev.findFirst).not.toHaveBeenCalled()
    await expect(setup(null, null).service.getSkuLabel('AUDIT-DRAFT')).rejects.toThrow('商品或已通过的选品不存在')
  })
})
