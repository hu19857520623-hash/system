import 'reflect-metadata'
import { BillingService } from './billing.service'
import { confirmBillingOrder, generateBillingOrders, createManualBillingCharge } from './billing-workflow.util'

jest.mock('./billing-workflow.util', () => ({
  confirmBillingOrder: jest.fn(), generateBillingOrders: jest.fn(), createManualBillingCharge: jest.fn(),
}))

describe('账务提交后通知恢复', () => {
  beforeEach(() => jest.clearAllMocks())
  it.each(['confirm', 'generate', 'manual'] as const)('%s 已保存但通知失败时保留原请求，重试发送最新余额', async kind => {
    const service = new BillingService({} as any)
    const saved = kind === 'generate' ? { bills: [{ customerId: 1 }], count: 1 }
      : { customerId: 1, ...(kind === 'confirm' ? { status: 'paid', billingNo: 'BL-1', totalAmount: 52.4, deductedAmount: 10 } : { chargeNo: 'CHG-1' }) }
    const core = (kind === 'confirm' ? confirmBillingOrder : kind === 'generate' ? generateBillingOrders : createManualBillingCharge) as jest.Mock
    core.mockResolvedValueOnce(saved).mockResolvedValueOnce({ ...saved, duplicate: true })
    const notify = jest.spyOn(service, 'pushCustomerBillingToOms').mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const input: any = { clientRequestId: 'original-request', expectedVersion: 'original-version' }
    const run = () => kind === 'confirm' ? service.confirm(1, input, 2) : kind === 'generate' ? service.generateFromCharges(input, 2) : service.createManualCharge(input, 2)
    expect(await run()).toMatchObject({ ...saved, syncPending: true, warning: expect.stringContaining('原操作重试') })
    expect(await run()).toMatchObject({ duplicate: true, syncPending: false })
    expect(notify).toHaveBeenCalledTimes(2)
    expect(core.mock.calls[0].slice(0, kind === 'confirm' ? 4 : 3)).toEqual(core.mock.calls[1].slice(0, kind === 'confirm' ? 4 : 3))
  })
  it('核心事务失败时不发送已支付通知', async () => {
    const service = new BillingService({} as any)
    ;(confirmBillingOrder as jest.Mock).mockRejectedValueOnce(new Error('余额不足'))
    const notify = jest.spyOn(service, 'pushCustomerBillingToOms')
    await expect(service.confirm(1, {} as any, 2)).rejects.toThrow('余额不足')
    expect(notify).not.toHaveBeenCalled()
  })
})
