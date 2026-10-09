import test from 'node:test'
import assert from 'node:assert/strict'
import { buildInboundBoxLines, validateInboundBoxLines } from './inboundBoxLines.ts'

const input = { sku: ' SKU-1 ', name: '产品', boxCount: 3, qtyPerBox: 10, packType: '自带包装', stockType: '以仓库为准' }

test('one line per box with unique row IDs and per-box quantities', () => {
  const lines = buildInboundBoxLines([], input)
  assert.deepEqual(lines.map(line => [line.boxNo, line.sku, line.qty]), [[1, 'SKU-1', 10], [2, 'SKU-1', 10], [3, 'SKU-1', 10]])
  assert.equal(new Set(lines.map(line => line.id)).size, 3)
  assert.equal(lines.reduce((sum, line) => sum + line.qty, 0), 30)
})

test('continues after the maximum manually edited or imported box number', () => {
  const existing = buildInboundBoxLines([], input)
  existing[0].boxNo = 7
  existing.splice(1, 1)
  const added = buildInboundBoxLines(existing, { ...input, boxCount: 2 })
  assert.deepEqual(added.map(line => line.boxNo), [8, 9])
  assert.equal(existing.length, 2)
})

test('rejects missing SKU and invalid box counts or per-box quantities', () => {
  assert.throws(() => buildInboundBoxLines([], { ...input, sku: ' ' }), /SKU/)
  for (const invalid of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => buildInboundBoxLines([], { ...input, boxCount: invalid }), /箱数/)
    assert.throws(() => buildInboundBoxLines([], { ...input, qtyPerBox: invalid }), /每箱数量/)
  }
})

test('validates edited rows and permits different SKUs in one box', () => {
  const lines = buildInboundBoxLines([], input)
  lines[1] = { ...lines[1], boxNo: 1, sku: 'SKU-2', qty: 8 }
  assert.equal(validateInboundBoxLines(lines), undefined)
  lines[1].qty = 0
  assert.match(validateInboundBoxLines(lines)!, /第 2 行数量/)
  lines[1].qty = 8
  lines[1].boxNo = 1.5
  assert.match(validateInboundBoxLines(lines)!, /第 2 行箱号/)
  lines[1].boxNo = 1
  lines[1].sku = ''
  assert.match(validateInboundBoxLines(lines)!, /第 2 行.*SKU/)
})

test('rejects unsafe totals and excessively large additions', () => {
  assert.throws(() => buildInboundBoxLines([], { ...input, boxCount: 10001 }), /分次添加/)
  assert.throws(() => buildInboundBoxLines([], { ...input, qtyPerBox: Number.MAX_SAFE_INTEGER }), /超出支持范围/)
})
