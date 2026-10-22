import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate, type ValidationError } from 'class-validator'
import { ProcessReturnDto } from './process-return.dto'

function messages(errors: ValidationError[]): string[] {
  return errors.flatMap(error => [...Object.values(error.constraints || {}), ...messages(error.children || [])])
}
describe('return restock request validation', () => {
  it('accepts the explicit physical warehouse, SKU, actual quantity and location', async () => {
    expect(await validate(plainToInstance(ProcessReturnDto, { processResult: 'restock', warehouseCode: 'WMS-JHB-01', clientRequestId: 'REQUEST-ONE', stockLines: [{ sku: 'TKL9001-A', qty: 1, locationCode: 'A-01' }] }))).toHaveLength(0)
  })
  it.each([{ stockLines: [null] }, { stockLines: [{ sku: {}, qty: 1, locationCode: 'A' }] }, { stockLines: [{ sku: 'A', qty: 'invalid', locationCode: 'B' }] }, { stockLines: [{ sku: 'A', qty: 1, locationCode: {} }] }, { processRemark: {} }])('rejects malformed request fields with explicit Chinese feedback', async body => {
    const errors = messages(await validate(plainToInstance(ProcessReturnDto, body)))
    expect(errors.length).toBeGreaterThan(0)
    for (const error of errors) expect(error).toMatch(/[\u3400-\u9fff]/)
  })
})
