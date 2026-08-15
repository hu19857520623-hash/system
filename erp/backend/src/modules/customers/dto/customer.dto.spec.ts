import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateCustomerDto } from './customer.dto'

const validInput = {
  customerCode: 'CUS-100',
  customerName: 'Validation Customer',
  portalType: 'ecommerce',
  warehouse: 'WMS-JHB-01',
  permissions: ['dashboard:read'],
  loginEmail: 'portal@example.test',
  temporaryPassword: 'abcdefg1',
}

describe('CreateCustomerDto portal validation', () => {
  it('accepts an eight-character password containing letters and digits', async () => {
    const errors = await validate(plainToInstance(CreateCustomerDto, validInput))
    expect(errors).toHaveLength(0)
  })

  it('rejects a password without a digit', async () => {
    const dto = plainToInstance(CreateCustomerDto, {
      ...validInput,
      temporaryPassword: 'abcdefgh',
    })
    const errors = await validate(dto)
    expect(errors.some((error) => error.property === 'temporaryPassword')).toBe(true)
  })

  it('requires a customer code', async () => {
    const { customerCode: _customerCode, ...withoutCode } = validInput
    const errors = await validate(plainToInstance(CreateCustomerDto, withoutCode))
    expect(errors.some((error) => error.property === 'customerCode')).toBe(true)
  })
})
