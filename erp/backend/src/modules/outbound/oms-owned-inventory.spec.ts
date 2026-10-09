import { OutboundService } from './outbound.service'
import { notifyOms } from '../../common/oms-notify.util'

jest.mock('../../common/oms-notify.util', () => ({ notifyOms: jest.fn().mockResolvedValue(true) }))

describe('cancelled owned outbound inventory notification', () => {
  beforeEach(() => jest.clearAllMocks())

  function setup(stockSource = 'owned', rows: any[] = [{ productId: 3n, availableQty: 12, lockedQty: 3 }]) {
    const service = Object.create(OutboundService.prototype) as OutboundService
    const inventory = { findMany: jest.fn().mockResolvedValue(rows) }
    Object.assign(service, {
      prisma: { inventory },
      getByOutboundNoForOms: jest.fn().mockResolvedValue({
        outboundNo: 'OUT-1', customerCode: 'TKL005', warehouseCode: 'WMS-JHB-01', status: 'cancelled', stockSource,
        items: [{ productId: 3, sku: 'SKU-1', qty: 2 }],
      }),
    })
    return { service, inventory }
  }

  it('sends committed ERP stock counts and warehouse instead of just outbound quantities', async () => {
    const { service, inventory } = setup()
    await (service as any).pushOutboundStatusToOms('OUT-1')
    expect(inventory.findMany).toHaveBeenCalledWith({
      where: { warehouseCode: 'WMS-JHB-01', productId: { in: [3n] } },
      select: { productId: true, availableQty: true, lockedQty: true },
    })
    expect(notifyOms).toHaveBeenCalledWith('inventory.changed', 'TKL005', {
      reason: 'outbound_cancelled', outboundNo: 'OUT-1', stockSource: 'owned', warehouseCode: 'WMS-JHB-01',
      items: [{ productId: 3, sku: 'SKU-1', qty: 2, availableQty: 12, lockedQty: 3 }],
    })
  })

  it('does not report zero counts when the ERP stock row is missing', async () => {
    const { service } = setup('owned', [])
    await (service as any).pushOutboundStatusToOms('OUT-1')
    expect(notifyOms).toHaveBeenCalledWith('inventory.changed', 'TKL005', expect.objectContaining({ items: [] }))
  })

  it('keeps catalog cancellation quantities for its separate inventory handling', async () => {
    const { service, inventory } = setup('catalog')
    await (service as any).pushOutboundStatusToOms('OUT-1')
    expect(inventory.findMany).not.toHaveBeenCalled()
    expect(notifyOms).toHaveBeenCalledWith('inventory.changed', 'TKL005', expect.objectContaining({
      stockSource: 'catalog', items: [{ productId: 3, sku: 'SKU-1', qty: 2 }],
    }))
  })
})
