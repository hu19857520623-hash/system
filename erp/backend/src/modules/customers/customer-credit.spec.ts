import { setCustomerCredit } from './customer-credit.util'
import { customerCredit } from '../../common/customer-credit.util'
import { creditCustomer } from './customer-recharge.util'

function fixture(balance = '-30.00', creditLimit = '50.00') {
  let state: any = {customer:{id:1n,customerCode:'TKL9001',balance,creditLimit},logs:[],recharges:[]}
  let queue = Promise.resolve(), fail = false
  const prisma: any = {$transaction:(work:any)=>{
    const result=queue.then(async()=>{
      const draft=structuredClone(state),tx:any={
        $queryRaw:async()=>[],
        customer:{findUnique:async()=>draft.customer,update:async({data}:any)=>{if(data.balance)draft.customer.balance=(Number(draft.customer.balance)+Number(data.balance.increment)).toFixed(2);else draft.customer.creditLimit=String(data.creditLimit);return draft.customer}},
        operationLog:{create:async({data}:any)=>{if(fail)throw Error('audit failed');draft.logs.push(data)}},
        customerRecharge:{findUnique:async({where}:any)=>draft.recharges.find((r:any)=>r.rechargeNo===where.rechargeNo)||null,create:async({data}:any)=>{const r={id:1n,...data};draft.recharges.push(r);return r}}
      };const response=await work(tx);state=draft;return response
    });queue=result.then(()=>undefined,()=>undefined);return result
  }}
  return {prisma,state:()=>state,fail:()=>{fail=true}}
}
const data={creditLimit:100,expectedCreditLimit:50,remark:'提高客户额度'}
describe('客户信用额度及还款',()=>{
  it('调整额度保留余额和充值总额，审计包含前后额度与操作人',async()=>{
    const f=fixture();expect(await setCustomerCredit(f.prisma,1,data,7)).toMatchObject({balance:-30,creditLimit:100,usedCredit:30,remainingCredit:70,availableBalance:70})
    expect(f.state().customer.balance).toBe('-30.00');expect(f.state().recharges).toHaveLength(0)
    expect(f.state().logs[0]).toMatchObject({operatorId:7n,detail:{before:50,after:100,remark:data.remark}})
  })
  it.each([29.99,0])('不能将额度调至当前欠款以下 %s',async creditLimit=>{
    const f=fixture(),before=structuredClone(f.state());await expect(setCustomerCredit(f.prisma,1,{...data,creditLimit},7)).rejects.toThrow('不能低于当前欠款');expect(f.state()).toEqual(before)
  })
  it('旧额度请求和并发调整不会覆盖新额度',async()=>{
    const f=fixture(),results=await Promise.allSettled([setCustomerCredit(f.prisma,1,data,7),setCustomerCredit(f.prisma,1,{...data,creditLimit:200},8)])
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(f.state().logs).toHaveLength(1)
  })
  it('审计失败时额度一起回滚',async()=>{
    const f=fixture(),before=structuredClone(f.state());f.fail();await expect(setCustomerCredit(f.prisma,1,data,7)).rejects.toThrow('audit failed');expect(f.state()).toEqual(before)
  })
  it.each([-1,0.001,NaN,Infinity,'100',true,1000000000000])('拒绝非法额度 %p',async creditLimit=>{
    const f=fixture();await expect(setCustomerCredit(f.prisma,1,{...data,creditLimit},7)).rejects.toThrow();expect(f.state().logs).toHaveLength(0)
  })
  it('部分充值还款、超额还款和原单重试都不改信用总额',async()=>{
    const f=fixture()
    await creditCustomer(f.prisma,1,{rechargeNo:'RC-1',amount:10},7)
    expect(customerCredit(f.state().customer)).toMatchObject({usedCredit:20,availableBalance:30,creditLimit:50})
    await creditCustomer(f.prisma,1,{rechargeNo:'RC-1',amount:10},7)
    expect(f.state().customer.balance).toBe('-20.00')
    await creditCustomer(f.prisma,1,{rechargeNo:'RC-2',amount:25},7)
    expect(customerCredit(f.state().customer)).toMatchObject({usedCredit:0,remainingCredit:50,availableBalance:55})
    expect(f.state().customer.balance).toBe('5.00')
  })
})
