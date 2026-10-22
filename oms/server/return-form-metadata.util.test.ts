import assert from 'node:assert/strict'
import test from 'node:test'
import { readReturnFormMetadata, writeReturnFormMetadata, ReturnFormValidationError } from './return-form-metadata.util.js'

const form = { remark: '中文备注 | "引号"\n第二行', returnPlatform: 'takealot', takealotReturnDetails: {
  filledBy: ' 测试填写人 ', department: '售后部', selfRecall: 'no', inboundPoNumber: 'AUDIT-PO-001', purchasePrice: 19.95, userType: '微信用户',
} }
test('保存并重新读取全部平台补充资料，保留备注且不显示内部编码', () => {
  const stored = writeReturnFormMetadata(form)
  const read = readReturnFormMetadata(stored)
  assert.equal(read.remark, form.remark);assert.equal(read.returnPlatform, 'takealot')
  assert.deepEqual(read.takealotReturnDetails, { ...form.takealotReturnDetails, filledBy: '测试填写人' })
})
test('旧纯文本备注和没有资料的新草稿保持原样', () => {
  assert.deepEqual(readReturnFormMetadata('旧备注'), { remark: '旧备注' })
  assert.equal(writeReturnFormMetadata({ remark: '旧备注' }), '旧备注')
  assert.deepEqual(readReturnFormMetadata(null), { remark: null })
})
test('旧客户端及ERP刷新未携带平台资料时保留已保存内容', () => {
  const stored = writeReturnFormMetadata(form)
  const rewritten = writeReturnFormMetadata({ remark: '修改备注' }, stored)
  const read = readReturnFormMetadata(rewritten)
  assert.equal(read.remark, '修改备注');assert.equal(read.takealotReturnDetails?.purchasePrice, 19.95)
  assert.equal(read.returnPlatform, 'takealot')
})
test('显式清空资料和备注可以持久化，不回填旧字段', () => {
  const read = readReturnFormMetadata(writeReturnFormMetadata({ remark: '', takealotReturnDetails: null }, writeReturnFormMetadata(form)))
  assert.equal(read.remark, '');assert.equal(read.takealotReturnDetails, undefined)
})
test('切换其他平台清除不适用的Takealot补充资料', () => {
  const read = readReturnFormMetadata(writeReturnFormMetadata({ returnPlatform: 'other' }, writeReturnFormMetadata(form)))
  assert.equal(read.returnPlatform, 'other');assert.equal(read.takealotReturnDetails, undefined)
})
test('零采购价可以保存，非法金额及平台提供中文校验', () => {
  assert.equal(readReturnFormMetadata(writeReturnFormMetadata({ ...form, takealotReturnDetails: { purchasePrice: 0 } })).takealotReturnDetails?.purchasePrice, 0)
  for (const price of [-1, Infinity, 'invalid']) assert.throws(() => writeReturnFormMetadata({ ...form, takealotReturnDetails: { purchasePrice: price } }), /当时采购价/)
  assert.throws(() => writeReturnFormMetadata({ returnPlatform: 'invalid' }), ReturnFormValidationError)
})
test('损坏或碰巧同前缀的历史备注不被误清空', () => {
  for (const text of ['__OMS_RETURN_FORM_V1__:bad', '__OMS_RETURN_FORM_V1__:{"version":2}', '__OMS_RETURN_FORM_V1__:{"version":1,"returnPlatform":"takealot","remark":{}}']) {
    assert.equal(readReturnFormMetadata(text).remark, text)
  }
})
