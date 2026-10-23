import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateBillingChargeDto, CreateBillingOrderDto, GenerateBillingDto, BillingOperationDto, SubmitGenerateBillingDto, CreateManualBillingChargeDto } from './billing.dto'

describe('账务写入边界', () => {
  const clientRequestId = 'bbffb20e-374a-4af6-b559-2c1ca5618d47'
  it('预览查询只转换整数客户代码，不把布尔值转换为客户1', async () => {
    expect(await validate(plainToInstance(GenerateBillingDto, { customerId: '1' }))).toHaveLength(0)
    for (const value of [true, false, {}, '1.1']) expect((await validate(plainToInstance(GenerateBillingDto, { customerId: value }))).some(e => e.property === 'customerId')).toBe(true)
  })
  it('生成和确认必须携带原请求编号与预览版本', async () => {
    for (const dto of [BillingOperationDto, SubmitGenerateBillingDto]) {
      expect(await validate(plainToInstance(dto, { clientRequestId, expectedVersion: 'a'.repeat(64) }))).toHaveLength(0)
      expect(await validate(plainToInstance(dto, {}))).toHaveLength(2)
    }
  })
  it('手工费用不接受布尔客户、字符串金额或超精度金额', async () => {
    const body = { clientRequestId, customerId: 1, amount: 3.5, chargeType: 'handling', chargeDate: '2026-10-23' }
    expect(await validate(plainToInstance(CreateManualBillingChargeDto, body))).toHaveLength(0)
    for (const patch of [{ customerId: true }, { amount: '3.5' }, { amount: 3.501 }]) expect((await validate(plainToInstance(CreateManualBillingChargeDto, { ...body, ...patch }))).length).toBeGreaterThan(0)
  })
})

describe('CreateBillingChargeDto', () => {
  it('accepts a manual charge', async () => {
    const errors = await validate(plainToInstance(CreateBillingChargeDto, {
      customerId: 3,
      amount: 12.5,
      chargeType: 'relabel',
      chargeDate: '2026-08-18',
    }))
    expect(errors).toHaveLength(0)
  })

  it('rejects a missing customer and non-positive amount', async () => {
    const errors = await validate(plainToInstance(CreateBillingChargeDto, { amount: 0 }))
    expect(errors.some((error) => error.property === 'customerId')).toBe(true)
    expect(errors.some((error) => error.property === 'amount')).toBe(true)
  })
})

describe('GenerateBillingDto', () => {
  it('accepts a date range', async () => {
    const errors = await validate(plainToInstance(GenerateBillingDto, {
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
    }))
    expect(errors).toHaveLength(0)
  })

  it('rejects a malformed date', async () => {
    const errors = await validate(plainToInstance(GenerateBillingDto, { dateFrom: '08/01' }))
    expect(errors.some((error) => error.property === 'dateFrom')).toBe(true)
  })
})

describe('CreateBillingOrderDto', () => {
  it('requires customer, month and items', async () => {
    const errors = await validate(plainToInstance(CreateBillingOrderDto, {}))
    expect(errors.some((error) => error.property === 'customerId')).toBe(true)
    expect(errors.some((error) => error.property === 'billingMonth')).toBe(true)
    expect(errors.some((error) => error.property === 'items')).toBe(true)
  })
})
