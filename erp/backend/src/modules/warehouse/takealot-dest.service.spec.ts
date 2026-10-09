import { TakealotDestService } from './takealot-dest.service'
import { CacheService } from '../../common/cache/cache.service'
import { PrismaService } from '../../common/prisma/prisma.service'

describe('Takealot destination cache integration', () => {
  const row = {
    id: 1, code: 'JHB', omsWarehouseId: 'jhb1', label: 'JHB',
    city: 'Johannesburg', matchAliases: '[]', enabled: true, sortOrder: 0,
  }
  const setup = () => {
    const prisma = { takealotDestWarehouse: {
      findMany: jest.fn().mockResolvedValue([row]),
      findUnique: jest.fn().mockResolvedValue(row),
      create: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue(row),
    } }
    const cache = {
      remember: jest.fn().mockImplementation((_group, _key, _ttl, load) => load()),
      invalidate: jest.fn().mockResolvedValue(undefined),
    }
    const service = new TakealotDestService(prisma as unknown as PrismaService, cache as unknown as CacheService)
    return { service, prisma, cache }
  }

  it('caches the fulfillment DTO without changing its response shape', async () => {
    const { service, cache } = setup()
    expect(await service.listForOmsFulfillment()).toEqual({ items: [{ id: 'jhb1', city: 'Johannesburg' }] })
    expect(cache.remember).toHaveBeenCalledWith(
      'takealot-dest', 'erp:takealot-dest:fulfillment', 30, expect.any(Function))
  })

  it('invalidates shared entries after a successful configuration change', async () => {
    const { service, cache } = setup()
    await service.create({ code: 'JHB' })
    await service.update(1, { city: 'Updated' })
    expect(cache.invalidate).toHaveBeenCalledTimes(2)
    expect(cache.invalidate).toHaveBeenCalledWith('takealot-dest')
  })

  it('does not invalidate when a database write fails', async () => {
    const { service, prisma, cache } = setup()
    prisma.takealotDestWarehouse.update.mockRejectedValueOnce(new Error('write failed'))
    await expect(service.update(1, { city: 'Updated' })).rejects.toThrow('write failed')
    expect(cache.invalidate).not.toHaveBeenCalled()
  })
})
