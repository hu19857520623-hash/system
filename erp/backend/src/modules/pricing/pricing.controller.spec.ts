import { ConflictException } from '@nestjs/common'
import { PricingController } from './pricing.controller'
describe('legacy freight write boundary',()=>{
 it('directs old callers to shipment costs without invoking the pricing service',()=>{
  const untouched=new Proxy({}, {get(){throw Error('旧费用入口不得读取或写入商品')}})
  const controller=new PricingController(untouched as any,{} as any)
  expect(()=>controller.freightCallback()).toThrow(ConflictException)
  expect(()=>controller.freightCallback()).toThrow('发运海外仓')
 })
})


describe('catalog request protocol boundary',()=>{
 it('rejects legacy writes including the PUT alias before accessing service',()=>{
  const untouched=new Proxy({}, {get(){throw Error('旧入口不得写入货盘')}})
  const controller=new PricingController(untouched as any,{} as any)
  for(const call of [()=>controller.confirm(1,{},'管理员',7),()=>controller.syncOms(1,'管理员',{},7),()=>controller.setShareStatus(1,{status:'stopped'},'管理员',7),()=>controller.update(1,{},7)]){
   expect(call).toThrow(ConflictException)
   expect(call).toThrow('原货盘操作核对入口')
  }
 })
})
