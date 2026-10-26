import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreatePurchaseOrderDto, PoRejectDto, UpdatePrePurchaseDto, UpdatePurchasePackageDto } from './purchase.dto'

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

describe('审核后箱子尺寸维护', () => {
  const valid = { packageLengthCm: 40, packageWidthCm: 30, packageHeightCm: 20, expectedUpdatedAt: '2026-10-26T06:00:00.000Z', reason: '供应商确认尺寸' }
  it('校验三项尺寸及修改依据，并剥离价格、数量和状态字段', async () => {
    const dto = plainToInstance(UpdatePurchasePackageDto, { ...valid, quantity: 99, unitPrice: 1, status: 'pending_po_audit' })
    expect(await validate(dto, { whitelist: true })).toHaveLength(0)
    expect(dto).not.toHaveProperty('quantity'); expect(dto).not.toHaveProperty('unitPrice'); expect(dto).not.toHaveProperty('status')
  })
  it.each([0, -1, null, undefined, Infinity, 1.234, 1000000])('拒绝无效尺寸 %s', async value => {
    const errors = await validate(plainToInstance(UpdatePurchasePackageDto, { ...valid, packageLengthCm: value }))
    expect(errors.some(error => error.property === 'packageLengthCm')).toBe(true)
  })
  it('缺少原版本或修改原因时不允许提交', async () => {
    const errors = await validate(plainToInstance(UpdatePurchasePackageDto, { ...valid, expectedUpdatedAt: '', reason: ' ' }))
    expect(errors.map(error => error.property)).toEqual(expect.arrayContaining(['expectedUpdatedAt', 'reason']))
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
