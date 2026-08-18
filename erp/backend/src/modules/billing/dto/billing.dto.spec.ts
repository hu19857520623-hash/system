import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateBillingChargeDto, CreateBillingOrderDto, GenerateBillingDto } from './billing.dto'

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
