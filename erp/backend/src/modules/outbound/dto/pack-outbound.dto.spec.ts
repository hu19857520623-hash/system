import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { PackOutboundDto } from './pack-outbound.dto'

describe('复核打包边界', () => {
  const body = { clientRequestId: 'original-pack', isPalletized: false, palletInfo: '', reviewSource: 'pick_list', cartons: [{ lengthCm: 30, widthCm: 20, heightCm: 10, grossWeightKg: 2 }] }
  it.each([{ clientRequestId: undefined }, { clientRequestId: ' ' }, { clientRequestId: 'x'.repeat(101) }, { isPalletized: 'true' }, { palletInfo: 'x'.repeat(501) }, { cartons: {} }, { cartons: [{ lengthCm: true, widthCm: 20, heightCm: 10, grossWeightKg: 2 }] }, { cartons: [{ lengthCm: 30, widthCm: 20, heightCm: 10, grossWeightKg: '' }] }, { cartons: [{ lengthCm: 0, widthCm: 20, heightCm: 10, grossWeightKg: -1 }] }])('拒绝无效原请求和实测资料 %p', async patch => {
    expect((await validate(plainToInstance(PackOutboundDto, { ...body, ...patch }))).length).toBeGreaterThan(0)
  })
  it('保留显式零重量和空打托资料，接受数值字符串', async () => {
    const dto = plainToInstance(PackOutboundDto, { ...body, cartons: [{ lengthCm: '30', widthCm: '20', heightCm: '10', grossWeightKg: '0' }] })
    expect(await validate(dto)).toHaveLength(0);expect(dto.cartons?.[0].grossWeightKg).toBe(0);expect(dto.palletInfo).toBe('')
  })
})
