import {
  buildCartonCode,
  buildInboundNo,
  buildOutboundNo,
  inboundNoFromScan,
  isOutboundDocNo,
  matchCartonByScan,
  nextSeqFromNos,
  parseWmsScan,
} from '@erp/shared/wms-doc-no'

describe('wms-doc-no', () => {
  const day = new Date('2026-09-10T12:00:00')

  it('builds 易仓-style inbound / outbound / carton codes', () => {
    expect(buildInboundNo('AFU0430', day, 2)).toBe('RVAFU0430-260910-0002')
    expect(buildOutboundNo('AFU0167', day, 5)).toBe('DOAFU0167-260910-0005')
    expect(buildCartonCode('RVAFU0430-260910-0002', 1)).toBe('RVAFU0430-260910-0001')
    expect(buildCartonCode('RVAFU0430-260910-0002', 2)).toBe('RVAFU0430-260910-0002')
    expect(buildCartonCode('RVFUR-260921-0001', 1)).toBe('RVFUR-260921-0001')
    expect(buildCartonCode('RVFUR-260921-0001', 3)).toBe('RVFUR-260921-0003')
    expect(buildCartonCode('RVAFU0430-260910-0002-1', 1)).toBe('RVAFU0430-260910-0001')
  })

  it('parses 易仓 and legacy scans without treating SKU as a document', () => {
    expect(parseWmsScan('RVAFU0430-260910-0002')?.kind).toBe('inbound_no')
    expect(parseWmsScan('IPIAFU010612609090003')?.kind).toBe('inbound_no')
    expect(parseWmsScan('RVAFU0430-260910-0002-1')).toEqual({
      kind: 'carton',
      value: 'RVAFU0430-260910-0002-1',
      inboundNo: 'RVAFU0430-260910-0002',
      boxSeq: 1,
    })
    expect(parseWmsScan('DOAFU0167-260910-0005')?.kind).toBe('outbound_no')
    expect(parseWmsScan('IN-20260819-0012')?.kind).toBe('inbound_no')
    expect(parseWmsScan('IN-20260819-0012-C001')?.kind).toBe('carton')
    expect(parseWmsScan('OUT-20260911001')?.kind).toBe('outbound_no')
    expect(parseWmsScan('AFU0430-719110')).toBeNull()
    expect(parseWmsScan('9902286486978')).toBeNull()
  })

  it('maps a carton scan back to the inbound no', () => {
    expect(inboundNoFromScan('RVAFU0430-260910-0002-4')).toBe('RVAFU0430-260910-0002')
    expect(inboundNoFromScan('RVAFU0430-260910-0002')).toBe('RVAFU0430-260910-0002')
  })

  it('matches cartons by 易仓 suffix or legacy -C001', () => {
    const cartons = [
      { boxCode: 'RVAFU0430-260910-0002-1', boxSeq: 1 },
      { boxCode: 'IN-OLD-C002', boxSeq: 2 },
    ]
    expect(matchCartonByScan(cartons, 'RVAFU0430-260910-0002-1', 'RVAFU0430-260910-0002')?.boxSeq).toBe(1)
    expect(matchCartonByScan(cartons, 'RVAFU0430-260910-0001', 'RVAFU0430-260910-0002')?.boxSeq).toBe(1)
    expect(matchCartonByScan(cartons, 'IN-OLD-C002', 'IN-OLD')?.boxSeq).toBe(2)
    expect(matchCartonByScan(cartons, 'RVAFU9999-260910-0001-1', 'RVAFU0430-260910-0002')).toBeNull()
  })

  it('allocates the next daily sequence', () => {
    expect(nextSeqFromNos(['RVAFU0430-260910-0002', 'RVAFU0430-260910-0001'], 'RVAFU0430-260910-')).toBe(3)
    expect(isOutboundDocNo('DOAFU0167-260910-0005')).toBe(true)
    expect(isOutboundDocNo('OUT-20260706001')).toBe(true)
    expect(isOutboundDocNo('IN-20260706001')).toBe(false)
  })
})
