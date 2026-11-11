import {describe,it,expect} from 'vitest'
import {validateShipmentOutcome,copyDeletedShipmentForm} from './shipmentOutcome'
describe('原发运结果恢复',()=>{
 it('只能接受本次原编号和完整已删除/已确认身份',()=>{
  expect(validateShipmentOutcome('original',{requestId:'original',status:'deleted',inboundId:77,inboundNo:'RV-OLD'}).status).toBe('deleted')
  for(const bad of [{requestId:'other',status:'deleted',inboundId:77,inboundNo:'RV-OLD'},{requestId:'original',status:'deleted'},{requestId:'original',status:'confirmed',inboundId:-1,inboundNo:'RV-OLD'}])expect(()=>validateShipmentOutcome('original',bad)).toThrow('保留原请求')
 })
 it('未知结果保留核对路径，不能伪装成已删除',()=>{expect(validateShipmentOutcome('original',{requestId:'original',status:'unknown'})).toMatchObject({status:'unknown'});expect(()=>validateShipmentOutcome('original',{requestId:'original',status:'cancelled'})).toThrow()})
 it('复制保留数量和路线，清除历史单号/箱码和已失效附件，不污染原内容',()=>{
  const old={inboundNo:'RV-OLD',attachments:[{fileName:'old.pdf'}],cartons:[{boxCode:'OLD-BOX',items:[{sku:'SKU',qty:2}]}],lines:[{sku:'SKU',expectedQty:2}],logisticsWhCode:'LW'}
  const next=copyDeletedShipmentForm(old);expect(next).toMatchObject({inboundNo:'',attachments:[],cartons:[{boxCode:'',items:[{qty:2}]}],lines:[{expectedQty:2}],logisticsWhCode:'LW'});expect(old.inboundNo).toBe('RV-OLD');expect(old.attachments).toHaveLength(1)
 })
})
