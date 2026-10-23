import { InboundFeeService } from './inbound-fee.service'

function fixture() {
  const prisma = { customer: { findUnique: jest.fn().mockResolvedValue({ id: 260n }) }, inboundFeeRule: { findMany: jest.fn().mockResolvedValue([{ id: 1n, customerId: 260n, warehouseCode: 'WMS-JHB-01', qcUnitPrice: 0.25, measureUnitPrice: 0.5, labelUnitPrice: 0, putawayUnitPrice: 0.75, enabled: true, effectiveFrom: null, effectiveTo: null }]) } }
  const billing = { createCharge: jest.fn().mockResolvedValue({ id: 1, ok: true }), pushCustomerBillingToOms: jest.fn().mockResolvedValue(true) }
  const service = new InboundFeeService(prisma as any, billing as any)
  const order = { inboundNo: 'RV-OWNED', warehouseCode: 'WMS-JHB-01', omsCustomerCode: 'TKL9001' }
  return { service, prisma, billing, order }
}
describe('入库费用记录与OMS账单通知的恢复', () => {
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => undefined))
  afterEach(() => jest.restoreAllMocks())
  it('等待实际账单同步，失败时不把作业费用报告为全部完成', async () => {
    const f = fixture();f.billing.pushCustomerBillingToOms.mockResolvedValue(false)
    await expect(f.service.recordOperation(f.order, 'qc', 3, true)).rejects.toThrow('费用已记录，OMS账单同步待核对')
    expect(f.billing.createCharge).toHaveBeenCalledWith(expect.objectContaining({ amount: 0.75, quantity: 3, idempotencyKey: 'inbound:RV-OWNED:inbound_qc' }), undefined, false)
    expect(f.billing.pushCustomerBillingToOms).toHaveBeenCalledWith(260)
  })
  it('原费用已存在时仍重新同步，重用原计费标识与金额', async () => {
    const f = fixture();f.billing.createCharge.mockResolvedValueOnce({ id: 1, ok: true }).mockResolvedValueOnce({ id: 1, ok: true, duplicate: true } as any)
    f.billing.pushCustomerBillingToOms.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    await expect(f.service.recordOperation(f.order, 'putaway', 3, true)).rejects.toThrow('同步待核对')
    await expect(f.service.recordOperation(f.order, 'putaway', 3, true)).resolves.toMatchObject({ duplicate: true })
    expect(f.billing.createCharge.mock.calls[0]).toEqual(f.billing.createCharge.mock.calls[1]);expect(f.billing.pushCustomerBillingToOms).toHaveBeenCalledTimes(2)
  })
  it('费用写入失败时不发送不存在的费用，不丢失原错误', async () => {
    const f = fixture();f.billing.createCharge.mockRejectedValue(new Error('写入费用失败'))
    await expect(f.service.recordOperation(f.order, 'measure', 1, true)).rejects.toThrow('写入费用失败')
    expect(f.billing.pushCustomerBillingToOms).not.toHaveBeenCalled()
  })
  it('保留非严格调用的既有后台通知模式', async () => {
    const f = fixture()
    await expect(f.service.recordOperation(f.order, 'qc', 3)).resolves.toMatchObject({ ok: true })
    expect(f.billing.createCharge).toHaveBeenCalledWith(expect.any(Object), undefined, true)
    expect(f.billing.pushCustomerBillingToOms).not.toHaveBeenCalled()
  })
  it.each(['customer', 'rule', 'zero'] as const)('没有可计费用%s时不虚构费用或同步失败', async reason => {
    const f = fixture()
    if (reason === 'customer') f.prisma.customer.findUnique.mockResolvedValue(null as any)
    if (reason === 'rule') f.prisma.inboundFeeRule.findMany.mockResolvedValue([])
    await expect(f.service.recordOperation(f.order, 'qc', reason === 'zero' ? 0 : 3, true)).resolves.toBeNull()
    expect(f.billing.createCharge).not.toHaveBeenCalled();expect(f.billing.pushCustomerBillingToOms).not.toHaveBeenCalled()
  })
})
