import { toCsv } from '../../common/csv.util'
import { exportPrePurchaseInfo, parsePrePurchaseInfo, PRE_PURCHASE_INFO_COLUMNS } from './pre-purchase-info.util'

describe('预采购信息文件', () => {
  it('同一份导出文件带出三张单，修改后仍按原单号匹配', () => {
    const items = [1, 2, 3].map(id => ({ prePoNo: `PRE-${id}`, sku: `SKU-${id}`, productName: `商品${id}`, plannedQty: id, unitPrice: 0, status: 'assigned' }))
    const exported = exportPrePurchaseInfo(items)
    const parsed = parsePrePurchaseInfo(toCsv(exported.headers, exported.rows))
    expect(exported.total).toBe(3)
    expect(parsed.map(line => line.prePoNo)).toEqual(['PRE-1', 'PRE-2', 'PRE-3'])
    expect(parsed[0].data).toEqual({ sku: 'SKU-1', productName: '商品1', plannedQty: 1, unitPrice: 0 })
  })

  it('所有可编辑字段均能往返，包括引号、逗号、多行备注、日期、零值和否', () => {
    const item: Record<string, any> = { prePoNo: 'PRE-ROUNDTRIP' }
    for (const column of PRE_PURCHASE_INFO_COLUMNS.filter(column => !column.readonly)) {
      item[column.key] = column.kind === 'boolean' ? false : column.kind === 'date' ? '2026-10-27T00:00:00.000Z' : column.kind ? 1 : '资料'
    }
    Object.assign(item, { supplierContactPhone: '013800000001', packageWeightKg: 1.234, spareCartonQty: 0, remark: '第一行,"含引号"\n第二行\r\n第三行' })
    const exported = exportPrePurchaseInfo([item])
    const [parsed] = parsePrePurchaseInfo(toCsv(exported.headers, exported.rows))
    const { prePoNo: _prePoNo, ...data } = item
    expect(parsed.data).toEqual({ ...data, expectedArrival: '2026-10-27' })
  })

  it('支持 BOM、CRLF、列顺序调整和仅导入部分字段；空白保留原值', () => {
    expect(parsePrePurchaseInfo('\uFEFF单价,备注,预采购单号,SKU\r\n0,,PRE-1,\r\n')[0].data).toEqual({ unitPrice: 0 })
  })

  it('只读信息不能修改状态、采购员、体积或关联单据', () => {
    const [line] = parsePrePurchaseInfo('预采购单号,备注,状态,采购员,商品体积(m³),关联采购单号\nPRE-1,修改,confirmed,他人,999,PO-FAKE')
    expect(line.data).toEqual({ remark: '修改' })
  })

  it.each([
    ['', '请选择'],
    ['SKU,单价\nSKU-1,2', '预采购单号'],
    ['预采购单号,单价\n,2', '单号不能为空'],
    ['预采购单号,单价\nPRE-1,2\nPRE-1,3', '单号重复'],
    ['预采购单号,单价,unitPrice\nPRE-1,2,3', '重复的表头'],
    ['预采购单号,单价,未知列\nPRE-1,2,3', '无法识别的表头'],
    ['预采购单号,单价\nPRE-1,-1', '第 2 行'],
    ['预采购单号,计划数量\nPRE-1,0', '大于零'],
    ['预采购单号,计划数量\nPRE-1,1.1', '整数'],
    ['预采购单号,单价\nPRE-1,1.234', '小数'],
    ['预采购单号,计划数量\nPRE-1,2147483648', '有效'],
    ['预采购单号,单价\nPRE-1,Infinity', '有效'],
    ['预采购单号,商品长(cm)\nPRE-1,1000000', '有效'],
    ['预采购单号,税率\nPRE-1,1000', '有效'],
    ['预采购单号,预计到货\nPRE-1,2026-02-30', '有效的 YYYY-MM-DD'],
    ['预采购单号,双层纸箱\nPRE-1,不确定', '填写是或否'],
    ['预采购单号,单价\nPRE-1,', '没有可更新'],
    ['预采购单号,单价\nPRE-1,1,多余列', '列数'],
    ['预采购单号,备注\nPRE-1,"未闭合', '引号未闭合'],
  ])('拒绝错误数据：%s', (content, message) => {
    expect(() => parsePrePurchaseInfo(content)).toThrow(message)
  })

  it('拒绝超过批量上限的文件', () => {
    expect(() => parsePrePurchaseInfo(`预采购单号,单价\n${Array.from({ length: 501 }, (_, index) => `PRE-${index},1`).join('\n')}`)).toThrow('最多导入 500')
  })

  it('无供应商和空值不导出占位符，日期采用日期值', () => {
    const result = exportPrePurchaseInfo([{ prePoNo: 'PRE-1', supplierName: '—', expectedArrival: new Date('2026-10-27T00:00:00Z') }])
    expect(result.rows[0][result.headers.indexOf('供应商')]).toBe('')
    expect(result.rows[0][result.headers.indexOf('预计到货')]).toBe('2026-10-27')
  })
})
