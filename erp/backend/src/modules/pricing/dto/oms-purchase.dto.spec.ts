import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { OmsPurchaseDto } from './oms-purchase.dto'
describe('OMS采购请求边界', () => {
  const body = { orderNo: 'CAT-original', customerCode: 'TKL9001', sku: 'TKL-A', quantity: 1, unitPrice: 10 }
  it('接受固定单号、正整数数量和两位小数报价', async () => { expect(await validate(plainToInstance(OmsPurchaseDto, body))).toHaveLength(0) })
  it.each([{ orderNo: '' }, { quantity: true }, { quantity: 1.5 }, { quantity: '2' }, { unitPrice: 1.001 }, { customerId: false }])('拒绝类型或标识无效的采购请求%j', async patch => {
    expect((await validate(plainToInstance(OmsPurchaseDto, { ...body, ...patch }))).length).toBeGreaterThan(0)
  })
})
