import { describe, expect, it } from 'vitest'
import { clearShipmentMaintenance, readShipmentMaintenance, saveShipmentMaintenance, type ShipmentMaintenanceAttempt } from './shipmentMaintenanceAttempt'
function storage() { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } } }
const attempt = (): ShipmentMaintenanceAttempt => ({ kind: 'freight', inboundId: 1, inboundNo: 'RV-TEST', clear: false, payload: { clientRequestId: 'same-id', expectedVersion: 'old-version', totalAmount: 12 }, snapshot: { items: [] } })
describe('发运维护未知结果核对', () => {
  it('刷新恢复原始费用、版本和操作标识，当前表单修改不会污染原请求', () => {
    const port = storage(), original = attempt(); saveShipmentMaintenance(port, 1, original); original.payload.totalAmount = 99
    expect(readShipmentMaintenance(port, 1)?.payload).toEqual({ clientRequestId: 'same-id', expectedVersion: 'old-version', totalAmount: 12 })
  })
  it('未核对的补录不能被其他单或删除操作覆盖', () => {
    const port = storage(); saveShipmentMaintenance(port, 1, attempt())
    expect(() => saveShipmentMaintenance(port, 1, { ...attempt(), kind: 'delete' })).toThrow('上次发运维护操作待核对')
    expect(() => saveShipmentMaintenance(port, 1, { ...attempt(), inboundId: 2 })).toThrow('上次发运维护操作待核对')
  })
  it('删除核对信息保留原单快照，按用户隔离', () => {
    const port = storage(); saveShipmentMaintenance(port, 1, { ...attempt(), kind: 'delete', payload: undefined }); saveShipmentMaintenance(port, 2, attempt())
    expect(readShipmentMaintenance(port, 1)?.inboundNo).toBe('RV-TEST'); clearShipmentMaintenance(port, 1, readShipmentMaintenance(port, 1)!)
    expect(readShipmentMaintenance(port, 1)).toBeNull(); expect(readShipmentMaintenance(port, 2)).not.toBeNull()
  })
  it('存储不可写先阻止提交，损坏的核对信息不能静默清除', () => {
    const port = storage(); port.setItem('erp:shipment-maintenance:1', '{bad')
    expect(() => readShipmentMaintenance(port, 1)).toThrow('无法读取')
    expect(() => saveShipmentMaintenance(port, 1, attempt())).toThrow('无法读取')
    port.setItem = () => { throw new Error('QuotaExceededError') }
    expect(() => saveShipmentMaintenance(port, 2, attempt())).toThrow('本次尚未提交')
  })
  it('同编号不能替换原内容，变化后的原记录不能被旧回调清除',()=>{
    const port=storage(),original=attempt();saveShipmentMaintenance(port,1,original)
    const changed={...original,form:{lines:[]},snapshot:{changed:true}}
    expect(()=>saveShipmentMaintenance(port,1,changed)).toThrow()
    port.setItem(`erp:shipment-maintenance:1`,JSON.stringify(changed))
    expect(()=>clearShipmentMaintenance(port,1,original)).toThrow('记录已变化');expect(readShipmentMaintenance(port,1)).not.toBeNull()
  })

})
