import { listInboundWorkOrders } from './inbound-work-orders.util'

describe('仓库作业单专用分页', () => {
  it('在数据库按仓库和真实作业状态筛选分页，5000条以上仍提供真实总数和后续页', async () => {
    const db = { inboundOrder: { findMany: jest.fn().mockResolvedValue([{ id: 9n, inboundNo: 'RV-9', warehouseCode: 'JHB', status: 'receiving' }]), count: jest.fn().mockResolvedValue(6001) } }
    expect(await listInboundWorkOrders(db as any, { warehouseCode: ' JHB ', page: '26', pageSize: '200' })).toEqual({ items: [{ id: 9, inboundNo: 'RV-9', warehouseCode: 'JHB', status: 'receiving', readOnly: false }], total: 6001, page: 26, pageSize: 200 })
    const where = { warehouseCode: 'JHB', status: { in: ['arrived', 'receiving', 'pending_putaway', 'exception'] } }
    expect(db.inboundOrder.count).toHaveBeenCalledWith({ where })
    expect(db.inboundOrder.findMany).toHaveBeenCalledWith({ where, select: { id: true, inboundNo: true, warehouseCode: true, status: true }, orderBy: { id: 'desc' }, skip: 5000, take: 200 })
  })
  it.each([undefined, '', ' ', false, ['JHB'], 'a'.repeat(31)])('无效仓库%p不发出全仓查询', async warehouseCode => {
    const db = { inboundOrder: { findMany: jest.fn(), count: jest.fn() } }
    await expect(listInboundWorkOrders(db as any, { warehouseCode })).rejects.toThrow('请选择有效')
    expect(db.inboundOrder.findMany).not.toHaveBeenCalled();expect(db.inboundOrder.count).not.toHaveBeenCalled()
  })
})
