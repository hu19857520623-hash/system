import { describe, expect, it } from 'vitest'
import { clearShipmentAttempt, readShipmentAttempt, saveShipmentAttempt, type ShipmentAttempt } from './erpShipmentAttempt'
function storage() {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
}
const attempt = (id = 'same-id'): ShipmentAttempt => ({ payload: { clientRequestId: id, items: [{ expectedQty: 2 }] }, form: { lines: [{ expectedQty: 2 }] }, draftNo: 'DRAFT' })
describe('发运未知结果恢复', () => {
  it('独立保存原数量、草稿与操作标识，刷新后重放原请求', () => {
    const port = storage(), original = attempt(); saveShipmentAttempt(port, 1, original)
    original.payload.items[0].expectedQty = 99
    expect(readShipmentAttempt(port, 1)).toMatchObject({ payload: { clientRequestId: 'same-id', items: [{ expectedQty: 2 }] }, draftNo: 'DRAFT' })
  })
  it('尚未核对时阻止另一个标签页覆盖原操作', () => {
    const port = storage(); saveShipmentAttempt(port, 1, attempt())
    expect(() => saveShipmentAttempt(port, 1, attempt('new-id'))).toThrow('原操作重试')
    expect(readShipmentAttempt(port, 1)?.payload.clientRequestId).toBe('same-id')
  })
  it('按用户隔离，核对成功只清除当前用户', () => {
    const port = storage(); saveShipmentAttempt(port, 1, attempt()); saveShipmentAttempt(port, 2, attempt()); clearShipmentAttempt(port, 1, readShipmentAttempt(port, 1)!)
    expect(readShipmentAttempt(port, 1)).toBeNull(); expect(readShipmentAttempt(port, 2)).not.toBeNull()
  })
  it('浏览器存储不可写时阻止首次提交', () => {
    const port = storage(); port.setItem = () => { throw new Error('QuotaExceededError') }
    expect(() => saveShipmentAttempt(port, 1, attempt())).toThrow('本次尚未提交')
  })
  it('损坏的历史信息不静默丢弃并新建发运单', () => {
    const port = storage(); port.setItem('erp:shipment-attempt:1', '{bad')
    expect(() => readShipmentAttempt(port, 1)).toThrow('核对信息无法读取')
    expect(() => saveShipmentAttempt(port, 1, attempt())).toThrow('核对信息无法读取')
  })
  it('同编号不能替换原内容，变化后的原记录不能被旧回调清除',()=>{
    const port=storage(),original=attempt();saveShipmentAttempt(port,1,original)
    const changed={...original,form:{lines:[]},snapshot:{changed:true}}
    expect(()=>saveShipmentAttempt(port,1,changed)).toThrow()
    port.setItem(`erp:shipment-attempt:1`,JSON.stringify(changed))
    expect(()=>clearShipmentAttempt(port,1,original)).toThrow('记录已变化');expect(readShipmentAttempt(port,1)).not.toBeNull()
  })

})
