import {
  hasInboundScopeFilter,
  inboundOccurredAtRange,
  parseStocktakeScope,
  stocktakeScopeLabel,
} from './management-loop-stocktake.util'

describe('stocktake scope filters', () => {
  it('parses customer, inbound no and date range', () => {
    const scope = parseStocktakeScope({
      warehouseCode: ' WMS-JHB-01 ',
      mode: 'full',
      customerCode: ' ACME ',
      inboundNo: ' IN-100 ',
      inboundDateFrom: '2026-09-01',
      inboundDateTo: '2026-09-03',
    })
    expect(scope).toMatchObject({
      warehouseCode: 'WMS-JHB-01',
      mode: 'full',
      customerCode: 'ACME',
      inboundNo: 'IN-100',
      inboundDateFrom: '2026-09-01',
      inboundDateTo: '2026-09-03',
    })
    expect(hasInboundScopeFilter(scope)).toBe(true)
    expect(stocktakeScopeLabel(scope)).toBe('客户 ACME · 入库 IN-100 · 入库 2026-09-01 ~ 2026-09-03')
  })

  it('treats empty filters as unrestricted inventory', () => {
    expect(hasInboundScopeFilter(parseStocktakeScope({ warehouseCode: 'WMS-JHB-01', mode: 'full' }))).toBe(false)
  })

  it('builds +08:00 inbound time bounds', () => {
    const range = inboundOccurredAtRange('2026-09-01', '2026-09-01')
    expect(range?.gte?.toISOString()).toBe('2026-08-31T16:00:00.000Z')
    expect(range?.lte?.toISOString()).toBe('2026-09-01T15:59:59.999Z')
  })
})
