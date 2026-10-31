import { catalogInTransitQty, openInboundRemaining } from './catalog-pipeline-qty.util'

describe('openInboundRemaining', () => {
  it('counts full expected while inbound is still on the way', () => {
    expect(openInboundRemaining(198, null, 'pending_receipt')).toBe(198)
  })

  it('subtracts received qty while still receiving', () => {
    expect(openInboundRemaining(198, 2, 'receiving')).toBe(196)
  })

  it('is zero after inbound is completed', () => {
    expect(openInboundRemaining(198, 2, 'completed')).toBe(0)
    expect(openInboundRemaining(198, 2, 'pending_putaway')).toBe(0)
  })
})

describe('catalogInTransitQty', () => {
  it.each([
    { purchaseTotal:5, damagedPurchaseQty:1, inboundExpectedTotal:4, openInboundRemaining:0, expected:0 },
    { purchaseTotal:5, damagedPurchaseQty:1, inboundExpectedTotal:4, openInboundRemaining:1, expected:1 },
    { purchaseTotal:10, damagedPurchaseQty:2, inboundExpectedTotal:6, openInboundRemaining:0, expected:2 },
    { purchaseTotal:10, damagedPurchaseQty:2, inboundExpectedTotal:10, openInboundRemaining:3, expected:3 },
  ])('received damage never remains an unallocated future shipment %p', ({expected,...input}) => {
    expect(catalogInTransitQty(input)).toBe(expected)
  })
  it('treats uninbound purchase as in transit', () => {
    expect(catalogInTransitQty({ purchaseTotal: 198, inboundExpectedTotal: 0, openInboundRemaining: 0 })).toBe(198)
  })

  it('uses open inbound remaining once an ASN exists', () => {
    expect(catalogInTransitQty({ purchaseTotal: 198, inboundExpectedTotal: 198, openInboundRemaining: 198 })).toBe(198)
  })

  it('clears in-transit after short receive closes the inbound', () => {
    expect(catalogInTransitQty({ purchaseTotal: 198, inboundExpectedTotal: 198, openInboundRemaining: 0 })).toBe(0)
  })

  it('adds a later purchase that has not shipped yet', () => {
    expect(catalogInTransitQty({ purchaseTotal: 298, inboundExpectedTotal: 198, openInboundRemaining: 0 })).toBe(100)
  })
})
