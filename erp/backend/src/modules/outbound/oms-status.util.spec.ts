import { toOmsOutboundStatus, toOmsLogisticsStatus, isOmsLogisticsExceptionStatus } from './oms-status.util'

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

  it('maps post-ship tracking nodes to OMS 1:1', () => {
    expect(toOmsOutboundStatus('partial_delivered')).toBe('partial_delivered')
    expect(toOmsOutboundStatus('delivery_failed')).toBe('delivery_failed')
    expect(toOmsLogisticsStatus('partial_delivered')).toBe('partial_delivered')
    expect(toOmsLogisticsStatus('delivery_failed')).toBe('delivery_failed')
    expect(toOmsLogisticsStatus('shipped')).toBe('in_transit')
    expect(isOmsLogisticsExceptionStatus('partial_delivered')).toBe(true)
    expect(isOmsLogisticsExceptionStatus('delivery_failed')).toBe(true)
    expect(isOmsLogisticsExceptionStatus('in_transit')).toBe(false)
  })

  it('does not map cancelled to exception', () => {
    expect(toOmsOutboundStatus('cancelled')).toBe('cancelled')
    expect(toOmsOutboundStatus('exception')).toBe('exception')
  })
})
