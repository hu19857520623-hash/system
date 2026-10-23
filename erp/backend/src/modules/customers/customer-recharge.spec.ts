import { creditCustomer } from './customer-recharge.util'
import { CustomersService } from './customers.service'
import { notifyOms } from '../../common/oms-notify.util'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { RechargeCustomerDto } from './dto/customer.dto'
jest.mock('../../common/oms-notify.util', () => ({ notifyOms: jest.fn() }))
const data = { rechargeNo: 'AUDIT-RC-001', amount: 5, paymentMethod: 'bank', remark: '隔离测试' }
function environment(existing: any = null) {
  let balance = 10
  const tx = { $queryRaw: jest.fn().mockResolvedValue([]), customer: { findUnique: jest.fn(async () => ({ id: 1n, customerCode: 'TKL9001', balance })), update: jest.fn(async ({ data: payload }) => { balance += Number(payload.balance.increment) }) }, customerRecharge: { findUnique: jest.fn().mockResolvedValue(existing), create: jest.fn(async ({ data: payload }) => ({ ...payload, id: 2n, createdAt: new Date() })) } }
  const prisma = { $transaction: jest.fn((fn: any) => fn(tx)) }
  return { tx, prisma }
}
describe('充值原单与余额事务', () => {
  it('锁定客户后创建确认记录并原子增加余额', async () => {
    const { tx, prisma } = environment()
    expect(await creditCustomer(prisma, 1, data, 7)).toMatchObject({ balance: 15, duplicate: false, record: { amount: 5 } })
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.customer.findUnique.mock.invocationCallOrder[0])
    expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: 1n }, data: { balance: { increment: '5.00' } } })
  })
  it('同原单返回当前余额且不新增充值', async () => {
    const { tx, prisma } = environment({ ...data, id: 2n, customerId: 1n, status: 'confirmed' })
    expect(await creditCustomer(prisma, 1, data)).toMatchObject({ balance: 10, duplicate: true })
    expect(tx.customerRecharge.create).not.toHaveBeenCalled();expect(tx.customer.update).not.toHaveBeenCalled()
  })
  it.each([{ customerId: 2n }, { amount: 6 }, { paymentMethod: 'cash' }, { remark: '改动' }, { status: 'pending' }])('拒绝原单内容变化 %p', async change => {
    const { tx, prisma } = environment({ ...data, customerId: 1n, status: 'confirmed', ...change })
    await expect(creditCustomer(prisma, 1, data)).rejects.toThrow('原充值单号')
    expect(tx.customer.update).not.toHaveBeenCalled()
  })
  it.each([true, '5', 0, -1, 0.001, Infinity, NaN])('拒绝非法金额 %p', async amount => {
    const { prisma } = environment();await expect(creditCustomer(prisma, 1, { ...data, amount })).rejects.toThrow();expect(prisma.$transaction).not.toHaveBeenCalled()
  })
  it.each(['', 'x'.repeat(31), '单号'])('单号不符合数据库范围时提前拒绝 %s', async rechargeNo => {
    const { prisma } = environment();await expect(creditCustomer(prisma, 1, { ...data, rechargeNo })).rejects.toThrow('原充值单号');expect(prisma.$transaction).not.toHaveBeenCalled()
  })
  it('充值记录写入失败不继续增加余额', async () => {
    const { prisma, tx } = environment();tx.customerRecharge.create.mockRejectedValue(new Error('fault'))
    await expect(creditCustomer(prisma, 1, data)).rejects.toThrow('fault');expect(tx.customer.update).not.toHaveBeenCalled()
  })
  it('跨客户单号唯一冲突转为中文核对提示', async () => {
    const { prisma, tx } = environment();tx.customerRecharge.create.mockRejectedValue({code:'P2002'})
    await expect(creditCustomer(prisma, 1, data)).rejects.toThrow('充值单号已被使用')
  })
  it('通知失败返回已到账待同步，原单重试不重复入账', async () => {
    const { prisma, tx } = environment(), service = new CustomersService(prisma as any, {} as any)
    ;(notifyOms as jest.Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    expect(await service.recharge(1, data, 7)).toMatchObject({ balance: 15, syncPending: true })
    tx.customerRecharge.findUnique.mockResolvedValue({ ...data, id: 2n, customerId: 1n, status: 'confirmed' })
    expect(await service.recharge(1, data, 7)).toMatchObject({ balance: 15, duplicate: true, syncPending: false })
    expect(tx.customer.update).toHaveBeenCalledTimes(1)
  })
  it.each([true, '5', 0.001])('DTO 不将非法输入转换为可入账数字 %p', async amount => {
    expect((await validate(plainToInstance(RechargeCustomerDto, { ...data, amount }))).length).toBeGreaterThan(0)
  })
})
