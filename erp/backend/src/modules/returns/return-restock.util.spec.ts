import { restockReturnToLocations, returnRestockProgress, returnProcessFingerprint } from './return-restock.util'
import { isValidProcessMethod } from './return.constants'

const row = { id: 2n, returnNo: 'RT-TKL9001-TEST', customerId: 260n, omsCustomerCode: 'TKL9001', receivedQty: 2,
  items: [{ sku: 'TKL9001-A', quantity: 2 }] }
const body = { warehouseCode: 'WMS-JHB-01', stockLines: [{ sku: 'TKL9001-A', qty: 1, locationCode: 'A-01' }] }
function setup() {
  const tx = {
    warehouse: { findUnique: jest.fn().mockResolvedValue({ warehouseCode: 'WMS-JHB-01', warehouseType: 'wms', status: 1 }) },
    inventoryLog: { findMany: jest.fn().mockResolvedValue([]) },
    product: { findMany: jest.fn().mockResolvedValue([{ id: 681n, sku: 'TKL9001-A', productName: '商品', remark: '[OMS:TKL9001]' }]) },
    customer: { findUnique: jest.fn().mockResolvedValue({ customerCode: 'TKL9001', status: 1 }) },
    customerSkuInventory: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    omsCatalogOrder: { findFirst: jest.fn().mockResolvedValue(null) },
    warehouseLocation: { findFirst: jest.fn().mockResolvedValue({ id: 42n, locationCode: 'A-01' }) },
    inventory: { findUnique: jest.fn().mockResolvedValue({ avgCostRmb: 8 }) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  }
  const mutation = { addLocationStock: jest.fn().mockResolvedValue(undefined) }
  return { tx, mutation, run: (order = row, input = body) => restockReturnToLocations(tx as any, order, input, mutation as any, 7) }
}
describe('return restock actual locations and quantities', () => {
  it('adds a partial return to a location and warehouse together while preserving remaining work', async () => {
    const { run, mutation } = setup();expect(await run()).toMatchObject({ batchQty: 1, restockedQty: 1, remainingRestockQty: 1 })
    expect(mutation.addLocationStock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ productId: 681n, qty: 1, locationId: 42n, batchNo: 'RETURN-2', unitCostRmb: 8 }), expect.objectContaining({ changeType: 'return_restock', referenceNo: row.returnNo, operatorId: 7 }))
  })
  it('continuing after a previous batch restores only the received remaining quantity', async () => {
    const { tx, run } = setup();tx.inventoryLog.findMany.mockResolvedValue([{ referenceNo: row.returnNo, sku: 'TKL9001-A', changeQty: 1 }] as any)
    expect(await run()).toMatchObject({ restockedQty: 2, remainingRestockQty: 0 })
    await expect(run(row, { ...body, stockLines: [{ ...body.stockLines[0], qty: 2 }] })).rejects.toThrow('当前剩余 1 件')
  })
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects quantity %s without changing stock', async qty => {
    const { run, mutation } = setup();await expect(run(row, { ...body, stockLines: [{ ...body.stockLines[0], qty }] })).rejects.toThrow('大于零的整数')
    expect(mutation.addLocationStock).not.toHaveBeenCalled()
  })
  it('checks total received quantity and per-SKU remainder independently', async () => {
    const { run } = setup()
    await expect(run({ ...row, receivedQty: 1 }, { ...body, stockLines: [{ ...body.stockLines[0], qty: 2 }] })).rejects.toThrow('当前剩余 1 件')
    await expect(run({ ...row, receivedQty: 3, items: [{ sku: 'TKL9001-A', quantity: 1 }, { sku: 'TKL9001-B', quantity: 2 }] }, { ...body, stockLines: [{ ...body.stockLines[0], qty: 2 }] })).rejects.toThrow('累计上架数量超出退件明细')
  })
  it('validates all locations before any line is applied', async () => {
    const { tx, run, mutation } = setup();tx.warehouseLocation.findFirst.mockResolvedValueOnce({ id: 42n, locationCode: 'A-01' }).mockResolvedValueOnce(null)
    await expect(run(row, { ...body, stockLines: [body.stockLines[0], { ...body.stockLines[0], locationCode: 'INVALID' }] })).rejects.toThrow('库位 INVALID 不可用')
    expect(mutation.addLocationStock).not.toHaveBeenCalled()
  })
  it('rejects an unknown SKU, missing location, missing archive and another customer product', async () => {
    const { tx, run, mutation } = setup()
    await expect(run(row, { ...body, stockLines: [{ ...body.stockLines[0], sku: 'OTHER' }] })).rejects.toThrow('不属于当前退件单')
    await expect(run(row, { ...body, stockLines: [{ ...body.stockLines[0], locationCode: '' }] })).rejects.toThrow('实际上架库位')
    tx.product.findMany.mockResolvedValueOnce([])
    await expect(run()).rejects.toThrow('尚未建立仓内商品档案')
    tx.product.findMany.mockResolvedValueOnce([{ id: 1n, sku: 'TKL9001-A', productName: '商品', remark: '[OMS:TKL9002]' }])
    await expect(run()).rejects.toThrow('不属于该退件客户');expect(mutation.addLocationStock).not.toHaveBeenCalled()
  })
  it('rejects an unavailable or non-overseas warehouse', async () => {
    const { tx, run } = setup();tx.warehouse.findUnique.mockResolvedValueOnce({ warehouseType: 'logistics', status: 1 } as any)
    await expect(run()).rejects.toThrow('不是海外仓')
    await expect(run(row, { ...body, warehouseCode: '' })).rejects.toThrow('请选择实际返库仓库')
  })
  it('catalog return restores warehouse stock and the same customer holding after ownership proof', async () => {
    const { tx, run, mutation } = setup()
    tx.product.findMany.mockResolvedValue([{ id: 1n, sku: 'TKL-A', productName: '货盘商品', remark: null as any }])
    tx.customerSkuInventory.findUnique.mockResolvedValue({ id: 1n, quantity: 0 } as any)
    const result = await run({ ...row, items: [{ sku: 'TKL-A', quantity: 2 }] }, { ...body, stockLines: [{ sku: 'TKL-A', qty: 1, locationCode: 'A-01' }] })
    expect(result.remainingRestockQty).toBe(1);expect(mutation.addLocationStock).toHaveBeenCalledTimes(1)
    expect(tx.customerSkuInventory.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { customerId_sku: { customerId: 260n, sku: 'TKL-A' } }, update: { quantity: { increment: 1 } } }))
  })
  it('catalog return without customer purchase or holding proof cannot credit shared stock', async () => {
    const { tx, run, mutation } = setup();tx.product.findMany.mockResolvedValue([{ id: 1n, sku: 'TKL-A', productName: '货盘商品', remark: null as any }])
    await expect(run({ ...row, items: [{ sku: 'TKL-A', quantity: 2 }] }, { ...body, stockLines: [{ sku: 'TKL-A', qty: 1, locationCode: 'A-01' }] })).rejects.toThrow('未找到该客户的货盘持有或采购记录')
    expect(mutation.addLocationStock).not.toHaveBeenCalled()
  })
  it('progress ignores other returns and fingerprint treats reorder as same request but changed quantity differently', () => {
    expect(returnRestockProgress(row, [{ referenceNo: 'OTHER', sku: 'TKL9001-A', changeQty: 100 }, { referenceNo: row.returnNo, sku: 'TKL9001-A', changeQty: 1 }])).toMatchObject({ restockedQty: 1, remainingRestockQty: 1 })
    const first = { ...body, stockLines: [body.stockLines[0], { sku: 'TKL9001-B', qty: 2, locationCode: 'B-01' }] }
    expect(returnProcessFingerprint(first, 'restock')).toBe(returnProcessFingerprint({ ...first, stockLines: [...first.stockLines].reverse() }, 'restock'))
    expect(returnProcessFingerprint(body, 'restock')).not.toBe(returnProcessFingerprint({ ...body, stockLines: [{ ...body.stockLines[0], qty: 2 }] }, 'restock'))
    expect(isValidProcessMethod('__proto__')).toBe(false);expect(isValidProcessMethod('constructor')).toBe(false)
  })
})
