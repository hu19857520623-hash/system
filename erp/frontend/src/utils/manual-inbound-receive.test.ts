import { describe, it, expect, vi } from 'vitest'
import { receiveInboundManually } from './manual-inbound-receive'

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
})
