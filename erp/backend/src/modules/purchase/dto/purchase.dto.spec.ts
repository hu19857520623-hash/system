import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreatePurchaseOrderDto, PoRejectDto } from './purchase.dto'

describe('CreatePurchaseOrderDto', () => {
  const valid = {
    supplierId: 1,
    items: [{ sku: 'SKU-1', quantity: 2, unitPrice: 10 }],
  }

  it('accepts a purchase order with line items', async () => {
    const errors = await validate(plainToInstance(CreatePurchaseOrderDto, valid))
    expect(errors).toHaveLength(0)
  })

  it('rejects missing line items', async () => {
    const errors = await validate(plainToInstance(CreatePurchaseOrderDto, { supplierId: 1 }))
    expect(errors.some((error) => error.property === 'items')).toBe(true)
  })
})

describe('PoRejectDto', () => {
  it('requires a remark', async () => {
    const errors = await validate(plainToInstance(PoRejectDto, {}))
    expect(errors.some((error) => error.property === 'remark')).toBe(true)
  })
})
