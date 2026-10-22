import { InventoryMutationService } from './inventory-mutation.service'
import { buildErpWarehouseInventoryRow } from '../inventory-row-mapper.util'

describe('warehouse total and locked quantities', () => {
  function displayed(total: number, available: number, locked: number) {
    return buildErpWarehouseInventoryRow({
      id: 1, productId: 1, sku: 'FUR-LVR-SID-011', productName: '商品',
      spec: '', category: '', spu: '', barcode: '', rawWarehouseCode: 'WMS-JHB-01',
      total, available, locked, inTransit: 0, pendingPutaway: 0,
    })
  }

  it('displays the warehouse total before shipping rather than the available balance', () => {
    expect(displayed(200, 191, 9)).toMatchObject({ totalQty: 200, lockedQty: 9 })
    expect(displayed(200, 188, 9).totalQty).toBe(200)
  })

  it.each([[9, 0], [14, 5]])('shipping 9 reduces a lock of %i to %i without changing available stock', async (locked, remainingLocked) => {
    const stock = { id: 1n, totalQty: 200, availableQty: 200 - locked, lockedQty: locked }
    const tx = {
      inventory: {
        findUnique: jest.fn().mockImplementation(async () => ({ ...stock })),
        update: jest.fn().mockImplementation(async ({ data }) => Object.assign(stock, data)),
      },
      inventoryLog: { create: jest.fn() },
    }
    await new InventoryMutationService().shipDeductWarehouse(tx as any, {
      productId: 1n, sku: 'FUR-LVR-SID-011', warehouseCode: 'WMS-JHB-01',
      qty: 9, referenceNo: 'TEST-SHIP-9',
    })
    expect(stock).toMatchObject({ totalQty: 191, lockedQty: remainingLocked, availableQty: 200 - locked })
    expect(displayed(stock.totalQty, stock.availableQty, stock.lockedQty)).toMatchObject({ totalQty: 191, lockedQty: remainingLocked })
    expect(tx.inventoryLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ changeQty: -9, beforeQty: 200, afterQty: 191 }) })
  })
})
