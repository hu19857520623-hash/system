import { OutboundService } from './outbound.service'

describe('outbound detail locations', () => {
  function setup(status: string, line: any = {}, exceptionFromStatus?: string) {
    const service = Object.create(OutboundService.prototype) as OutboundService
    const locations = jest.fn().mockResolvedValue([
      { locationCode: 'A-01', qty: 3 },
      { locationCode: 'B-02', qty: 4 },
    ])
    const item = { id: 1, sku: 'SKU-1', qty: 5, pickedQty: 0, locationCode: '', pickAllocations: [], ...line }
    Object.assign(service, {
      prisma: {
        outboundOrder: { findUnique: jest.fn().mockResolvedValue({ status, exceptionFromStatus, warehouseCode: 'WH-1' }) },
        inventoryLocation: { findMany: locations },
      },
      enrichOrders: jest.fn().mockResolvedValue([{ items: [item] }]),
    })
    return { service, locations }
  }

  it.each(['pending_pick', 'picking'])('shows FIFO suggestions for %s without recording an actual pick', async (status) => {
    const { service, locations } = setup(status)
    const result = await service.detail(1)
    expect(result.items[0]).toMatchObject({
      locationCode: '', pickedQty: 0, locationUncovered: 0,
      suggestedLocations: [
        { locationCode: 'A-01', available: 3, pickQty: 3 },
        { locationCode: 'B-02', available: 4, pickQty: 2 },
      ],
    })
    expect(locations.mock.calls[0][0].where).toEqual({ warehouseCode: 'WH-1', sku: 'SKU-1', qty: { gt: 0 } })
  })

  it('preserves all actual allocations without querying current stock', async () => {
    const pickAllocations = [{ id: 1, locationCode: 'A-01', qty: 3 }, { id: 2, locationCode: 'B-02', qty: 2 }]
    const { service, locations } = setup('picked', { pickAllocations, pickedQty: 5 })
    expect((await service.detail(1)).items[0]).toMatchObject({ pickAllocations, suggestedLocations: [] })
    expect(locations).not.toHaveBeenCalled()
  })

  it('reports unavailable stock and still supports exceptions raised before picking', async () => {
    const { service, locations } = setup('exception', {}, 'picking')
    locations.mockResolvedValue([])
    expect((await service.detail(1)).items[0]).toMatchObject({ suggestedLocations: [], locationUncovered: 5 })
  })

  it.each(['shipped', 'cancelled'])('does not present current stock as historical locations for %s', async (status) => {
    const { service, locations } = setup(status)
    expect((await service.detail(1)).items[0].suggestedLocations).toEqual([])
    expect(locations).not.toHaveBeenCalled()
  })
})
