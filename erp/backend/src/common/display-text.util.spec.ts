import { readableDisplayText } from './display-text.util'

describe('readableDisplayText', () => {
  it('keeps valid text', () => {
    expect(readableDisplayText('真实客户', 'TKL001')).toBe('真实客户')
    expect(readableDisplayText('A?B', 'TKL001')).toBe('A?B')
  })

  it('falls back for empty or historically corrupted text', () => {
    expect(readableDisplayText('', 'TKL001')).toBe('TKL001')
    expect(readableDisplayText('OMS??????', 'TKL001')).toBe('TKL001')
    expect(readableDisplayText('名称\uFFFD', 'TKL001')).toBe('TKL001')
  })
})
