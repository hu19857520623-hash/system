import type { PrismaService } from '../../common/prisma/prisma.service'
import { listOmsCatalogForDisplay } from './oms-catalog-sync.util'

describe('listOmsCatalogForDisplay', () => {
  it('keeps historically synced catalog rows visible to OMS', async () => {
    const row = {
      sku: 'TKL-LEGACY-001',
      productName: 'Legacy catalog item',
      spec: null,
      finalPrice: 10,
      inboundQty: 20,
      soldQty: 0,
      visibleOnOms: false,
      orderableOnOms: false,
      pricingStatus: 'synced',
      shareStatus: 'enabled',
    }
    const prisma = {
      productPricing: { findMany: jest.fn().mockResolvedValue([row]) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService

    const items = await listOmsCatalogForDisplay(prisma)

    expect(prisma.productPricing.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ visibleOnOms: true }, { pricingStatus: 'synced' }] },
    }))
    expect(items).toEqual([expect.objectContaining({
      sku: 'TKL-LEGACY-001',
      visibleOnOms: true,
    })])
  })
})
