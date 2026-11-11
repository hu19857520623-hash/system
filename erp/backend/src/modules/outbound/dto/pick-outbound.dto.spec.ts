import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { PickOutboundDto } from './pick-outbound.dto'

describe('网页拣货原操作标识', () => {
  const body = { items: [{ id: 34, allocations: [{ locationCode: 'A-01', qty: 1 }] }], pickSource: 'pick_list' }
  it.each([undefined, null, '', ' ', ' padded ', 'x'.repeat(101)])('拒绝无法恢复的标识 %p 并返回中文', async clientRequestId => {
    const errors = await validate(plainToInstance(PickOutboundDto, { ...body, clientRequestId }))
    const messages = Object.values(errors.find(e => e.property === 'clientRequestId')!.constraints!)
    expect(messages.length).toBeGreaterThan(0)
    expect(messages.every(m => m.includes('原拣货操作标识'))).toBe(true)
  })
  it('接受已保存的 UUID 和历史原请求编号', async () => {
    for (const clientRequestId of ['22e66194-e299-432f-ad9b-491f4c384821', 'historical-pick-original']) {
      expect(await validate(plainToInstance(PickOutboundDto, { ...body, clientRequestId }))).toHaveLength(0)
    }
  })
})
