import assert from 'node:assert/strict'
import test from 'node:test'
import { localizedErrorResponse } from './error-response.util.js'
import { userFacingError } from '../src/utils/userFacingError.js'

test('OMS errors preserve response fields while translating the user message', () => {
  assert.deepEqual(localizedErrorResponse({ error: 'Forbidden', code: 'SCOPE_DENIED' }, 403), { error: '没有权限执行此操作', code: 'SCOPE_DENIED' })
  assert.match(String(localizedErrorResponse({ message: 'Invalid `prisma.product.findMany()` invocation' }, 500).message), /服务处理失败/)
  assert.match(String(localizedErrorResponse('<html>Bad Gateway</html>', 502).error), /服务暂时无法连接/)
  assert.match(String(localizedErrorResponse({}, 413).error), /文件过大/)
})

test('OMS error display preserves Chinese actionable business errors and translates network/runtime errors', () => {
  const business = 'SKU SKU-01 可用 2 件，不足发运 9 件'
  assert.equal(userFacingError(business, 400), business)
  assert.match(userFacingError(new TypeError('Failed to fetch')), /网络连接失败/)
  assert.match(userFacingError(new SyntaxError('Unexpected token <')), /数据处理失败/)
  assert.match(userFacingError('客户账号已创建，但列表刷新失败：Failed to fetch'), /^客户账号已创建，但列表刷新失败：网络连接失败/)
  assert.equal(userFacingError('{"error":"SKU A-01 库存不足"}'), 'SKU A-01 库存不足')
  assert.equal(userFacingError({ message: ['客户代码不能为空', 'sku must be a string'] }, 400), '客户代码不能为空；输入信息有误，请检查后重试')
})
