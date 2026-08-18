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
  username: 'acmeportal',
  temporaryPassword: 'abcdef',
}

describe('CreateCustomerDto portal validation', () => {
  it('accepts a six-character password', async () => {
    const errors = await validate(plainToInstance(CreateCustomerDto, validInput))
    expect(errors).toHaveLength(0)
  })

  it('rejects a password shorter than 6 characters', async () => {
    const dto = plainToInstance(CreateCustomerDto, {
      ...validInput,
      temporaryPassword: 'abcde',
    })
    const errors = await validate(dto)
    expect(errors.some((error) => error.property === 'temporaryPassword')).toBe(true)
  })

  it('rejects a username shorter than 6 characters', async () => {
    const dto = plainToInstance(CreateCustomerDto, {
      ...validInput,
      username: 'admin',
    })
    const errors = await validate(dto)
    expect(errors.some((error) => error.property === 'username')).toBe(true)
  })

  it('requires a customer code', async () => {
    const { customerCode: _customerCode, ...withoutCode } = validInput
    const errors = await validate(plainToInstance(CreateCustomerDto, withoutCode))
    expect(errors.some((error) => error.property === 'customerCode')).toBe(true)
  })
})
