import { describe, expect, it } from 'vitest'
import { inferLeadContactType, isSameCompanyQrPrompt, leadContactInputValue } from './leadContact.ts'

describe('lead contact type', () => {
  it('infers a phone, a wechat id, and a QR placeholder', () => {
    expect(inferLeadContactType({ contactName: '13800138000' })).toBe('phone')
    expect(inferLeadContactType({ contactName: 'wxid_a' })).toBe('wechat')
    expect(inferLeadContactType({ contactName: '二维码' })).toBe('qrcode')
    expect(inferLeadContactType({ contactType: 'other', contactName: 'a@b.c' })).toBe('other')
  })

  it('leaves the QR note empty when the stored text is only the placeholder', () => {
    expect(leadContactInputValue({ contactName: '二维码' })).toBe('')
    expect(leadContactInputValue({ contactType: 'qrcode', contactName: '阿花' })).toBe('阿花')
  })

  it('recognizes the same-company confirmation', () => {
    expect(isSameCompanyQrPrompt('可能是同一客户（LD-1 / 甲），确认后仍可保存')).toBe(true)
    expect(isSameCompanyQrPrompt('该联系方式已存在')).toBe(false)
  })
})
