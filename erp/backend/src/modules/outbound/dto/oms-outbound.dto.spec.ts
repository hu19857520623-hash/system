import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { chineseValidationException } from '../../../common/pipes/validation-feedback.util'
import { CreateOmsOutboundDto } from './oms-outbound.dto'

describe('CreateOmsOutboundDto label validation', () => {
  it('normalizes valid cropped SKU-label metadata', async () => {
    const dto = plainToInstance(CreateOmsOutboundDto, {
      customerCode: 'CUST-1',
      items: [{ sku: 'SKU-A', qty: 1 }],
      attachments: [{
        fileType: 'sku_label',
        fileName: 'label.pdf',
        contentBase64: 'JVBERi0=',
        sku: 'SKU-A',
        unitIndex: '1',
        sourcePage: '0',
      }],
    })

    expect(await validate(dto)).toHaveLength(0)
    expect(dto.attachments?.[0]).toMatchObject({
      fileType: 'skuLabel',
      sku: 'SKU-A',
      unitIndex: 1,
      sourcePage: 0,
    })
  })

  it('rejects a skuLabel without unit ownership metadata', async () => {
    const dto = plainToInstance(CreateOmsOutboundDto, {
      customerCode: 'CUST-1',
      items: [{ sku: 'SKU-A', qty: 1 }],
      attachments: [{
        fileType: 'skuLabel',
        fileName: 'label.pdf',
        contentBase64: 'JVBERi0=',
        labelRole: 'unitCrop',
      }],
    })

    const errors = await validate(dto)
    expect(errors.find((error) => error.property === 'attachments')?.children?.[0]?.children)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ property: 'sku' }),
        expect.objectContaining({ property: 'unitIndex' }),
      ]))
  })

  it('returns a Chinese message when the label index is below 1', async () => {
    const dto = plainToInstance(CreateOmsOutboundDto, {
      customerCode: 'CUST-1',
      items: [{ sku: 'SKU-A', qty: 1 }],
      attachments: [{
        fileType: 'skuLabel',
        fileName: 'label.pdf',
        contentBase64: 'JVBERi0=',
        sku: 'SKU-A',
        unitIndex: 0,
      }],
    })
    const error = chineseValidationException(await validate(dto))
    const response = error.getResponse() as { message?: string | string[] }
    const text = Array.isArray(response.message) ? response.message.join('；') : String(response.message || error.message)
    expect(text).toContain('商品标签序号必须是大于等于 1 的整数')
    expect(text).not.toContain('unitIndex')
  })
})
