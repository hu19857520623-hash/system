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

test('generic resource responses translate as complete messages through server and frontend', () => {
  for (const error of ['Resource not found', 'RESOURCE NOT FOUND.', 'Record not found', 'Document not found', 'Entity not found', 'Resource 未找到所需记录']) {
    const response = localizedErrorResponse({ error, code: 'MISSING_RESOURCE' }, 404)
    assert.deepEqual(response, { error: '未找到所需记录，请刷新后重试', code: 'MISSING_RESOURCE' })
    assert.equal(userFacingError(response, 404), response.error)
  }
  assert.equal(userFacingError('读取原单失败：Resource not found', 404), '读取原单失败：未找到所需记录，请刷新后重试')
  assert.equal(userFacingError('SKU Resource-01 缺少 2 件，请核对入库单 RV-81', 400), 'SKU Resource-01 缺少 2 件，请核对入库单 RV-81')
})

test('technical errors keep Chinese recovery context without exposing database and network details', () => {
  const messages = [
    '原单已保存，同步失败：Invalid `prisma.inboundOrder.update()` invocation',
    '原单已保存，同步失败：SQLSTATE 45000 isolated database fault',
    '原单已保存，同步失败：ECONNRESET 127.0.0.1:3000',
    '原单已保存，同步失败：<html>Bad Gateway</html>',
  ]
  for (const error of messages) {
    const response = localizedErrorResponse({ error }, 503)
    assert.match(String(response.error), /^原单已保存，同步失败：服务暂时不可用/)
    assert.doesNotMatch(String(response.error), /prisma|SQLSTATE|ECONN|127\.0\.0\.1|<html>/i)
  }
})
