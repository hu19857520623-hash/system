import { BadRequestException } from '@nestjs/common'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { BillingService } from '../billing/billing.service'
import { OmsPurchaseService } from './oms-purchase.service'

describe('OmsPurchaseService', () => {
  it('prefers the published TKL catalog row over an unpublished source pricing row', async () => {
    const catalogRow = {
      id: 738n,
      sku: 'TKL-FIT-WEI-POW-001',
      productName: 'Adjustable Split Squat Rack Pair',
      finalPrice: 292,
      visibleStockQty: 150,
      inboundQty: 150,
      purchaseQty: 50,
      soldQty: 0,
      visibleOnOms: true,
      orderableOnOms: true,
    }
    const prisma = {
      omsCatalogOrder: { findUnique: jest.fn().mockResolvedValue(null) },
      customer: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: 44n })
          .mockResolvedValueOnce({ id: 44n, customerCode: 'TKL0444', status: 1, balance: 0 }),
      },
      productPricing: {
        findUnique: jest.fn().mockResolvedValue(catalogRow),
        findFirst: jest.fn(),
      },
    } as unknown as PrismaService
    const service = new OmsPurchaseService(prisma, {} as BillingService)

    await expect(service.recordPurchase({
      orderNo: 'CAT-TKL0444-TEST-001',
      customerCode: 'TKL0444',
      sku: 'FIT-WEI-POW-001',
      quantity: 1,
    })).rejects.toThrow(new BadRequestException('客户余额不足：可用 ¥0.00，需支付 ¥292.00'))

    expect(prisma.productPricing.findUnique).toHaveBeenCalledWith({
      where: { sku: 'TKL-FIT-WEI-POW-001' },
    })
    expect(prisma.productPricing.findFirst).not.toHaveBeenCalled()
  })
})
