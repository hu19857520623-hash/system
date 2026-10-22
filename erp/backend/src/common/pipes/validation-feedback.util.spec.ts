import 'reflect-metadata'
import { AppValidationPipe } from './app-validation.pipe'
import { validationFeedback } from './validation-feedback.util'
import { ProcessReturnDto } from '../../modules/returns/dto/process-return.dto'
import { BadRequestException } from '@nestjs/common'

describe('Chinese nested validation feedback', () => {
  it('identifies a row without exposing nested DTO property paths', () => {
    expect(validationFeedback([{property:'stockLines',children:[{property:'0',children:[{property:'qty',constraints:{isInt:'上架数量须为大于零的整数'}}]}]}])).toEqual(['第 1 条明细：上架数量须为大于零的整数'])
  })
  it('replaces default English rules with Chinese field feedback while preserving valid SKU text', () => {
    expect(validationFeedback([{property:'sku',constraints:{isNotEmpty:'sku should not be empty'}},{property:'customerCode',constraints:{isString:'customerCode must be a string'}},{property:'other',constraints:{custom:'SKU ABC.01 不可用'}}])).toEqual(['请填写SKU','客户编码须为文字内容','SKU ABC.01 不可用'])
  })
  it('the real global pipe returns actionable Chinese messages without adding stockLines.0', async () => {
    try {
      await new AppValidationPipe().transform({ stockLines: [{sku:'TKL9001-A',qty:1.5,locationCode:'A-01'}] }, {type:'body',metatype:ProcessReturnDto})
      throw new Error('Expected request rejection')
    } catch(error) {
      expect(error).toBeInstanceOf(BadRequestException)
      const response=(error as BadRequestException).getResponse() as {message:string[]}
      expect(response.message).toContain('第 1 条明细：上架数量须为大于零的整数')
      expect(response.message.join('')).not.toMatch(/stockLines|must be|should not/)
    }
  })
})
