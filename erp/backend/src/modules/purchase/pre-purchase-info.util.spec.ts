import { toCsv } from '../../common/csv.util'
import { infoCsv, validInfoRow } from './pre-purchase-info.test-helper'
import { exportPrePurchaseInfo, parsePrePurchaseInfo, PRE_PURCHASE_INFO_COLUMNS, PrePurchaseInfoValidationException } from './pre-purchase-info.util'

function failures(content: string) {
  try { parsePrePurchaseInfo(content) } catch (error) {
    if (error instanceof PrePurchaseInfoValidationException) return error.failures
    throw error
  }
  throw new Error('Expected field validation errors')
}

describe('预采购信息文件必填和字段审核', () => {
  it('导出三张单及必填、只读标记，第二行直接是第一张单，无填写说明', () => {
    const exported = exportPrePurchaseInfo([1, 2, 3].map(index => validInfoRow(index)))
    expect(exported.headers).toContain('预采购单号（必填）')
    expect(exported.headers).toContain('供应商（必填）')
    expect(exported.headers).toContain('状态（只读）')
    expect(exported.rows).toHaveLength(3)
    expect(exported.rows[0][0]).toBe('PRE-1')
    expect(exported.total).toBe(3)
    expect(parsePrePurchaseInfo(toCsv(exported.headers, exported.rows)).map(line => line.prePoNo)).toEqual(['PRE-1', 'PRE-2', 'PRE-3'])
  })

  it('所有字段往返，包括多行备注、引号、电话前导零、零值、否和三位小数', () => {
    const item = validInfoRow()
    for (const column of PRE_PURCHASE_INFO_COLUMNS.filter(column => !column.readonly && !column.required)) {
      item[column.key] = column.kind === 'boolean' ? false : column.kind === 'date' ? '2026-10-27' : column.kind ? 1 : '资料'
      if (column.key.endsWith('Url') || column.key === 'productLink') item[column.key] = 'https://example.com/item'
    }
    Object.assign(item, { supplierContactPhone: '013800000001', packageWeightKg: 1.234, domesticFreight: 0, spareCartonQty: 0, remark: '第一行,"含引号"\n第二行\r\n第三行' })
    const exported = exportPrePurchaseInfo([item])
    const [parsed] = parsePrePurchaseInfo(toCsv(exported.headers, exported.rows))
    const { prePoNo: _prePoNo, ...data } = item
    expect(parsed.data).toEqual(data)
  })

  it('一次返回多行多个字段的错误和填写值，数据从第二行开始', () => {
    const exported = exportPrePurchaseInfo([
      { ...validInfoRow(1), supplierName: '', unitPrice: -2, plannedQty: 1.5 },
      { ...validInfoRow(2), productName: '', packageLengthCm: 0 },
    ])
    const errors = failures(toCsv(exported.headers, exported.rows))
    expect(errors).toHaveLength(5)
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ lineNo: 2, prePoNo: 'PRE-1', field: '供应商', value: '', reason: '必填，不能为空' }),
      expect.objectContaining({ lineNo: 2, field: '单价', value: '-2' }),
      expect.objectContaining({ lineNo: 2, field: '计划数量', value: '1.5' }),
      expect.objectContaining({ lineNo: 3, field: '商品名称', value: '' }),
      expect.objectContaining({ lineNo: 3, field: '包装长(cm)', value: '0' }),
    ]))
  })

  it.each(PRE_PURCHASE_INFO_COLUMNS.filter(column => column.required).map(column => [column.key, column.label]))('必填项 %s 为空时明确提示', (key, label) => {
    expect(failures(infoCsv([{ [key]: '' }]))).toEqual(expect.arrayContaining([expect.objectContaining({ field: label, value: '', reason: '必填，不能为空' })]))
  })

  it.each([
    ['unitPrice', '0', '大于零'], ['unitPrice', '-1', '有效'], ['unitPrice', '1.234', '小数'],
    ['plannedQty', '1.1', '整数'], ['plannedQty', '2147483648', '最大'], ['unitPrice', 'Infinity', '有效'],
    ['taxRate', 101, '100'], ['invoiceTaxRate', -1, '不小于零'], ['productLengthCm', 1000000, '最大'],
    ['expectedArrival', '2026-02-30', '有效的 YYYY-MM-DD'], ['doubleLayerCarton', '不确定', '填写是或否'],
    ['productLink', 'javascript:alert(1)', 'http://'], ['manualUrl', '不是链接', 'http://'],
    ['productName', '长'.repeat(301), '300 字'],
  ])('审核字段 %s 的错误值', (key, value, message) => {
    expect(failures(infoCsv([{ [key]: value }])).some(item => item.reason.includes(message))).toBe(true)
  })

  it('空白选填项保留原值，只读字段不进入更新内容', () => {
    const [line] = parsePrePurchaseInfo(infoCsv([{ remark: '', status: 'confirmed', purchaserName: '其他人', productVolumeCbm: 999, linkedPoNo: 'PO-FAKE', domesticFreight: 0, doubleLayerCarton: '否' }]))
    expect(line.data).toMatchObject({ domesticFreight: 0, doubleLayerCarton: false })
    for (const key of ['remark', 'status', 'purchaserName', 'productVolumeCbm', 'linkedPoNo']) expect(line.data).not.toHaveProperty(key)
  })

  it('重复单号和重复 SKU 提示具体行号', () => {
    const errors = failures(infoCsv([{ prePoNo: 'PRE-1', sku: 'SKU-1' }, { prePoNo: 'pre-1', sku: 'sku-1' }]))
    expect(errors).toHaveLength(2)
    expect(errors[0]).toMatchObject({ lineNo: 3, field: '预采购单号' })
    expect(errors[1]).toMatchObject({ lineNo: 3, field: 'SKU' })
  })

  it('体积超限明确提示长宽高和单位', () => {
    const errors = failures(infoCsv([{ productLengthCm: 999999, productWidthCm: 999999, productHeightCm: 999999 }]))
    expect(errors[0]).toMatchObject({ field: '商品长宽高', reason: expect.stringContaining('厘米单位') })
  })

  it('空白行不会使后面错误的表格行号偏移', () => {
    const csv = infoCsv([{ unitPrice: -1 }]).replace('\n', '\n\n')
    expect(failures(csv)[0]).toMatchObject({ lineNo: 3, field: '单价' })
  })

  it.each([
    ['', '请选择'], ['SKU,单价\nSKU-1,2', '预采购单号'], ['预采购单号,单价\nPRE-1,2', '缺少必填列'],
    ['预采购单号,单价,unitPrice\nPRE-1,2,3', '重复的表头'], ['预采购单号,未知列\nPRE-1,2', '无法识别的表头'],
    ['预采购单号,备注\nPRE-1,"未闭合', '引号未闭合'],
  ])('拒绝结构错误文件', (content, message) => { expect(() => parsePrePurchaseInfo(content)).toThrow(message) })

  it('超过批量上限时不截断导入', () => {
    expect(() => parsePrePurchaseInfo(infoCsv(Array.from({ length: 501 }, (_, index) => validInfoRow(index + 1))))).toThrow('最多导入 500')
  })

  it('无供应商不导出占位符，日期采用日期值', () => {
    const result = exportPrePurchaseInfo([{ ...validInfoRow(), supplierName: '—', expectedArrival: new Date('2026-10-27T00:00:00Z') }])
    expect(result.rows[0][result.headers.indexOf('供应商（必填）')]).toBe('')
    expect(result.rows[0][result.headers.indexOf('预计到货')]).toBe('2026-10-27')
  })
})
