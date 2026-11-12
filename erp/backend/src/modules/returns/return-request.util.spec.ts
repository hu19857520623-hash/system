import { classifyReturnRequest, returnRequestFingerprint, returnRequestRefusal } from './return-request.util'

describe('return request recovery', () => {
  const fingerprint = returnRequestFingerprint({ receivedQty: 2, receivedCartonCount: 1, remark: '' })

  it('同一收货内容可重放，改数量不能重放，结束后不能再入账', () => {
    expect(classifyReturnRequest([], 'receive', 'req-1', fingerprint)).toBe('proceed')
    expect(classifyReturnRequest([
      { action: 'receive', detail: { clientRequestId: 'req-1', requestFingerprint: fingerprint } },
    ], 'receive', 'req-1', fingerprint)).toBe('replay')
    expect(classifyReturnRequest([
      { action: 'receive', detail: { clientRequestId: 'req-1', requestFingerprint: 'other' } },
    ], 'receive', 'req-1', fingerprint)).toBe('mismatch')
    expect(classifyReturnRequest([
      { action: 'return_request_close', detail: { clientRequestId: 'req-1', businessAction: 'receive', requestFingerprint: fingerprint } },
    ], 'receive', 'req-1', returnRequestFingerprint({ receivedQty: 9, receivedCartonCount: 1, remark: '' }))).toBe('closed')
    expect(returnRequestRefusal('mismatch', '收货')).toContain('不要修改后重复提交')
    expect(returnRequestRefusal('closed', '收货')).toContain('已结束')
    expect(returnRequestRefusal('closed', '收货')).not.toContain('不要修改后')
  })

  it('没有请求标识时保持原有非幂等路径', () => {
    expect(classifyReturnRequest([
      { action: 'receive', detail: { clientRequestId: 'req-1', requestFingerprint: fingerprint } },
    ], 'receive', '', fingerprint)).toBe('proceed')
  })
})
