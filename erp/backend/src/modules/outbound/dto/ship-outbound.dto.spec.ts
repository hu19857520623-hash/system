import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { ShipOutboundDto } from './ship-outbound.dto'
describe('发运请求边界', () => {
  const body = { clientRequestId: '164895f6-133d-4a02-a7b0-5ea749e19d26', trackingNo: ' TRACK ', carrier: '承运商' }
  it('保留原操作编号并规范物流资料', async () => {
    const dto = plainToInstance(ShipOutboundDto, body);expect(await validate(dto)).toHaveLength(0);expect(dto.trackingNo).toBe('TRACK')
  })
  it.each([{ clientRequestId: '' }, { trackingNo: true }, { carrier: 'a'.repeat(51) }, { logisticsProduct: {} }])('拒绝无法安全保存的发运资料%j', async patch => {
    expect((await validate(plainToInstance(ShipOutboundDto, { ...body, ...patch }))).length).toBeGreaterThan(0)
  })
})
