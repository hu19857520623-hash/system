import { InboundService } from './inbound.service'

describe('catalog inbound binding', () => {
  const row = { id: 11n, inboundNo: 'RV-260101-0001', warehouseCode: 'ZA01', sourceWarehouseCode: 'CN01', status: 'pending_receipt', items: [{ sku: 'TKL-719110' }] }
  function fixture(order: any = row) {
    const prisma = { inboundOrder: { findFirst: jest.fn().mockResolvedValue(order) } }
    const service = new InboundService(prisma as any, null as any, null as any, null as any, null as any, null as any)
    const arrival = jest.spyOn(service, 'arrivalScan').mockResolvedValue({} as any)
    const detail = jest.spyOn(service, 'detail').mockResolvedValue({ ...row, status: 'arrived' } as any)
    return { service, prisma, arrival, detail }
  }
  const input = { scanCode: row.inboundNo, warehouseCode: 'ZA01' }
  it('checks exact order number and warehouse before arriving and returning count details', async () => {
    const { service, prisma, arrival, detail } = fixture()
    await expect(service.bindCatalogInbound(input, 7)).resolves.toMatchObject({ status: 'arrived' })
    expect(prisma.inboundOrder.findFirst).toHaveBeenCalledWith({ where: { inboundNo: input.scanCode, warehouseCode: 'ZA01' }, include: { items: true } })
    expect(arrival).toHaveBeenCalledWith(input, 7)
    expect(detail).toHaveBeenCalledWith(11)
  })
  it.each(['arrived', 'receiving', 'pending_putaway'])('resumes %s without repeating arrival', async status => {
    const { service, arrival, detail } = fixture({ ...row, status })
    detail.mockResolvedValue({ ...row, status } as any)
    await expect(service.bindCatalogInbound(input)).resolves.toMatchObject({ status })
    expect(arrival).not.toHaveBeenCalled()
  })
  it.each(['completed', 'confirmed', 'cancelled', 'exception'])('rejects %s without mutation', async status => {
    const { service, arrival, detail } = fixture({ ...row, status })
    await expect(service.bindCatalogInbound(input)).rejects.toThrow('不可绑定')
    expect(arrival).not.toHaveBeenCalled()
    expect(detail).not.toHaveBeenCalled()
  })
  it('rejects customer orders before performing arrival', async () => {
    const { service, arrival } = fixture({ ...row, omsCustomerCode: 'TKL0001' })
    await expect(service.bindCatalogInbound(input)).rejects.toThrow('只接受 ERP 货盘')
    expect(arrival).not.toHaveBeenCalled()
  })
  it('rejects missing warehouse and unmatched orders', async () => {
    const { service, prisma, arrival } = fixture(null)
    await expect(service.bindCatalogInbound({ ...input, warehouseCode: '' })).rejects.toThrow('选择作业仓库')
    expect(prisma.inboundOrder.findFirst).not.toHaveBeenCalled()
    await expect(service.bindCatalogInbound(input)).rejects.toThrow('未找到当前仓库')
    expect(arrival).not.toHaveBeenCalled()
  })
})
