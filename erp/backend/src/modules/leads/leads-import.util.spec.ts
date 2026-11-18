import { parseLeadsImportCsv } from './leads-import.util'
import type { ImportRowFailure } from '../../common/import-row-result.util'

describe('parseLeadsImportCsv', () => {
  it('parses columns aligned with manual lead creation form', () => {
    const csv = [
      '线索编号,客户名称,联系方式,电话,来源,归属运营,跟进销售,备注',
      ',示例公司,张三,13800138000,Takealot,sales01,陈琪珍,',
      'LD-001,开普敦贸易,李四,0821234567,展会,,,重点',
    ].join('\n')
    const rows = parseLeadsImportCsv(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      companyName: '示例公司',
      contactName: '张三',
      contactPhone: '13800138000',
      source: 'Takealot',
      assigneeKey: 'sales01',
      followSales: '陈琪珍',
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

  it('reports nonempty rows missing required fields at their original row numbers', () => {
    const failures: ImportRowFailure[] = []
    const csv = '客户名称 *,联系人＊,备注\n\n,,待补\n仅公司,\n有联系,王五'
    expect(parseLeadsImportCsv(csv, failures)).toHaveLength(1)
    expect(failures.map(({ lineNo, field }) => [lineNo, field])).toEqual([[3, '客户名称'], [3, '联系方式'], [4, '联系方式']])
    expect(() => parseLeadsImportCsv('客户名称\n公司')).toThrow('联系方式')
  })

  it('accepts the legacy 联系人 header as 联系方式', () => {
    const csv = '客户名称,联系人,电话\n示例公司,张三,13800138000'
    expect(parseLeadsImportCsv(csv)).toEqual([
      expect.objectContaining({ companyName: '示例公司', contactName: '张三', contactPhone: '13800138000' }),
    ])
  })
})
