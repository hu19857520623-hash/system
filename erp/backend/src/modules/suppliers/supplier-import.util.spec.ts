import { parseSupplierImportCsv } from './supplier-import.util'

const header = '供应商代码,供应商名称,公司名称,地址,联系人,电话,邮箱,城市,国家,结算方式,账期天数,备注'

describe('供应商导入解析', () => {
  it('读取公司名称、地址和供应商代码', () => {
    const parsed = parseSupplierImportCsv([
      header,
      'SUP-001,宁波百晟,宁波百晟钣金制造有限公司,宁波市鄞州区,黄钰涵,13800001111,buyer@example.com,宁波,中国,月结,15,钣金',
    ].join('\n'))
    expect(parsed.failureCount).toBe(0)
    expect(parsed.rows[0]).toMatchObject({
      supplierCode: 'SUP-001',
      supplierName: '宁波百晟',
      companyName: '宁波百晟钣金制造有限公司',
      address: '宁波市鄞州区',
      contactName: '黄钰涵',
      paymentTerms: '月结',
      leadTimeDays: 15,
    })
  })

  it('缺少供应商名称的行记为失败', () => {
    const parsed = parseSupplierImportCsv([
      header,
      ', ,公司,地址,联系人,13800001111,,,,,,',
    ].join('\n'))
    expect(parsed.rows).toHaveLength(0)
    expect(parsed.failures[0].reason).toContain('供应商名称不能为空')
  })

  it('同一文件里的供应商代码不能重复', () => {
    const row = 'SUP-001,供应商甲,公司甲,地址,联系人,13800001111,,,,,,'
    const parsed = parseSupplierImportCsv([header, row, 'SUP-001,供应商乙,公司乙,地址,联系人,13800002222,,,,,,'].join('\n'))
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.failures[0].reason).toContain('供应商代码重复')
  })
})
