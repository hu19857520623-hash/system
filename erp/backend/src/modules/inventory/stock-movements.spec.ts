import 'reflect-metadata'
import { readStockMovements } from './stock-movements.util'

it('uses actual movement quantities and links each partial operation to its own IP', async () => {
  const createdAt = new Date('2026-11-21T08:00:05.000Z')
  const inbound = { changeType: 'putaway', referenceNo: 'IN-01', operatorId: 4n, remark: 'A-02', changeQty: 3, beforeQty: 10, afterQty: 13, createdAt }
  const prisma = {
    inventoryLog: { count: jest.fn().mockResolvedValue(8), findMany: jest.fn().mockResolvedValue([
      { ...inbound, id: 23n, changeType: 'outbound', referenceNo: 'OUT-01', changeQty: -3, operatorId: 6n },
      { ...inbound, id: 22n, beforeQty: 13, afterQty: 16 },
      { ...inbound, id: 21n },
      { ...inbound, id: 20n },
    ]) },
    outboundOrder: { findMany: jest.fn().mockResolvedValue([{ outboundNo: 'OUT-01', pickerId: 7n, customerId: 1n, items: [{ pickAllocations: [{ inboundNo: 'IN-01', locationCode: 'A-02', qty: 3, unitCostRmb: '4.50' }] }] }]) },
    inboundOrder: { findMany: jest.fn().mockResolvedValue([{ inboundNo: 'IN-01', omsCustomerCode: 'C01' }]) },
    operationLog: { findMany: jest.fn().mockResolvedValue([
      { detail: { inventoryLogIds: ['21'] }, ipAddress: '192.0.2.21' },
      { detail: { inventoryLogIds: ['23'] }, ipAddress: '2001:db8::23' },
      { detail: { inventoryLogIds: ['22'] }, ipAddress: '192.0.2.22' },
      { detail: {}, ipAddress: '192.0.2.12' },
    ]) },
    sysUser: { findMany: jest.fn().mockResolvedValue([
      { id: 4n, realName: '上架员' }, { id: 6n, realName: '发运员' }, { id: 7n, username: 'picker' },
    ]) },
    customer: { findMany: jest.fn().mockResolvedValue([{ id: 1n, customerCode: 'C01', customerName: '客户甲' }]) },
  }

  const result = await readStockMovements(prisma as never, 'SKU01', { warehouseCode: 'WMS-TEST', page: 2, pageSize: 4 })

  expect(prisma.inventoryLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
    skip: 4, take: 4, where: { sku: 'SKU01', warehouseCode: 'WMS-TEST', changeType: { in: ['outbound', 'putaway'] } },
  }))
  expect(result).toMatchObject({ total: 8, items: [
    { direction: 'outbound', changeQty: -3, operatorName: '发运员', pickerName: 'picker', createdAt, ipAddress: '2001:db8::23', inboundLots: [{ batch: 'IN-01', qty: 3, unitCostRmb: 4.5 }] },
    { direction: 'inbound', changeQty: 3, operatorName: '上架员', customerName: '客户甲', locationCode: 'A-02', ipAddress: '192.0.2.22' },
    { direction: 'inbound', ipAddress: '192.0.2.21' },
    { direction: 'inbound', ipAddress: null },
  ] })
})
