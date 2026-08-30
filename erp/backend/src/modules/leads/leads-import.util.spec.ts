import { parseLeadsImportCsv } from './leads-import.util'

describe('parseLeadsImportCsv', () => {
  it('parses columns aligned with manual lead creation form', () => {
    const csv = [
      '线索编号,客户名称,联系方式,电话,来源,归属运营,备注',
      ',示例公司,张三,13800138000,Takealot,sales01,',
      'LD-001,开普敦贸易,李四,0821234567,展会,,重点',
    ].join('\n')
    const rows = parseLeadsImportCsv(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      companyName: '示例公司',
      contactName: '张三',
      contactPhone: '13800138000',
      source: 'Takealot',
      assigneeKey: 'sales01',
    })
    expect(rows[1]).toMatchObject({
      leadNo: 'LD-001',
      companyName: '开普敦贸易',
      contactName: '李四',
      source: '展会',
      remark: '重点',
    })
  })

  it('requires 客户名称 column', () => {
    expect(() => parseLeadsImportCsv('联系人,电话\n张三,138')).toThrow('客户名称')
  })

  it('skips rows without contact name', () => {
    const csv = '客户名称,联系人\n仅公司,\n有联系,王五'
    expect(parseLeadsImportCsv(csv)).toHaveLength(1)
  })

  it('accepts the legacy 联系人 header as 联系方式', () => {
    const csv = '客户名称,联系人,电话\n示例公司,张三,13800138000'
    expect(parseLeadsImportCsv(csv)).toEqual([
      expect.objectContaining({ companyName: '示例公司', contactName: '张三', contactPhone: '13800138000' }),
    ])
  })
})
