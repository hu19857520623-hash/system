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
      imageUrl: null,
    })])
  })

  it('returns the primary ERP product image and resolves storage URLs', async () => {
    const row = {
      sku: 'TKL-IMAGE-001',
      productName: 'Catalog image item',
      spec: null,
      finalPrice: 20,
      inboundQty: 5,
      soldQty: 0,
      visibleOnOms: true,
      orderableOnOms: true,
      pricingStatus: 'synced',
      shareStatus: 'enabled',
    }
    const product = {
      id: 1n,
      sku: 'TKL-IMAGE-001',
      spec: null,
      imageUrl: 'cos://legacy.jpg',
      images: [{ imageUrl: 'cos://primary.jpg' }],
      lengthCm: 1,
      widthCm: 2,
      heightCm: 3,
      weightKg: 4,
      measuredLengthCm: null,
      measuredWidthCm: null,
      measuredHeightCm: null,
    }
    const prisma = {
      productPricing: { findMany: jest.fn().mockResolvedValue([row]) },
      product: { findMany: jest.fn().mockResolvedValue([product]) },
    } as unknown as PrismaService

    const items = await listOmsCatalogForDisplay(prisma, (url) => `https://img.example/${url.slice(6)}`)

    expect(items[0]).toEqual(expect.objectContaining({
      sku: 'TKL-IMAGE-001',
      imageUrl: 'https://img.example/primary.jpg',
    }))
    expect((prisma.product.findMany as jest.Mock).mock.calls[0][0]).toEqual(expect.objectContaining({
      include: expect.objectContaining({ images: expect.any(Object) }),
    }))
  })
})
