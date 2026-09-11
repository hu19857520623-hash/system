import { code128SymbolValues, code128Widths, sanitizeCode128Text } from '@erp/shared/code128'

describe('code128', () => {
  it('starts with Code 128-B and ends with STOP', () => {
    const values = code128SymbolValues('RVAFU0002-260413-0001')
    expect(values[0]).toBe(104)
    expect(values[values.length - 1]).toBe(106)
    expect(values.length).toBe('RVAFU0002-260413-0001'.length + 3)
  })

  it('replaces non-ascii characters so warehouse scans stay Code 128-B', () => {
    expect(sanitizeCode128Text('箱唛A')).toBe('--A')
    expect(code128Widths('A').length).toBeGreaterThan(10)
  })
})
