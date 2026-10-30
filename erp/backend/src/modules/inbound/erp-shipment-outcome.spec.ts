import {readErpShipmentOutcome} from './erp-shipment-outcome.util'
const requestId='4d603398-3f55-4c21-b6bd-1a6d44b41c35'
function fixture(){return {operationLog:{findFirst:jest.fn().mockResolvedValue({detail:{inboundId:77},targetId:'RV-ORIGINAL'})},inboundOrder:{findUnique:jest.fn().mockResolvedValue({id:77n,inboundNo:'RV-ORIGINAL',status:'pending_receipt'})}}}
describe('原发运结果只读核对',()=>{
 it('按原账号和编号读取，返回当前单号状态而不重放发运',async()=>{
  const db=fixture();expect(await readErpShipmentOutcome(db,requestId,51)).toMatchObject({status:'confirmed',inboundId:77,inboundNo:'RV-ORIGINAL',orderStatus:'pending_receipt'})
  expect(db.operationLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({operatorId:51n,action:'create',detail:{path:'$.clientRequestId',equals:requestId}})}))
 })
 it('已确认原单不存在时返回已删除，不把它当作未知可重发',async()=>{const db=fixture();db.inboundOrder.findUnique.mockResolvedValue(null);expect(await readErpShipmentOutcome(db,requestId,51)).toMatchObject({status:'deleted',inboundId:77,inboundNo:'RV-ORIGINAL'})})
 it('找不到本账号原记录只返回未知，不读取任何入库单',async()=>{const db=fixture();db.operationLog.findFirst.mockResolvedValue(null);expect(await readErpShipmentOutcome(db,requestId,52)).toEqual({requestId,status:'unknown'});expect(db.inboundOrder.findUnique).not.toHaveBeenCalled()})
 it('不完整关联或被替换的身份必须阻止放弃原请求',async()=>{const db=fixture();db.operationLog.findFirst.mockResolvedValueOnce({detail:{},targetId:'RV-ORIGINAL'});await expect(readErpShipmentOutcome(db,requestId,51)).rejects.toThrow('关联信息不完整');db.inboundOrder.findUnique.mockResolvedValueOnce({id:77n,inboundNo:'OTHER',status:'pending_receipt'});await expect(readErpShipmentOutcome(db,requestId,51)).rejects.toThrow('身份已变化')})
 it('无效账号或请求编号在读库之前中文拒绝',async()=>{const db=fixture();await expect(readErpShipmentOutcome(db,requestId,0)).rejects.toThrow('原账号');await expect(readErpShipmentOutcome(db,'bad',51)).rejects.toThrow('请求编号无效');expect(db.operationLog.findFirst).not.toHaveBeenCalled()})
})
