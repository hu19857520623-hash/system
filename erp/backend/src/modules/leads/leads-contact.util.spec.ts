import {
  buildLeadContactIndex,
  collectLeadContactKeys,
  findIndexedLeadContactConflict,
  leadContactDuplicateMessage,
  normalizeLeadContactKey,
  rememberLeadContacts,
} from './leads-contact.util'

describe('normalizeLeadContactKey', () => {
  it('returns empty for blank values', () => {
    expect(normalizeLeadContactKey('')).toBe('')
    expect(normalizeLeadContactKey('   ')).toBe('')
    expect(normalizeLeadContactKey(null)).toBe('')
  })

  it('normalizes phone punctuation and spaces', () => {
    expect(normalizeLeadContactKey('138 0013 8000')).toBe('13800138000')
    expect(normalizeLeadContactKey('138-0013-8000')).toBe('13800138000')
    expect(normalizeLeadContactKey('+27 82 123 4567')).toBe('27821234567')
  })

  it('lowercases non-phone contacts such as WeChat ids', () => {
    expect(normalizeLeadContactKey('Wxid_Hello')).toBe('wxid_hello')
    expect(normalizeLeadContactKey('张三')).toBe('张三')
  })
})

describe('collectLeadContactKeys', () => {
  it('dedupes name and phone when they are the same number', () => {
    expect(collectLeadContactKeys('138-0013-8000', '13800138000')).toEqual(['13800138000'])
  })

  it('keeps both wechat and phone', () => {
    expect(collectLeadContactKeys('Wxid_A', '13800138000').sort()).toEqual(['13800138000', 'wxid_a'])
  })
})

describe('lead contact index', () => {
  it('detects a conflict against an existing lead', () => {
    const index = buildLeadContactIndex([
      { contactName: '138 0013 8000', contactPhone: null, leadNo: 'LD-1', companyName: '甲公司' },
    ])
    expect(findIndexedLeadContactConflict(index, '13800138000', undefined)).toEqual({
      leadNo: 'LD-1',
      companyName: '甲公司',
    })
  })

  it('does not conflict on empty contact', () => {
    const index = buildLeadContactIndex([{ contactName: '', contactPhone: null, leadNo: 'LD-1' }])
    expect(findIndexedLeadContactConflict(index, '', undefined)).toBeNull()
  })

  it('catches a duplicate later in the same import batch', () => {
    const index = buildLeadContactIndex([])
    rememberLeadContacts(index, 'wxid_a', undefined, { leadNo: 'LD-new', companyName: '乙' })
    expect(findIndexedLeadContactConflict(index, 'WXID_A', undefined)).toEqual({
      leadNo: 'LD-new',
      companyName: '乙',
    })
  })
})

describe('leadContactDuplicateMessage', () => {
  it('includes lead no and company when present', () => {
    expect(leadContactDuplicateMessage({ leadNo: 'LD-1', companyName: '甲公司' })).toBe(
      '该联系方式已存在（LD-1 / 甲公司）',
    )
  })

  it('falls back to a short message', () => {
    expect(leadContactDuplicateMessage()).toBe('该联系方式已存在')
  })
})
