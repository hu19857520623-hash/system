import { describe, it, expect, vi } from 'vitest'
import { newRechargeNo, readRecharge, runRecharge, saveRecharge, type RechargeAttempt } from '@erp/shared/recharge-workflow'
const storage = () => { const map = new Map<string, string>();return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) }, removeItem: (k: string) => { map.delete(k) } } }
const attempt: RechargeAttempt = { customerCode: 'TKL9001', rechargeNo: 'AUDIT-RC-1', amount: 5 }
const result = { record: {rechargeNo: attempt.rechargeNo, amount: 5}, customerCode: 'TKL9001', balance: 15 }
describe('充值原请求恢复', () => {
  it('生成的单号符合数据库30位限制且每笔不同', () => {
    const first = newRechargeNo();expect(first).toMatch(/^RC-[a-f0-9]{27}$/);expect(newRechargeNo()).not.toBe(first)
  })
  it('按原账号保存，拒绝修改待核对金额或单号', () => {
    const s = storage();saveRecharge(s, 'u1', attempt);expect(readRecharge(s, 'u2')).toBeNull()
    expect(() => saveRecharge(s, 'u1', {...attempt, amount: 6})).toThrow('原充值待核对')
  })
  it.each([401,403,409,500,0])('未知或需核对结果 %s 保留原单后精确重试', async status => {
    const s=storage(), api=vi.fn().mockRejectedValueOnce(Object.assign(new Error('error'),{status})).mockResolvedValueOnce(result)
    await expect(runRecharge(s,'u1',attempt,api)).rejects.toThrow('原单已保留')
    expect(readRecharge(s,'u1')).toEqual(attempt)
    expect((await runRecharge(s,'u1',readRecharge(s,'u1')!,api)).completed).toBe(true)
    expect(api.mock.calls[0]).toEqual(api.mock.calls[1]);expect(readRecharge(s,'u1')).toBeNull()
  })
  it('已到账同步失败仍保留原单', async () => {
    const s=storage();expect((await runRecharge(s,'u1',attempt,async()=>({...result,syncPending:true}))).completed).toBe(false);expect(readRecharge(s,'u1')).toEqual(attempt)
  })
  it.each([400,404,422])('明确未入账 %s 可纠正后继续', async status => {
    const s=storage();await expect(runRecharge(s,'u1',attempt,async()=>{throw {status}})).rejects.toThrow('本次未新增充值');expect(readRecharge(s,'u1')).toBeNull()
  })
  it.each([{customerCode:'OTHER'}, {record:{rechargeNo:'OTHER',amount:5}}, {balance:NaN}])('返回身份或结果不匹配时保留原单 %p', async change => {
    const s=storage();await expect(runRecharge(s,'u1',attempt,async()=>({...result,...change}))).rejects.toThrow('原单已保留');expect(readRecharge(s,'u1')).toEqual(attempt)
  })
  it('无法保存原单时不发送充值', async()=>{
    const s=storage(),api=vi.fn();s.setItem=()=>{throw Error('quota')}
    await expect(runRecharge(s,'u1',attempt,api)).rejects.toThrow('本次尚未提交');expect(api).not.toHaveBeenCalled()
  })
})
