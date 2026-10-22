import assert from 'node:assert/strict'
import test from 'node:test'
import { missingRequiredAccountMessage } from './account-validation.util.js'

const fields = {
  customerName: '客户名称', contactEmail: '联系邮箱', contactPhone: '联系电话',
  omsType: '客户类型', warehouse: '仓库', temporaryPassword: '临时密码',
}
const valid = {
  customerName: '隔离验证客户', contactEmail: 'audit@example.invalid', contactPhone: '19900009001',
  omsType: 'hybrid', warehouse: 'WMS-JHB-01', temporaryPassword: 'AuditFixture123!',
}
for (const [field, label] of Object.entries(fields)) {
  test(`开户缺少${label}时返回页面上的中文字段名`, () => {
    assert.equal(missingRequiredAccountMessage({ ...valid, [field]: ' ' }), `缺少${label}`)
  })
}
test('完整的开户字段不会误报缺少信息', () => { assert.equal(missingRequiredAccountMessage(valid), null) })
