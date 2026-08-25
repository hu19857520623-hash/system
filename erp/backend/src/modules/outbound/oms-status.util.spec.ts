import { toOmsOutboundStatus } from './oms-status.util'

describe('toOmsOutboundStatus', () => {
  it('maps warehouse pipeline to OMS locked/picking', () => {
    expect(toOmsOutboundStatus('pending_pick')).toBe('locked')
    expect(toOmsOutboundStatus('picking')).toBe('picking')
    expect(toOmsOutboundStatus('picked')).toBe('picking')
    expect(toOmsOutboundStatus('pending_relabel')).toBe('picking')
  })

  it('keeps shipped and delivered', () => {
    expect(toOmsOutboundStatus('shipped')).toBe('shipped')
    expect(toOmsOutboundStatus('delivered')).toBe('delivered')
  })

  it('does not map cancelled to exception', () => {
    expect(toOmsOutboundStatus('cancelled')).toBe('cancelled')
    expect(toOmsOutboundStatus('exception')).toBe('exception')
  })
})
