import assert from 'node:assert/strict'
import test from 'node:test'
import { mapCsvRows, parseCsv } from './csvImportExport'
import { INBOUND_LINE_COLUMNS, INBOUND_ORDER_COLUMNS, parseInboundLines, parseInboundOrders } from './importTemplates'

const valid = { inboundType: '自发头程', delivery: '自送', sku: 'TEST-SKU', qty: '2', _sourceLineNo: '8' }

for (const [name, parse] of [['入库明细', parseInboundLines], ['预约单', parseInboundOrders]] as const) {
  test(`${name}拒绝小数、非数字、越界和非正数量，保留中文原因及源文件行号`, () => {
    for (const qty of ['0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992']) {
      const result = parse([{ ...valid, qty }])
      assert.equal(result.data.length, 0, qty)
      assert.match(result.errors.join(''), /数量必须为正整数/)
      assert.equal(result.failures?.[0].lineNo, 8)
    }
  })

  test(`${name}区分未填箱号与错误箱号，不悄悄替换零或无效内容`, () => {
    for (const boxNo of ['0', '-1', '1.5', 'abc', '9007199254740992']) {
      const result = parse([{ ...valid, boxNo }])
      assert.equal(result.data.length, 0, boxNo)
      assert.match(result.errors.join(''), /箱号必须为正整数/)
    }
    assert.equal(parse([{ ...valid, boxNo: '' }]).errors.length, 0)
  })

  test(`${name}拒绝缺失商品、错误包装和错误库存类型`, () => {
    for (const [patch, message] of [
      [{ sku: ' ' }, /请填写 SKU/],
      [{ packType: 'other' }, /包装类型须为/],
      [{ stockType: 'other' }, /箱库存类型须为/],
    ] as const) {
      const result = parse([{ ...valid, ...patch }])
      assert.equal(result.data.length, 0)
      assert.match(result.errors.join(''), message)
    }
  })
}

test('预约单混合导入仅保留有效行，错误分组不产生空预约单', () => {
  const result = parseInboundOrders([
    { ...valid, qty: '1.5', referenceNo: 'INVALID', _sourceLineNo: '2' },
    { ...valid, sku: ' TEST-SKU ', boxNo: '', referenceNo: 'VALID', _sourceLineNo: '3' },
    { ...valid, sku: 'SECOND', boxNo: '', referenceNo: 'VALID', _sourceLineNo: '4' },
  ])
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].referenceNo, 'VALID')
  assert.deepEqual(result.data[0].lines.map(row => [row.sku, row.qty, row.boxNo]), [['TEST-SKU', 2, 1], ['SECOND', 2, 2]])
  assert.equal(result.failures?.[0].lineNo, 2)
})

test('真实 CSV 列映射后，两种入库导入都拒绝模板所不允许的小数数量', () => {
  const lines = mapCsvRows(parseCsv('SKU*,数量*\nTEST-SKU,0.5'), INBOUND_LINE_COLUMNS)
  assert.equal(lines.errors.length, 0)
  assert.match(parseInboundLines(lines.records).errors.join(''), /数量必须为正整数/)
  const orders = mapCsvRows(parseCsv('入库类型*,交货方式*,SKU*,数量*\n自发头程,自送,TEST-SKU,0.5'), INBOUND_ORDER_COLUMNS)
  assert.equal(orders.errors.length, 0)
  assert.match(parseInboundOrders(orders.records).errors.join(''), /数量必须为正整数/)
})
