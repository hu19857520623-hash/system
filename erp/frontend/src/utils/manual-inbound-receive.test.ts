import { describe, it, expect, vi } from 'vitest'
import { receiveInboundManually, recordedReceivedCartonCount } from './manual-inbound-receive'

const input = { count: 2, differenceReason: '', clientRequestId: 'manual-1' }
function fixture(status = 'pending_receipt') {
  const api = {
    detail: vi.fn().mockResolvedValue({ id: 1, inboundNo: 'RV-1', warehouseCode: 'WMS-JHB-01', status, cartons: [{ status: 'pending' }, { status: 'pending' }] }),
    arrivalScan: vi.fn().mockResolvedValue({}),
    recordReceivedCartonCount: vi.fn().mockResolvedValue({}),
  }
  return api
}

describe('manual inbound receiving', () => {
  it.each([0, null, undefined, -1, 1.5])('未登记的实收箱数%s显示待填写，不能被输入框下限显示为1', count => {
    expect(recordedReceivedCartonCount({ receivedCartonCount: count })).toBeNull()
  })
  it('已有实际箱数可以回填，不使用申报箱数代替实际', () => {
    expect(recordedReceivedCartonCount({ receivedCartonCount: 2 })).toBe(2)
    expect(recordedReceivedCartonCount({})).toBeNull()
  })
  it('confirms arrival before recording count, retaining the request identity', async () => {
    const api = fixture()
    await receiveInboundManually(api, 1, input)
    expect(api.arrivalScan).toHaveBeenCalledWith({ scanCode: 'RV-1', warehouseCode: 'WMS-JHB-01' })
    expect(api.arrivalScan.mock.invocationCallOrder[0]).toBeLessThan(api.recordReceivedCartonCount.mock.invocationCallOrder[0])
    expect(api.recordReceivedCartonCount).toHaveBeenCalledWith(1, { receivedCartonCount: 2, differenceReason: undefined, clientRequestId: 'manual-1' })
  })
  it('resumes after arrival without repeating it', async () => {
    const api = fixture('arrived')
    await receiveInboundManually(api, 1, input)
    expect(api.arrivalScan).not.toHaveBeenCalled()
    expect(api.recordReceivedCartonCount).toHaveBeenCalledOnce()
  })
  it('requires a difference reason before making any changes', async () => {
    const api = fixture()
    await expect(receiveInboundManually(api, 1, { ...input, count: 1 })).rejects.toThrow('差异原因')
    expect(api.arrivalScan).not.toHaveBeenCalled()
    expect(api.recordReceivedCartonCount).not.toHaveBeenCalled()
    await receiveInboundManually(api, 1, { ...input, count: 1, differenceReason: '少一箱' })
    expect(api.recordReceivedCartonCount).toHaveBeenCalledOnce()
  })
  it('rejects completed orders and invalid quantities', async () => {
    const api = fixture('completed')
    await expect(receiveInboundManually(api, 1, input)).rejects.toThrow('不可手动收货')
    await expect(receiveInboundManually(api, 1, { ...input, count: 1.5 })).rejects.toThrow('整数')
    expect(api.arrivalScan).not.toHaveBeenCalled()
    expect(api.recordReceivedCartonCount).not.toHaveBeenCalled()
  })
  it('does not register receipt when arrival fails', async () => {
    const api = fixture()
    api.arrivalScan.mockRejectedValue(new Error('仓库不匹配'))
    await expect(receiveInboundManually(api, 1, input)).rejects.toThrow('仓库不匹配')
    expect(api.recordReceivedCartonCount).not.toHaveBeenCalled()
  })
  it('replays the original confirmed count even if later scans have increased the current count', async () => {
    const api = fixture('receiving')
    api.detail.mockResolvedValue({ status: 'receiving', cartons: [{ status: 'received' }, { status: 'received' }] } as any)
    await receiveInboundManually(api, 1, { count: 1, differenceReason: '原短收原因', clientRequestId: 'original', replay: true })
    expect(api.recordReceivedCartonCount).toHaveBeenCalledWith(1, { receivedCartonCount: 1, differenceReason: '原短收原因', clientRequestId: 'original' })
    expect(api.arrivalScan).not.toHaveBeenCalled()
  })
})
