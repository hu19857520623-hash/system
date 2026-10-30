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
