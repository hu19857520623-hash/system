import {
  asWcsString,
  buildWcsWeighReply,
  decodeJpegBase64,
  deviceKeyAccepted,
  extractWcsImagePayload,
  normalizeWcsWeighBody,
  previewWmsOutputs,
  validateWcsWeighItem,
  type WcsWeighItem,
} from './wcs-weigh.util'

describe('normalizeWcsWeighBody', () => {
  it('accepts a Python-client object and stringifies numeric extras', () => {
    const items = normalizeWcsWeighBody({
      ticketsNum: '12345',
      weight: '1.000',
      length: '1.0',
      width: '1.0',
      height: '1.0',
      volume: '0.0',
      machine: 'OOPS-DWS-01',
      goodsnum: 1,
    })
    expect(items).toHaveLength(1)
    expect(items[0].ticketsNum).toBe('12345')
    expect(items[0].goodsnum).toBe('1')
    expect(items[0].memberno).toBe('')
  })

  it('accepts a root array', () => {
    const items = normalizeWcsWeighBody([
      { ticketsNum: 'A', weight: '1', machine: 'M1' },
      { ticketsNum: 'B', weight: '2', machine: 'M1' },
    ])
    expect(items.map((x) => x.ticketsNum)).toEqual(['A', 'B'])
  })

  it('ignores non-objects', () => {
    expect(normalizeWcsWeighBody([null, 'x', { ticketsNum: 'A' }])).toHaveLength(1)
  })
})

describe('validateWcsWeighItem', () => {
  const base: WcsWeighItem = {
    ticketsNum: '1',
    weight: '1',
    length: '',
    width: '',
    height: '',
    volume: '',
    machine: 'AH',
    memberno: '',
    warehouse: '',
    goodsname: '',
    goodsnum: '',
    expressname: '',
    myremarks: '',
  }

  it('requires ticketsNum, weight and machine', () => {
    expect(validateWcsWeighItem({ ...base, ticketsNum: '' })).toMatch(/ticketsNum/)
    expect(validateWcsWeighItem({ ...base, weight: '' })).toMatch(/weight/)
    expect(validateWcsWeighItem({ ...base, machine: '' })).toMatch(/machine/)
    expect(validateWcsWeighItem(base)).toBeNull()
  })
})

describe('buildWcsWeighReply', () => {
  it('uses string booleans required by the device spec', () => {
    expect(buildWcsWeighReply({ ok: true, message: 'A1' })).toEqual({
      result: 'true',
      message: 'A1',
    })
    expect(buildWcsWeighReply({ ok: false, message: 'bad' }).result).toBe('false')
  })

  it('attaches printdata only on success', () => {
    const ok = buildWcsWeighReply({ ok: true, message: '', printData: '{"x":1}' })
    expect(ok.printdata).toBe('{"x":1}')
    const fail = buildWcsWeighReply({ ok: false, message: 'bad', printData: '{"x":1}' })
    expect(fail.printdata).toBeUndefined()
  })
})

describe('deviceKeyAccepted', () => {
  it('allows all traffic when no key is configured', () => {
    expect(deviceKeyAccepted('', 'anything')).toBe(true)
    expect(deviceKeyAccepted(null, '')).toBe(true)
  })

  it('requires an exact match when a key is set', () => {
    expect(deviceKeyAccepted('secret', 'secret')).toBe(true)
    expect(deviceKeyAccepted('secret', 'other')).toBe(false)
    expect(deviceKeyAccepted('secret', '')).toBe(false)
  })
})

describe('extractWcsImagePayload', () => {
  it('reads document fields and common aliases', () => {
    expect(extractWcsImagePayload({ expressNo: 'A1', file: 'abc' })).toEqual({
      expressNo: 'A1',
      file: 'abc',
    })
    expect(extractWcsImagePayload({ ExpressNo: 'B2', File: 'xyz' })).toEqual({
      expressNo: 'B2',
      file: 'xyz',
    })
    expect(extractWcsImagePayload([{ ticketsNum: 'C3', img: 'p' }])).toEqual({
      expressNo: 'C3',
      file: 'p',
    })
  })
})

describe('decodeJpegBase64', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9])

  it('accepts a JPEG payload and strips a data URL prefix', () => {
    const encoded = jpeg.toString('base64')
    expect(decodeJpegBase64(encoded).error).toBeNull()
    expect(decodeJpegBase64(`data:image/jpeg;base64,${encoded}`).buffer.equals(jpeg)).toBe(true)
  })

  it('rejects empty or non-jpeg payloads', () => {
    expect(decodeJpegBase64('').error).toMatch(/不能为空/)
    expect(decodeJpegBase64(Buffer.from('hello').toString('base64')).error).toMatch(/JPEG/)
  })
})

describe('previewWmsOutputs', () => {
  it('matches the document success example when chute is empty', () => {
    expect(previewWmsOutputs({ chuteMessage: '', requireMemberId: false }).weighSuccess).toEqual({
      result: 'true',
      message: '',
    })
  })

  it('matches the document Member ID popup example', () => {
    expect(previewWmsOutputs({ chuteMessage: 'A1', requireMemberId: true }).weighSuccess).toEqual({
      result: 'true',
      message: 'Member ID',
    })
  })

  it('returns image isOk as number 1', () => {
    expect(previewWmsOutputs({}).imageOk).toEqual({ isOk: 1 })
  })
})

describe('asWcsString', () => {
  it('trims and stringifies', () => {
    expect(asWcsString('  a  ')).toBe('a')
    expect(asWcsString(12)).toBe('12')
    expect(asWcsString(null)).toBe('')
  })
})
