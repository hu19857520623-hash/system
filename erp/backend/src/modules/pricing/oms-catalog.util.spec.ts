import type { PrismaService } from '../../common/prisma/prisma.service'
import { pushCatalogStockToOms } from './oms-catalog-sync.util'
import { tryMarkOrderableOnOms } from './oms-catalog.util'

jest.mock('./oms-catalog-sync.util', () => ({
  pushCatalogStockToOms: jest.fn().mockResolvedValue(undefined),
}))

describe('tryMarkOrderableOnOms', () => {
  it('does not reopen a catalog row that was manually stopped', async () => {
    const catalogRow = {
      id: 23n,
      sku: 'TKL-FUR-BED-MAT-003',
      visibleOnOms: true,
      orderableOnOms: false,
      shareStatus: 'stopped',
    }
    const prisma = {
      productPricing: {
        findUnique: jest.fn().mockResolvedValue(catalogRow),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      warehouse: { findMany: jest.fn() },
      inventory: { findFirst: jest.fn() },
      productPricingHistory: { create: jest.fn() },
    } as unknown as PrismaService

    await expect(tryMarkOrderableOnOms(prisma, 'FUR-BED-MAT-003')).resolves.toBe(false)
    expect(prisma.productPricing.update).not.toHaveBeenCalled()
    expect(prisma.warehouse.findMany).not.toHaveBeenCalled()
  })

  it('prefers the TKL catalog row when a base-SKU pricing row also exists', async () => {
    const catalogRow = {
      id: 22n,
      sku: 'TKL-FUR-BED-MAT-002',
      visibleOnOms: true,
      orderableOnOms: false,
      visibleStockQty: 41,
      inboundQty: 40,
      purchaseQty: 256,
      soldQty: 0,
    }
    const prisma = {
      productPricing: {
        findUnique: jest.fn().mockResolvedValue(catalogRow),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({ ...catalogRow, orderableOnOms: true }),
      },
      warehouse: {
        findMany: jest.fn().mockResolvedValue([{ warehouseCode: 'WMS-JHB-01' }]),
      },
      inventory: {
        findFirst: jest.fn().mockResolvedValue({
          sku: 'FUR-BED-MAT-002',
          warehouseCode: 'WMS-JHB-01',
          availableQty: 72,
        }),
      },
      productPricingHistory: {
        create: jest.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaService

    await expect(tryMarkOrderableOnOms(prisma, 'FUR-BED-MAT-002')).resolves.toBe(true)
    expect(prisma.productPricing.findUnique).toHaveBeenCalledWith({
      where: { sku: 'TKL-FUR-BED-MAT-002' },
    })
    expect(prisma.productPricing.findFirst).not.toHaveBeenCalled()
    expect(prisma.productPricing.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { sku: 'TKL-FUR-BED-MAT-002' },
      data: expect.objectContaining({ orderableOnOms: true }),
    }))
    expect(pushCatalogStockToOms).toHaveBeenCalledWith(prisma, 'FUR-BED-MAT-002')
  })
})
