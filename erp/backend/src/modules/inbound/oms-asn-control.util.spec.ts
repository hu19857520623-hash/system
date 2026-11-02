import { assertOmsAsnVersion, omsAsnControl, omsAsnVersion, previousOmsAsnControl } from './oms-asn-control.util'

const order = { id: 1n, inboundNo: 'ASN-ONE', status: 'pending_receipt', updatedAt: new Date('2026-11-02T00:00:00Z'), remark: '测试', warehouseCode: 'WMS-JHB-01', trackingNo: null, items: [{ id: 1n, sku: 'A', expectedQty: 1 }] }
const body = { clientRequestId: '4b9f78d8-4688-47a3-a46d-222222222222', customerCode: 'TKL9069', expectedVersion: omsAsnVersion(order), items: [{ sku: 'A', qty: 1 }] }

describe('客户入库版本及持久化回执', () => {
  it('相同数据换了属性顺序仍为原请求，修改内容、单号或操作类型都改变回执', () => {
    const original = omsAsnControl('ASN-ONE', 'update', body)
    expect(omsAsnControl('ASN-ONE', 'update', { ...body, items: [{ qty: 1, sku: 'A' }] })).toEqual(original)
    expect(omsAsnControl('ASN-TWO', 'update', body).requestFingerprint).not.toBe(original.requestFingerprint)
    expect(omsAsnControl('ASN-ONE', 'reactivate', body).requestFingerprint).not.toBe(original.requestFingerprint)
    expect(omsAsnControl('ASN-ONE', 'update', { ...body, items: [{ sku: 'A', qty: 2 }] }).requestFingerprint).not.toBe(original.requestFingerprint)
  })

  it('明细重建后即使时间戳及数量相同也使旧版本失效', () => {
    expect(() => assertOmsAsnVersion({ ...order, items: [{ ...order.items[0], id: 2n }] }, body.expectedVersion)).toThrow('已被其他操作更新')
    expect(() => assertOmsAsnVersion(order, body.expectedVersion)).not.toThrow()
  })

  it('回执按客户和操作标识查询，原请求可重放，改变内容则拒绝', async () => {
    const request = omsAsnControl('ASN-ONE', 'reactivate', body)
    const tx: any = { operationLog: { findFirst: jest.fn(async () => ({ targetId: 'ASN-ONE', detail: request })) } }
    expect(await previousOmsAsnControl(tx, 'TKL9069', 'ASN-ONE', request)).toBe(true)
    expect(tx.operationLog.findFirst.mock.calls[0][0].where.AND).toEqual([{ detail: { path: '$.customerCode', equals: 'TKL9069' } }, { detail: { path: '$.clientRequestId', equals: body.clientRequestId } }])
    await expect(previousOmsAsnControl(tx, 'TKL9069', 'ASN-ONE', omsAsnControl('ASN-ONE', 'update', body))).rejects.toThrow('不要修改后重试')
  })

  it('没有合法操作标识或原版本时拒绝创建新写入', () => {
    expect(() => omsAsnControl('ASN-ONE', 'update', { ...body, clientRequestId: '' })).toThrow('操作标识')
    expect(() => omsAsnControl('ASN-ONE', 'update', { ...body, expectedVersion: '' })).toThrow('原单版本')
  })
})
