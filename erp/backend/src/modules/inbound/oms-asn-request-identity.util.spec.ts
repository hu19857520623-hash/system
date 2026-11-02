import { assertLegacyOmsAsnMetadata, omsAsnRequestIdentity } from './oms-asn-request-identity.util'
import { buildInboundRemark } from '../../common/oms-sync-meta.util'

const body = { customerCode: 'TKL9069', source: '客户自发', contact: '测试联系人', trackingNo: 'TEST-84', remark: '虚构预报', items: [{ sku: 'A', qty: 3, boxNo: 1, productName: '商品A', lengthCm: 20, widthCm: 10, heightCm: 5 }] }
const identity = (data: typeof body) => omsAsnRequestIdentity(data, 'WMS-JHB-01', data.items.map(() => 'TKL9069-A'))

describe('入库原预报回执', () => {
  it('客户别名、箱内拆分行和文本首尾空白归一；尺寸数字与数字字符串等价', () => {
    expect(identity({ ...body, contact: ' 测试联系人 ', items: [{ ...body.items[0], sku: 'TKL9069-A', qty: 1 }, { ...body.items[0], qty: 2, lengthCm: '20' as any }] })).toBe(identity(body))
  })

  it.each(['contact', 'trackingNo', 'source', 'remark', 'referenceNo', 'eta', 'contactPhone', 'deliveryMethod', 'inboundType', 'stockSource'])('原请求绑定 %s', field => {
    expect(identity({ ...body, [field]: '修改内容' })).not.toBe(identity(body))
  })

  it('绑定商品名称和客户声明尺寸，不读取会被后来测量更改的商品档案', () => {
    expect(identity({ ...body, items: [{ ...body.items[0], productName: '商品B' }] })).not.toBe(identity(body))
    expect(identity({ ...body, items: [{ ...body.items[0], lengthCm: 21 }] })).not.toBe(identity(body))
    expect(() => identity({ ...body, items: [{ ...body.items[0], heightCm: 0 }] })).toThrow('客户尺寸无效')
  })

  it('历史单据只在已保存预报字段一致时读取，不能用当前档案猜测原尺寸', () => {
    const legacy = { ...body, items: [{ sku: 'A', qty: 3, boxNo: 1 }] }
    const stored = { ...body, remark: buildInboundRemark({ customerCode: body.customerCode, userRemark: body.remark, meta: { source: body.source, contact: body.contact } }) }
    expect(() => assertLegacyOmsAsnMetadata(legacy, stored)).not.toThrow()
    expect(() => assertLegacyOmsAsnMetadata({ ...legacy, contact: '更改联系人' }, stored)).toThrow('预报信息与原单不一致')
    expect(() => assertLegacyOmsAsnMetadata(body, stored)).toThrow('历史入库单没有保存原尺寸回执')
  })
})
