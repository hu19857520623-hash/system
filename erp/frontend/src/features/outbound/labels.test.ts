import { describe, expect, it } from 'vitest'
import {
  buildOutboundLabelSummary,
  outboundLabelActionKey,
} from './labels'

describe('outbound Takealot label UI model', () => {
  it('exposes a clear no-platform-label state for non-Takealot orders', () => {
    const summary = buildOutboundLabelSummary({
      platform: 'Amazon',
      items: [{ sku: 'INT-001', qty: 2 }],
    })

    expect(summary.isTakealot).toBe(false)
    expect(summary.allPrintable).toBe(false)
    expect(summary.lines[0]?.internalSku).toBe('INT-001')
  })

  it('treats legacy Takealot orders without unit metadata as having no labels', () => {
    const summary = buildOutboundLabelSummary({
      platform: 'Takealot',
      items: [{ sku: 'LEGACY-001', qty: 1 }],
    })

    expect(summary.isTakealot).toBe(true)
    expect(summary.hasLabelMetadata).toBe(false)
    expect(summary.allPrintable).toBe(false)
  })

  it('enables order, SKU and unit printing when every cropped count matches', () => {
    const summary = buildOutboundLabelSummary({
      id: 42,
      platform: 'Takealot',
      items: [{
        sku: 'INT-001',
        qty: 2,
        labelMetadata: {
          mappingReady: true,
          labelReady: true,
          croppedLabelCount: 2,
          unitIndices: [0, 1],
        },
      }],
    })

    expect(summary.allPrintable).toBe(true)
    expect(summary.totalCroppedLabels).toBe(2)
    expect(summary.lines[0]).toMatchObject({
      internalSku: 'INT-001',
      expectedQty: 2,
      countMatches: true,
      printable: true,
      unitIndices: [0, 1],
    })
  })

  it('blocks every print scope when a SKU label count is short', () => {
    const summary = buildOutboundLabelSummary({
      platform: 'Takealot',
      items: [{
        sku: 'INT-002',
        expectedQty: 3,
        croppedLabelCount: 2,
        mappingReady: true,
        labelReady: true,
        unitIndices: [1, 2],
      }],
    })

    expect(summary.allPrintable).toBe(false)
    expect(summary.lines[0]?.countMatches).toBe(false)
    expect(summary.lines[0]?.printable).toBe(false)
  })

  it('merges order-level label metadata into internal outbound lines', () => {
    const summary = buildOutboundLabelSummary({
      items: [{ sku: 'INT-003', qty: 1, productName: 'Widget' }],
      labelMetadata: {
        items: [{
          internalSku: 'INT-003',
          croppedLabelCount: 1,
          mappingStatus: 'mapped',
          labelStatus: 'ready',
          unitLabels: [{ unitIndex: 7 }],
        }],
      },
    })

    expect(summary.isTakealot).toBe(true)
    expect(summary.hasLabelMetadata).toBe(true)
    expect(summary.allPrintable).toBe(true)
    expect(summary.lines[0]?.unitIndices).toEqual([7])
  })

  it('aggregates the stored attachment metadata returned by outbound detail', () => {
    const summary = buildOutboundLabelSummary({
      platform: 'Takealot',
      items: [{ sku: 'INT-004', qty: 2 }],
      attachments: [
        { fileType: 'skuLabel', sku: 'INT-004', unitIndex: 1 },
        { fileType: 'skuLabel', sku: 'INT-004', unitIndex: 2 },
        { fileType: 'deliveryList', fileName: 'delivery.pdf' },
      ],
    })

    expect(summary.hasLabelMetadata).toBe(true)
    expect(summary.allPrintable).toBe(true)
    expect(summary.lines[0]).toMatchObject({
      internalSku: 'INT-004',
      croppedLabelCount: 2,
      unitIndices: [1, 2],
    })
  })

  it('creates independent loading keys for order, SKU and unit actions', () => {
    expect(outboundLabelActionKey(42, 'order')).toBe('42:order')
    expect(outboundLabelActionKey(42, 'sku', 'INT-001')).toBe('42:sku:INT-001')
    expect(outboundLabelActionKey(42, 'unit', 'INT-001', 0)).toBe('42:unit:INT-001:0')
  })
})
