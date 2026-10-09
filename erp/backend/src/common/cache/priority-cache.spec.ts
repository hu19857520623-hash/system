import { WarehouseService } from '../../modules/warehouse/warehouse.service'
import { WarehouseZoneService } from '../../modules/warehouse-location/warehouse-zone.service'
import { ProductsService } from '../../modules/products/products.service'
import { AnnouncementService } from '../../modules/announcement/announcement.service'

function memoCache() {
  const entries = new Map<string, any>()
  return {
    entries,
    remember: jest.fn(async (group, key, _ttl, load) => {
      const id = group + ':' + key
      if (!entries.has(id)) entries.set(id, JSON.parse(JSON.stringify(await load())))
      return entries.get(id)
    }),
    invalidate: jest.fn(async group => {
      for (const key of entries.keys()) if (key.startsWith(group + ':')) entries.delete(key)
    }),
  }
}

describe('Priority application caches', () => {
  it('refreshes warehouse lists after writes and keeps detail reads live', async () => {
    const cache = memoCache()
    let name = 'Before'
    const prisma = { warehouse: {
      findMany: jest.fn(async () => [{ id: 1, warehouseName: name }]),
      findUnique: jest.fn(async () => ({ id: 1, warehouseName: name })),
      update: jest.fn(async () => ({ id: 1, warehouseName: name = 'After' })),
    } }
    const service = new WarehouseService(prisma as any, cache as any)
    await service.list()
    await service.list()
    expect(prisma.warehouse.findMany).toHaveBeenCalledTimes(1)
    await service.update(1, { warehouseName: 'After' })
    expect((await service.list())[0].warehouseName).toBe('After')
    expect((await service.detail(1)).warehouseName).toBe('After')
  })

  it('does not share warehouse filters or invalidate failed writes', async () => {
    const cache = memoCache()
    const prisma = { warehouse: {
      findMany: jest.fn(async () => []), findUnique: jest.fn(async () => ({ id: 1 })),
      update: jest.fn(async () => { throw new Error('failed') }),
    } }
    const service = new WarehouseService(prisma as any, cache as any)
    await service.list()
    await service.list('all')
    expect(prisma.warehouse.findMany).toHaveBeenCalledTimes(2)
    await expect(service.update(1, {})).rejects.toThrow('failed')
    expect(cache.invalidate).not.toHaveBeenCalled()
  })

  it('caches zone metadata while reading location counts on every request', async () => {
    const cache = memoCache()
    let count = 1
    const prisma = { warehouseZone: { findMany: jest.fn(async args => args.select
      ? [{ id: 1n, _count: { locations: count } }]
      : [{ id: 1n, warehouseCode: 'W1', zoneName: 'A' }]) } }
    const service = new WarehouseZoneService(prisma as any, {} as any, cache as any)
    expect((await service.list('W1'))[0].locationCount).toBe(1)
    count = 2
    expect((await service.list('W1'))[0].locationCount).toBe(2)
    expect(prisma.warehouseZone.findMany.mock.calls.filter(([args]) => !args.select)).toHaveLength(1)
    expect(JSON.stringify([...cache.entries.values()])).not.toContain('locations')
  })

  it('stores product basic fields and image paths without prices, costs or stock', async () => {
    const cache = memoCache()
    const prisma = { productImage: { findMany: jest.fn(async () => [
      { id: 2n, productId: 1n, imageUrl: '/image.jpg' },
    ]) } }
    const service = new ProductsService(prisma as any, {} as any, {} as any, {} as any, cache as any)
    const row = { id: 1n, sku: 'S1', productName: 'Name', spec: 'Spec', updatedAt: new Date(0),
      costRmb: 100, marketPrice: 200, available: 10 }
    const load = (service as any).loadProductBasics.bind(service)
    await load([row])
    await load([{ ...row, costRmb: 101, available: 9 }])
    expect(prisma.productImage.findMany).toHaveBeenCalledTimes(1)
    const stored = JSON.stringify([...cache.entries.values()])
    expect(stored).toContain('Name')
    expect(stored).toContain('/image.jpg')
    for (const field of ['costRmb', 'marketPrice', 'available']) expect(stored).not.toContain(field)
    await load([{ ...row, productName: 'Changed', updatedAt: new Date(1) }])
    expect(prisma.productImage.findMany).toHaveBeenCalledTimes(2)
  })

  it('hides announcements that expire while their list is cached', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-08T00:00:00Z'))
    try {
      const cache = memoCache()
      const row = { id: 1n, title: 'Notice', targetChannel: 'oms', status: 'published',
        publishedAt: new Date('2026-10-07'), scheduledAt: null, expiresAt: new Date('2026-10-08T00:00:01Z'),
        createdAt: new Date('2026-10-07'), updatedAt: new Date('2026-10-07') }
      const prisma = { announcement: { findMany: jest.fn(async args => args.where.status === 'scheduled' ? [] : [row]) } }
      const service = new AnnouncementService(prisma as any, cache as any)
      expect((await service.listForOms()).total).toBe(1)
      jest.advanceTimersByTime(2000)
      expect((await service.listForOms()).total).toBe(0)
      expect(prisma.announcement.findMany.mock.calls.filter(([args]) => args.where.status === 'published')).toHaveLength(1)
    } finally { jest.useRealTimers() }
  })

  it('invalidates an announcement immediately after deletion', async () => {
    const cache = memoCache()
    const row = { id: 1n, publishedAt: null, scheduledAt: null, createdAt: new Date() }
    const prisma = { announcement: { findUnique: jest.fn(async () => row), delete: jest.fn(async () => row) } }
    await new AnnouncementService(prisma as any, cache as any).remove(1)
    expect(cache.invalidate).toHaveBeenCalledWith('announcements')
  })
})
