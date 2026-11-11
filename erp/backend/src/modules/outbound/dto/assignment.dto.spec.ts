import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { AssignPickerDto } from './pick-outbound.dto'
describe('原分配资料边界',()=>{
  const body={clientRequestId:'original-assignment',ids:[63],pickerId:59,expectedOrders:[{id:63,status:'pending_pick',pickerId:null}]}
  it('接受未分配和已有人员的原状态',async()=>{
    expect(await validate(plainToInstance(AssignPickerDto,body))).toHaveLength(0)
    expect(await validate(plainToInstance(AssignPickerDto,{...body,expectedOrders:[{id:63,status:'picking',pickerId:59}]}))).toHaveLength(0)
  })
  it.each([{clientRequestId:undefined},{clientRequestId:' '},{expectedOrders:undefined},{expectedOrders:[]},{expectedOrders:[{id:63,status:'shipped',pickerId:59}]},{pickerId:0}])('旧或无法核对的请求不能提交 %p',async patch=>{
    expect((await validate(plainToInstance(AssignPickerDto,{...body,...patch}))).length).toBeGreaterThan(0)
  })
})
