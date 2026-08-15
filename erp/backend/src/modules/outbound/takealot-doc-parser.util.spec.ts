import {
  describeTakealotParsed,
  mergeTakealotParsed,
  parseTakealotDocumentText,
  parseTakealotFilename,
  type TakealotParsedDoc,
} from './takealot-doc-parser.util'

const SHIPPING_NOTE_TEXT = `
31/07/2026Created by Adams James John for Takealot
Shipment Name: PO-29896140-31/07/2026-JHB3-1
Due Date: 2026/07/31
Seller ID: 29896140
Adams James John
PO Number: 183263593
9902357529948
Indoor Jungle Gym, Foldable Wooden Climbing Set with Swing, Slide, Ladder
104038547WM162
Page 1 of 1
`

const BOOKING_TEXT = `
Booking ConfirmationAdams James John
Delivery Address:Takealot DCDate of Booking:Aug 04, 2026
Johannesburg DC 3Time Slot:10:00
Booking Reference Number:TALBRAGDG5187177
TAL MP183263593ASNJHBMP1832635932Customer
Total units on delivery: 2
`

describe('takealot doc parser', () => {
  it('parses shipping note', () => {
    const p = parseTakealotDocumentText(SHIPPING_NOTE_TEXT, '发货清单')
    expect(p.poNumber).toBe('183263593')
    expect(p.sellerName).toBe('Adams James John')
    expect(p.warehouseCode).toBe('jhb3')
    expect(p.lineItems?.[0]?.sku).toBe('WM16')
    expect(p.lineItems?.[0]?.qty).toBe(2)
  })

  it('parses booking confirmation', () => {
    const p = parseTakealotDocumentText(BOOKING_TEXT, '预约单')
    expect(p.poNumber).toBe('183263593')
    expect(p.appointmentDate).toBe('2026-08-04T10:00')
    expect(p.warehouseCode).toBe('jhb3')
    expect(p.bookingRef).toBe('TALBRAGDG5187177')
  })

  it('parses filename', () => {
    const p = parseTakealotFilename('shipping_labels_PO_29896140_31_07_2026_JHB3_1.pdf')
    expect(p.sellerId).toBe('29896140')
    expect(p.warehouseCode).toBe('jhb3')
    expect(p.shipmentDate).toBe('2026-07-31')
  })

  it('merges all sources', () => {
    const merged = mergeTakealotParsed(
      parseTakealotFilename('shipping_note_PO_29896140_31_07_2026_JHB3_1.pdf'),
      parseTakealotDocumentText(SHIPPING_NOTE_TEXT, '发货清单'),
      parseTakealotDocumentText(BOOKING_TEXT, '预约单'),
    ) as TakealotParsedDoc
    expect(merged.poNumber).toBe('183263593')
    expect(merged.lineItems[0]?.sku).toBe('WM16')
    expect(describeTakealotParsed(merged)).toContain('WM16')
  })
})
