import { ReturnsChargeService } from './returns-charge.service'

describe('return fee notifications around transactions', () => {
  it.each([true, false])('notifies only when caller allows publication: %s', async notify => {
    const prisma = {
      customer: { findUnique: jest.fn().mockResolvedValue({ customerCode: 'TKL' }) },
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    }
    const billing = { pushCustomerBillingToOms: jest.fn().mockResolvedValue(undefined) }
    const service = new ReturnsChargeService(prisma as any, billing as any)
    await service.createReturnCharge({ customerId: 1, returnNo: 'RT-ONE', chargeType: 'return_handling', description: '退件处理费', quantity: 1, unitPrice: 2, amount: 2 }, notify)
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1)
    expect(billing.pushCustomerBillingToOms).toHaveBeenCalledTimes(notify ? 1 : 0)
  })
})
