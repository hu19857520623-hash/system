import { inboundReceivingStarted } from './inbound-delete.util'

describe('inboundReceivingStarted', () => {
  it('allows delete while still on the way or only arrived', () => {
    expect(inboundReceivingStarted({ status: 'pending_receipt', items: [{ actualQty: 0 }] })).toBe(false)
    expect(inboundReceivingStarted({ status: 'arrived', items: [{ actualQty: null }] })).toBe(false)
  })

  it('blocks delete after receiving starts', () => {
    expect(inboundReceivingStarted({ status: 'receiving' })).toBe(true)
    expect(inboundReceivingStarted({ status: 'pending_receipt', items: [{ actualQty: 2 }] })).toBe(true)
    expect(inboundReceivingStarted({ status: 'arrived', cartons: [{ status: 'received' }] })).toBe(true)
    expect(inboundReceivingStarted({ status: 'pending_receipt', receivedAt: new Date() })).toBe(true)
  })
})
