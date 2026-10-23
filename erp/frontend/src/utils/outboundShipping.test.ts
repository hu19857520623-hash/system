import { describe, expect, it, vi } from 'vitest'
import { readShipAttempts, saveShipAttempt, runShipAttempt, type ShipAttempt } from './outboundShipping'
const attempt: ShipAttempt = { outboundId: 1, outboundNo: 'DO-TEST', order: { id: 1, status: 'packed' }, payload: { clientRequestId: 'original-id', trackingNo: 'TRACK', carrier: '', logisticsProduct: '' } }
function storage() { const values = new Map<string, string>();return { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } } }
describe('发运原请求与返回恢复', () => {
  it('按原账号保存，不能覆盖同单原请求', () => {
    const s = storage();saveShipAttempt(s, 1, attempt);expect(readShipAttempts(s, 2)).toEqual([])
    expect(() => saveShipAttempt(s, 1, { ...attempt, payload: { ...attempt.payload, trackingNo: 'OTHER' } })).toThrow('原发运请求')
    expect(readShipAttempts(s, 1)).toEqual([attempt])
  })
  it.each([401, 403, 429, 500, 503, undefined])('失败%s保留原请求，允许原账号恢复后重试', async status => {
    const s = storage(), api = { ship: vi.fn().mockRejectedValueOnce({ status, message: 'Forbidden' }).mockResolvedValue({ duplicate: true }) }
    saveShipAttempt(s, 1, attempt)
    await expect(runShipAttempt(api, s, 1, attempt)).rejects.toThrow(/原.*请求.*保留/)
    expect(readShipAttempts(s, 1)).toEqual([attempt])
    expect(await runShipAttempt(api, s, 1, attempt)).toMatchObject({ completed: true })
    expect(api.ship.mock.calls).toEqual([[1, attempt.payload], [1, attempt.payload]])
    expect(readShipAttempts(s, 1)).toEqual([])
  })
  it.each(['feePending', 'syncPending'])('%s时保留原操作并显示中文继续提示', async field => {
    const s = storage(), api = { ship: vi.fn().mockResolvedValue({ [field]: true }) };saveShipAttempt(s, 1, attempt)
    expect(await runShipAttempt(api, s, 1, attempt)).toMatchObject({ completed: false, message: expect.stringContaining('重试原操作') })
    expect(readShipAttempts(s, 1)).toEqual([attempt])
  })
  it.each([400, 404, 409, 422])('明确拒绝%s后可返回核对最新单据', async status => {
    const s = storage();saveShipAttempt(s, 1, attempt)
    await expect(runShipAttempt({ ship: vi.fn().mockRejectedValue({ status }) }, s, 1, attempt)).rejects.toThrow('返回列表核对')
    expect(readShipAttempts(s, 1)).toEqual([])
  })
  it('本机存储损坏或不可写时给中文提示，不覆盖未知原操作', () => {
    const s = storage();s.setItem('erp:outbound-shipping:1', '{broken')
    expect(() => readShipAttempts(s, 1)).toThrow('原发运操作信息无法读取')
    expect(() => saveShipAttempt({ ...storage(), setItem: () => { throw new Error('SecurityError') } }, 1, attempt)).toThrow('本次尚未提交')
  })
  it('成功回包不能清除另一笔同时建立的原请求', async () => {
    const s = storage();saveShipAttempt(s, 1, attempt)
    const other = { ...attempt, outboundId: 2, order: { id: 2 }, outboundNo: 'DO-2' };saveShipAttempt(s, 1, other)
    await runShipAttempt({ ship: vi.fn().mockResolvedValue({}) }, s, 1, attempt)
    expect(readShipAttempts(s, 1)).toEqual([other])
  })
})
