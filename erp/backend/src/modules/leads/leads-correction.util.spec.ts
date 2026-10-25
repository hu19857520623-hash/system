import { leadContactDisplay, planLeadCorrection } from './leads-correction.util'

const existing = {
  companyName: '甲公司',
  contactName: '13800138000',
  contactPhone: '13800138000',
  email: null,
  source: '抖音',
  remark: '对接:刘海静 | 原备注',
}

describe('planLeadCorrection', () => {
  it('keeps an unchanged contact and ignores the import prefix in remarks', () => {
    const planned = planLeadCorrection(existing, {
      companyName: '甲公司',
      contact: '13800138000',
      email: '',
      source: '抖音',
      remark: '原备注',
    })
    expect(planned.changes).toEqual([])
    expect(planned.contactPhone).toBe('13800138000')
    expect(planned.remark).toBe(existing.remark)
  })

  it('records only the fields that changed and clears a phone replaced by WeChat', () => {
    const planned = planLeadCorrection(existing, {
      companyName: '乙公司',
      contact: 'wxid_a',
      email: 'a@b.c',
      source: '视频号',
      remark: '改过',
    })
    expect(planned.contactName).toBe('wxid_a')
    expect(planned.contactPhone).toBeNull()
    expect(planned.changes.map((change) => change.field)).toEqual([
      'companyName', 'contact', 'email', 'source', 'remark',
    ])
    expect(planned.changes.find((change) => change.field === 'contact')).toEqual({
      field: 'contact',
      label: '联系方式',
      before: '13800138000',
      after: 'wxid_a',
    })
  })

  it('rejects an unknown source and a duplicate placeholder is still a normal contact string', () => {
    expect(() => planLeadCorrection(existing, {
      companyName: '甲公司',
      contact: '13800138000',
      source: '微信视频号',
      remark: '原备注',
    })).toThrow('来源渠道无效')
  })

  it('keeps a historical source that is no longer in the option list', () => {
    const planned = planLeadCorrection(
      { ...existing, source: '老渠道' },
      { companyName: '甲公司', contact: '13800138000', source: '老渠道', remark: '原备注' },
    )
    expect(planned.changes).toEqual([])
    expect(planned.source).toBe('老渠道')
  })

  it('requires a company name and a contact', () => {
    expect(() => planLeadCorrection(existing, { companyName: '  ', contact: '13800138000' })).toThrow('请填写客户名称')
    expect(() => planLeadCorrection(existing, { companyName: '甲公司', contact: '' })).toThrow('请填写联系方式')
  })
})

describe('leadContactDisplay', () => {
  it('shows one value when the name and phone are the same', () => {
    expect(leadContactDisplay({ contactName: '13800138000', contactPhone: '13800138000', companyName: '甲' })).toBe('13800138000')
  })
})
