import { InventoryService } from './inventory.service'
import { ERP_MASTER_PRODUCT_WHERE } from '../../common/product-source.util'

describe('SKU query customer and supplier identities', () => {
  const omsProduct = { id: 8, internalSku: 'TKL0001-CLIENT', name: '客户商品', customerCode: 'TKL0001', customerName: '客户甲', productStatus: 'available' }
  const erpProduct = { id: 1n, sku: 'ERP-SKU', productName: 'ERP 商品', supplierId: 2n, developerId: null, status: 'active', syncStatus: 'synced', createdAt: new Date(), updatedAt: new Date(), remark: null }

  function fixture(products: any[] = []) {
    const prisma = {
      product: { count: jest.fn().mockResolvedValue(products.length), findMany: jest.fn().mockResolvedValueOnce(products).mockResolvedValue([]) },
      supplier: { findMany: jest.fn().mockResolvedValue([{ id: 2n, supplierCode: 'SUP-02', supplierName: '真实供应商' }]) },
      customer: { findMany: jest.fn().mockResolvedValue([{ customerCode: 'TKL0001', customerName: '客户甲' }]) },
      sysUser: { findMany: jest.fn().mockResolvedValue([{ id: 3n, username: 'developer', realName: '开发员' }]) },
      productPricing: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $queryRawUnsafe: jest.fn().mockResolvedValue([omsProduct]),
    }
    const service = new InventoryService(prisma as any, {} as any, {} as any)
    jest.spyOn(service as any, 'loadSkuInventoryFlags').mockResolvedValue(new Map())
    return { service, prisma }
  }

  it('keeps OMS customers separate from suppliers and does not invent a pending sync', async () => {
    const { service } = fixture()
    const result = await service.querySkuCatalog({})
    expect(result.items[0]).toMatchObject({ dataSource: 'oms', customerCode: 'TKL0001', customerName: '客户甲', supplierName: '', syncStatus: null,
      salesStatus: null, orderableOnOms: null, visibleOnOms: null, operationStatus: 'available', operationStatusLabel: '可用' })
  })

  it('uses the ERP supplier record and preserves its actual sync status', async () => {
    const { service } = fixture([erpProduct])
    const result = await service.querySkuCatalog({})
    expect(result.items[0]).toMatchObject({ dataSource: 'erp', supplierName: '真实供应商', syncStatus: 'synced' })
  })

  it('does not label historical OMS warehouse records as ERP pending sync', async () => {
    const { service, prisma } = fixture([{ ...erpProduct, sku: 'TKL0001-LEGACY', remark: 'OMS 预约入库自动建档', syncStatus: 'pending' }])
    prisma.$queryRaw.mockResolvedValue([{ id: 1n }])
    const result = await service.querySkuCatalog({})
    expect(result.items[0]).toMatchObject({ dataSource: 'oms', customerCode: 'TKL0001', customerName: '客户甲', supplierName: '', syncStatus: null,
      salesStatus: null, orderableOnOms: null, visibleOnOms: null, operationStatusLabel: '可用' })
  })

  it('does not use a developer login as a customer code and limits ERP-only counts to ERP', async () => {
    const { service, prisma } = fixture([{ ...erpProduct, developerId: 3n }])
    const result = await service.querySkuCatalog({ dataSource: 'erp' })
    expect(result).toMatchObject({ total: 1, items: [{ customerCode: '', developerName: '开发员', dataSource: 'erp' }] })
    expect(prisma.product.count).toHaveBeenCalledWith({ where: { AND: [{ OR: [ERP_MASTER_PRODUCT_WHERE] }] } })
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled()
  })

  it('returns OMS products from page one and searches both system and customer SKUs', async () => {
    const { service, prisma } = fixture([erpProduct])
    prisma.product.findMany.mockReset().mockResolvedValue([])
    prisma.$queryRawUnsafe.mockResolvedValue([{ ...omsProduct, customerSku: 'Client SKU' }])
    const result = await service.querySkuCatalog({ dataSource: 'oms', skuCodes: 'Client Other' })
    expect(result).toMatchObject({ total: 1, items: [{ dataSource: 'oms', customerSku: 'Client SKU' }] })
    expect(prisma.product.count).not.toHaveBeenCalled()
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('(p.internalSku LIKE ? OR p.customerSku LIKE ?) OR (p.internalSku LIKE ? OR p.customerSku LIKE ?)'),
      '%Client%', '%Client%', '%Other%', '%Other%',
    )
  })

  it('does not use supplier searches to return matching OMS customers', async () => {
    const { service, prisma } = fixture()
    const result = await service.querySkuCatalog({ supplierKeyword: '客户甲' })
    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled()
    expect(prisma.supplier.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ supplierName: { contains: '客户甲' } }, { supplierCode: { contains: '客户甲' } }] },
    }))
  })

  it.each([['draft', '草稿'], ['reviewing', '审核中'], ['discarded', '废弃'], ['future_status', 'future_status']])(
    'preserves the customer product workflow %s even when inCatalog is set', async (productStatus, operationStatusLabel) => {
      const { service, prisma } = fixture()
      prisma.$queryRawUnsafe.mockResolvedValue([{ ...omsProduct, inCatalog: true, productStatus }])
      const result = await service.querySkuCatalog({})
      expect(result.items[0]).toMatchObject({ operationStatus: productStatus, operationStatusLabel,
        salesStatus: null, orderableOnOms: null, visibleOnOms: null })
    },
  )

  it('preserves ERP catalog sales permissions from pricing', async () => {
    const { service, prisma } = fixture([erpProduct])
    prisma.productPricing.findMany.mockResolvedValue([{ sku: 'ERP-SKU', visibleOnOms: true, orderableOnOms: true }] as any)
    const result = await service.querySkuCatalog({})
    expect(result.items[0]).toMatchObject({ dataSource: 'erp', salesStatus: '允许销售', visibleOnOms: true, orderableOnOms: true })
    expect(result.items[0]).not.toHaveProperty('operationStatus')
  })
})
