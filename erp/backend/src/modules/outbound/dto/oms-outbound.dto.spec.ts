import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
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
})
