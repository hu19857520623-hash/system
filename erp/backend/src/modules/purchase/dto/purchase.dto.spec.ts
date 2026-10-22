import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreatePurchaseOrderDto, PoRejectDto, UpdatePrePurchaseDto } from './purchase.dto'

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

describe('预采购修改', () => {
  it('保留显式清空的文本和日期，供服务端清除旧值', async () => {
    const dto = plainToInstance(UpdatePrePurchaseDto, { remark: '', productLink: '', expectedArrival: '', warehouseCode: '' })
    expect(dto.remark).toBe(''); expect(dto.productLink).toBe(''); expect(dto.expectedArrival).toBe('')
    expect(await validate(dto)).toHaveLength(0)
  })
  for (const field of ['taxRate', 'invoiceTaxRate', 'unitTax', 'unitFreight', 'packageWeightKg', 'logoUnitFee', 'logoTotalFee', 'cartonTotalPrice', 'spareCartonUnitPrice']) {
    it(`${field} 不接受负值`, async () => {
      const errors = await validate(plainToInstance(UpdatePrePurchaseDto, { [field]: -1 }))
      expect(errors.some(error => error.property === field)).toBe(true)
    })
  }
  it('拒绝溢出数量和无效到货日期', async () => {
    const errors = await validate(plainToInstance(UpdatePrePurchaseDto, { plannedQty: 2147483648, expectedArrival: 'not-a-date' }))
    expect(errors.map(error => error.property)).toEqual(expect.arrayContaining(['plannedQty', 'expectedArrival']))
  })
})
