import { validateOmsProductImage } from './oms-product-image.util'

describe('OMS 商品图片上传校验', () => {
  it('接受真实 PNG 签名与 Data URL', () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
    const payload = bytes.toString('base64')
    expect(validateOmsProductImage({ fileName: '商品.png', contentBase64: `data:image/png;base64,${payload}` }))
      .toEqual({ fileName: '商品.png', contentBase64: payload })
  })

  it('拒绝扩展名与内容不匹配', () => {
    const payload = Buffer.from('not an image').toString('base64')
    expect(() => validateOmsProductImage({ fileName: 'fake.png', contentBase64: payload }))
      .toThrow('仅支持内容与扩展名一致')
  })

  it('拒绝超过 5MB 的图片', () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024)])
    expect(() => validateOmsProductImage({ fileName: 'large.jpg', contentBase64: bytes.toString('base64') }))
      .toThrow('商品图片大小须在 5MB 以内')
  })
})
