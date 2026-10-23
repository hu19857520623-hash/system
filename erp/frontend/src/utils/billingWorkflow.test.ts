import { describe, expect, it, vi } from 'vitest'
import { readBillingAttempt, saveBillingAttempt, runBillingAttempt, loadAllBillingCharges, type BillingAttempt } from './billingWorkflow'
const storage = () => { const map = new Map<string, string>();return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) }, removeItem: (k: string) => { map.delete(k) } } }
const attempt = (kind: BillingAttempt['kind'] = 'confirm'): BillingAttempt => ({ kind, billId: 1, title: '核对原账单', payload: { clientRequestId: 'original-id', expectedVersion: 'a'.repeat(64) }, snapshot: { totalAmount: 42.4, toDeductAmount: 0 } })
describe('账单原操作恢复与完整导出', () => {
  it('按用户保留原金额、范围与版本，拒绝用修改后的请求覆盖', () => {
    const local = storage(), original = attempt();saveBillingAttempt(local, 1, original)
    expect(readBillingAttempt(local, 2)).toBeNull();expect(readBillingAttempt(local, 1)).toEqual(original)
    expect(() => saveBillingAttempt(local, 1, { ...original, payload: { ...original.payload, expectedVersion: 'b'.repeat(64) } })).toThrow('原账务操作')
    expect(() => saveBillingAttempt(local, 1, attempt('generate'))).toThrow('原账务操作')
  })
  it.each(['generate', 'confirm', 'manual-charge'] as const)('%s响应丢失后只用原请求重试', async kind => {
    const local = storage(), original = attempt(kind);saveBillingAttempt(local, 1, original)
    const call = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ duplicate: true })
    const api = { confirm: call, generate: call, createCharge: call }
    await expect(runBillingAttempt(api, local, 1, original)).rejects.toThrow('原请求已保留')
    expect(readBillingAttempt(local, 1)).toEqual(original)
    expect(await runBillingAttempt(api, local, 1, readBillingAttempt(local, 1)!)).toMatchObject({ completed: true, result: { duplicate: true } })
    expect(call.mock.calls[0]).toEqual(call.mock.calls[1]);expect(readBillingAttempt(local, 1)).toBeNull()
  })
  it('已保存但同步待核对时保留原操作，成功后才清除', async () => {
    const local = storage(), original = attempt();saveBillingAttempt(local, 1, original)
    const api = { confirm: vi.fn().mockResolvedValueOnce({ syncPending: true, warning: '账单与余额已保存，待同步' }).mockResolvedValueOnce({ duplicate: true }) }
    expect(await runBillingAttempt(api, local, 1, original)).toMatchObject({ completed: false })
    expect(readBillingAttempt(local, 1)).toEqual(original)
    expect(await runBillingAttempt(api, local, 1, original)).toMatchObject({ completed: true });expect(api.confirm.mock.calls[0]).toEqual(api.confirm.mock.calls[1])
  })
  it.each([401, 403, 408, 429, 500])('%s不丢弃原付款请求，并提供中文恢复说明', async status => {
    const local = storage(), original = attempt();saveBillingAttempt(local, 1, original)
    await expect(runBillingAttempt({ confirm: vi.fn().mockRejectedValue({ status, message: 'Forbidden' }) }, local, 1, original)).rejects.toThrow(/[\u4e00-\u9fff]/)
    expect(readBillingAttempt(local, 1)).toEqual(original)
  })
  it.each([400, 404, 409, 422])('%s明确拒绝后可重新读取费用与余额', async status => {
    const local = storage(), original = attempt();saveBillingAttempt(local, 1, original)
    await expect(runBillingAttempt({ confirm: vi.fn().mockRejectedValue({ status, message: '账单已变化' }) }, local, 1, original)).rejects.toThrow('重新核对最新费用和余额')
    expect(readBillingAttempt(local, 1)).toBeNull()
  })
  it('存储不可读/不可写均不冒险新建请求', () => {
    const local = storage();local.setItem('erp:billing-operation:1', '{bad')
    expect(() => readBillingAttempt(local, 1)).toThrow('核对信息无法读取')
    expect(() => saveBillingAttempt({ ...storage(), setItem: () => { throw new Error('QuotaExceeded') } }, 1, attempt())).toThrow('本次尚未提交')
  })
  it('旧操作结束不清除另一个标签后来保存的原请求', async () => {
    const local = storage(), original = attempt(), other = { ...attempt(), payload: { ...attempt().payload, clientRequestId: 'other' } };saveBillingAttempt(local, 1, other)
    await runBillingAttempt({ confirm: vi.fn().mockResolvedValue({ duplicate: true }) }, local, 1, original)
    expect(readBillingAttempt(local, 1)).toEqual(other)
  })
  it('导出全部读取超过200条的全部分页并冻结开始时筛选', async () => {
    const filters = { customerCode: 'TKL-1' }, api = { listCharges: vi.fn().mockImplementation(async ({ page }: any) => { filters.customerCode = 'CHANGED';return { total: 201, items: page === 1 ? Array.from({ length: 200 }, (_, i) => ({ id: i + 1 })) : [{ id: 201 }] } }) }
    expect(await loadAllBillingCharges(api, filters)).toHaveLength(201)
    expect(api.listCharges.mock.calls.map(call => call[0])).toEqual([{ customerCode: 'TKL-1', page: 1, pageSize: 200 }, { customerCode: 'TKL-1', page: 2, pageSize: 200 }])
  })
  it.each(['count', 'duplicate', 'empty'] as const)('导出过程中%s变化时拒绝伪装为完整导出', async mode => {
    const api = { listCharges: vi.fn().mockResolvedValueOnce({ total: 2, items: [{ id: 1 }] }).mockResolvedValueOnce({ total: mode === 'count' ? 3 : 2, items: mode === 'empty' ? [] : [{ id: mode === 'duplicate' ? 1 : 2 }] }) }
    await expect(loadAllBillingCharges(api, {})).rejects.toThrow(/[\u4e00-\u9fff]/)
  })
})
