import { ReturnsService } from './returns.service'

describe('disabled return fee templates', () => {
  it('does not recreate deliberately disabled warehouses while listing templates', async () => {
    const tx = {
      $queryRaw: jest.fn(),
      returnFeeTemplate: {
        findFirst: jest.fn().mockResolvedValue({ status: 'inactive' }),
        upsert: jest.fn(),
      },
    }
    const prisma = {
      $transaction: (work: any) => work(tx),
      returnFeeTemplate: { findMany: jest.fn().mockResolvedValue([]) },
    }
    const service = new ReturnsService(prisma as any, null as any, null as any, null as any, null as any, null as any)
    expect(await service.listFeeTemplates()).toEqual([])
    expect(tx.returnFeeTemplate.findFirst).toHaveBeenCalledTimes(3)
    expect(tx.returnFeeTemplate.upsert).not.toHaveBeenCalled()
    expect(prisma.returnFeeTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'active' }) }))
  })
})
