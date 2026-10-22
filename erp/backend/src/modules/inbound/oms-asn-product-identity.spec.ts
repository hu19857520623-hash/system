import { InboundService } from './inbound.service'

function fixture(mapped: Array<{ internalSku: string; customerSku?: string }>) {
  const prisma = {
    product: {
      findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 1n, ...data })),
    },
    $queryRawUnsafe: jest.fn().mockResolvedValue(mapped),
    $queryRaw: jest.fn().mockResolvedValue([]),
  }
  const service = new InboundService(prisma as any, null as any, null as any, null as any, null as any, null as any)
  return { prisma, resolve: (sku: string) => (service as any).ensureProductBySku(sku, '产品一', 'TKL9001') }
}

describe('OMS first ASN product identity', () => {
  it.each(['WF1016A', 'TKL9001-WF1016A'])('reuses the customer-scoped OMS identity for input %s', async input => {
    const { prisma, resolve } = fixture([{ internalSku: 'TKL9001-WF1016A', customerSku: 'WF1016A' }])
    const result = await resolve(input)
    expect(result.sku).toBe('TKL9001-WF1016A')
    expect(prisma.product.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      sku: 'TKL9001-WF1016A', customerSku: 'WF1016A', category: 'OMS',
    }) })
    expect(prisma.$queryRawUnsafe.mock.calls[0]).toEqual([
      expect.stringContaining('customerId IN'), input, input, 'TKL9001',
    ])
    expect(prisma.$queryRaw.mock.calls[0][0].values).not.toContain('TKL9001-TKL9001-WF1016A')
  })

  it('preserves a deliberate customer SKU containing the customer code prefix', async () => {
    const { resolve, prisma } = fixture([{ internalSku: 'TKL9001-TKL9001-X', customerSku: 'TKL9001-X' }])
    await resolve('TKL9001-X')
    expect(prisma.product.create.mock.calls[0][0].data).toMatchObject({
      sku: 'TKL9001-TKL9001-X', customerSku: 'TKL9001-X',
    })
  })

  it('does not exempt an unverified OMS row from the global uniqueness check', async () => {
    const { prisma, resolve } = fixture([])
    prisma.$queryRaw.mockResolvedValue([{ code: 'TKL9002-NEW' }] as any)
    await expect(resolve('NEW')).rejects.toThrow('全局不可重复')
    expect(prisma.product.create).not.toHaveBeenCalled()
    expect(prisma.$queryRaw.mock.calls[0][0].values.filter((value: unknown) => value === '')).toHaveLength(3)
  })

  it('does not add a second prefix to an already qualified SKU without an OMS card', async () => {
    const { prisma, resolve } = fixture([])
    await resolve('TKL9001-NEW')
    expect(prisma.product.create.mock.calls[0][0].data).toMatchObject({ sku: 'TKL9001-NEW', customerSku: 'NEW' })
  })
})
