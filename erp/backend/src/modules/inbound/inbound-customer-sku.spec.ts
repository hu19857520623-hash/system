import { inboundCustomerSku } from '@erp/shared/inbound-customer-sku'
import { buildSkuLabelInputs } from '../../common/labels/sku-label.util'

describe('inbound customer SKU labels', () => {
  it('uses the customer SKU even when a platform barcode is bound', () => {
    const item = { sku: 'TKL005-710545', customerSku: 'CUSTOM-545', barcode: '9902301890599' }
    expect(buildSkuLabelInputs([{ sku: inboundCustomerSku(item, 'TKL005'), qty: 7 }]))
      .toEqual([{ code: 'CUSTOM-545', copies: 7 }])
  })

  it('removes only the known customer prefix for legacy inbound lines', () => {
    expect(inboundCustomerSku({ sku: 'TKL005-710667-2' }, 'TKL005')).toBe('710667-2')
    expect(inboundCustomerSku({ sku: 'TKL-710667-2' }, 'TKL005')).toBe('TKL-710667-2')
    expect(inboundCustomerSku({ sku: 'TKL005-710667-2' })).toBe('TKL005-710667-2')
  })
})
