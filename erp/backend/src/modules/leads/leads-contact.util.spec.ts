import {
  buildLeadContactIndex,
  collectLeadContactKeys,
  findIndexedLeadContactConflict,
  leadContactDuplicateMessage,
  normalizeLeadContactKey,
  prepareLeadContact,
  rememberLeadContacts,
  rememberQrLead,
  sameCompanyQrMessage,
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

  it('does not treat a QR placeholder as a contact key', () => {
    expect(collectLeadContactKeys('二维码')).toEqual([])
    expect(collectLeadContactKeys('微信二维码', '无')).toEqual([])
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

describe('prepareLeadContact', () => {
  it('keeps phone and wechat values unique and rejects a QR word as a wechat id', () => {
    expect(prepareLeadContact({ contactType: 'phone', contact: '138-0013-8000' })).toMatchObject({
      contactType: 'phone',
      contactPhone: '138-0013-8000',
    })
    expect(prepareLeadContact({ contactType: 'wechat', contact: 'Wxid_A' })).toMatchObject({
      contactType: 'wechat',
      contactName: 'Wxid_A',
      contactPhone: null,
    })
    expect(() => prepareLeadContact({ contactType: 'wechat', contact: '二维码' })).toThrow('微信号')
  })

  it('accepts a QR note or image, and a bare placeholder only when import allows it', () => {
    expect(prepareLeadContact({ contactType: 'qrcode', contact: '阿花' })).toMatchObject({
      contactType: 'qrcode',
      contactName: '阿花',
    })
    expect(prepareLeadContact({ contactType: 'qrcode', contact: '二维码', hasQrImage: true })).toMatchObject({
      contactName: null,
    })
    expect(() => prepareLeadContact({ contactType: 'qrcode', contact: '二维码' })).toThrow('请上传二维码')
    expect(prepareLeadContact({ contact: '二维码' }, { allowQrPlaceholder: true })).toMatchObject({
      contactType: 'qrcode',
      contactName: null,
    })
  })

  it('does not index QR notes, and warns when the company already has a QR lead', () => {
    const index = buildLeadContactIndex([
      { contactType: 'qrcode', contactName: '阿花', contactPhone: null, leadNo: 'LD-1', companyName: '甲公司' },
    ])
    expect(findIndexedLeadContactConflict(index, '阿花', undefined, 'qrcode')).toBeNull()
    expect(findIndexedLeadContactConflict(index, '阿花')).toBeNull()
    const companies = new Map()
    rememberQrLead(companies, new Map(), {
      contactType: 'qrcode', contactName: '阿花', companyName: '甲公司', leadNo: 'LD-1',
    })
    expect(sameCompanyQrMessage(companies.get('甲公司'))).toBe('可能是同一客户（LD-1 / 甲公司），确认后仍可保存')
  })
})
