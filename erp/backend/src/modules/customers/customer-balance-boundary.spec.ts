import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { readFileSync } from 'node:fs'
import { CustomerProvisioningService } from './customer-provisioning.service'
import { CustomersService } from './customers.service'
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto'
jest.mock('node:fs', () => ({ ...jest.requireActual('node:fs'), readFileSync: jest.fn() }))
const initial = { customerCode: 'AUDIT-BOUNDARY', customerName: '隔离客户资料', contactPhone: '19900009001' }
describe('客户资料与资金台账边界', () => {
  it.each([1, -1, '0', true, false, NaN, Infinity])('开户拒绝从资料指定非零或非法余额 %p', async balance => {
    const prisma = { $transaction: jest.fn() }, service = new CustomerProvisioningService(prisma as any)
    const dto = plainToInstance(CreateCustomerDto, { ...initial, balance })
    expect((await validate(dto)).some(e => e.property === 'balance')).toBe(true)
    await expect(service.create(dto)).rejects.toThrow('新客户余额须为零')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
  it.each([0, 1, -1, '1', true, false, null, ''])('绕过DTO也不能从资料设置余额 %p', async balance => {
    const prisma = { $transaction: jest.fn() }, service = new CustomerProvisioningService(prisma as any)
    await expect(service.update(260, { balance } as any)).rejects.toThrow('客户资料不能修改余额')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
  it.each([0, 1, -1, '1', true, false])('DTO明确拒绝编辑余额 %p', async balance => {
    const errors = await validate(plainToInstance(UpdateCustomerDto, { balance }))
    expect(errors.find(e => e.property === 'balance')?.constraints?.isEmpty).toContain('客户资料不能修改余额')
  })
  it('正常新客户余额固定为零', async () => {
    const tx = { customer: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(async ({data}) => ({ id: 260n, ...data })) } }, prisma = { $transaction: jest.fn(async fn => fn(tx)) }
    const service = new CustomerProvisioningService(prisma as any)
    expect((await service.create({ customerCode: initial.customerCode, customerName: initial.customerName, balance: 0 })).customer.balance).toBe(0)
    expect(tx.customer.create).toHaveBeenCalledWith({ data: expect.objectContaining({ balance: 0 }) })
  })
  it('正常资料修改不携带余额字段', async () => {
    const customer = {id:260n,...initial,balance:'1.86'}, tx = { customer: { findUnique: jest.fn().mockResolvedValue(customer), update: jest.fn().mockResolvedValue(customer) }, $queryRaw: jest.fn().mockResolvedValue([]) }
    const service = new CustomerProvisioningService({ $transaction: async fn => fn(tx) } as any)
    await service.update(260, {contactName:'新联系人'})
    expect(tx.customer.update.mock.calls[0][0].data).not.toHaveProperty('balance')
  })
})
describe('历史门户回填不能覆盖现有账务', () => {
  function environment(existing: boolean) {
    const prisma = { customer: { findUnique: jest.fn().mockResolvedValue(existing ? {id:260n} : null), update: jest.fn() }, $queryRawUnsafe: jest.fn().mockResolvedValue([{total:1}]) }, provisioning = { create:jest.fn(), update:jest.fn() }
    const service = new CustomersService(prisma as any, provisioning as any)
    jest.spyOn(service as any, 'findLegacyOmsAccount').mockResolvedValue({portalUserId:'existing-portal'})
    return { prisma, provisioning, service }
  }
  it.each([-100, 100])('旧文件余额 %p 不覆盖已发生结算的余额，返回待核对信息', async balance => {
    ;(readFileSync as jest.Mock).mockReturnValue(JSON.stringify([{...initial,balance}]))
    const { prisma, provisioning, service } = environment(true)
    const result = await service.importLegacyFromFile()
    expect(result).toMatchObject({updated:1,failed:0,balanceReviewCount:1,balanceReview:[{customerCode:initial.customerCode,legacyBalance:balance}]})
    expect(prisma.customer.update).not.toHaveBeenCalled()
    expect(provisioning.update.mock.calls[0][1]).not.toHaveProperty('balance')
  })
  it.each([-100, 100, true, 'invalid', 0.001])('新门户有非零或非法历史余额 %p 时在开户前拒绝', async balance => {
    ;(readFileSync as jest.Mock).mockReturnValue(JSON.stringify([{...initial,balance}]))
    const { prisma, provisioning, service } = environment(false)
    expect(await service.importLegacyFromFile()).toMatchObject({created:0,failed:1})
    expect(provisioning.create).not.toHaveBeenCalled();expect(prisma.customer.update).not.toHaveBeenCalled()
  })
  it('导入逐行异常也返回中文，不把数据库异常直接放进成功响应', async () => {
    ;(readFileSync as jest.Mock).mockReturnValue(JSON.stringify([initial]))
    const { prisma, service } = environment(true)
    prisma.customer.findUnique.mockRejectedValue(new Error('PrismaClientKnownRequestError SQLSTATE 45000'))
    expect((await service.importLegacyFromFile()).errors[0].message).toBe('该客户导入失败，请检查资料后重试')
  })
  it('导入文件损坏给出可重试中文提示', async () => {
    ;(readFileSync as jest.Mock).mockReturnValue('{invalid')
    await expect(environment(true).service.importLegacyFromFile()).rejects.toThrow('请检查文件是否已准备且格式正确')
  })
  it('客户类型冲突不暴露内部英文字段名', async () => {
    const service = new CustomerProvisioningService({} as any)
    await expect(service.create({...initial,portalType:'catalog',omsType:'hybrid'})).rejects.toThrow('客户类型设置不一致')
  })
})
