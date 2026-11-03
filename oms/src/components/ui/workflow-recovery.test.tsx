import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { PageErrorBoundary } from './PageErrorBoundary'
import ProductForm from '../products/ProductForm'
import InboundSaveRecovery from '../inbound/InboundSaveRecovery'
import { storeAuthSession } from '../../api/client'
import { inboundSaveKey } from '../../data/inboundSaveWorkflow'
import { InboundReceiptStatus } from '../inbound/InboundReceiptStatus'
import { defaultInboundFilters, inboundListParams, inboundListReturn, readInboundListLocation } from '../../data/inboundListLocation'

test('入库查询条件往返地址与详情返回时保留已应用条件和查询模式', () => {
  const filters = { ...defaultInboundFilters, inboundNo: 'RV & 测试#1', inboundNoMode: 'exact' as const, referenceNo: 'PO-9', sku: 'A', warehouse: 'jhb1', dateFrom: '2026-11-01' }
  const query = inboundListParams('shelved', filters)
  assert.deepEqual(readInboundListLocation(new URLSearchParams(query.toString())), { tab: 'shelved', filters })
  assert.equal(inboundListReturn('?' + query), '/inbound/records?' + query)
})
test('切到全部与重置筛选清除旧在途条件，刷新不会退回旧tab', () => {
  assert.equal(inboundListParams('all', defaultInboundFilters).toString(), '')
  assert.deepEqual(readInboundListLocation(new URLSearchParams()), { tab: 'all', filters: defaultInboundFilters })
  assert.equal(inboundListReturn('?tab=all'), '/inbound/records')
})
test('非法tab回到全部，兼容旧submitted入口，返回链接不接受外部跳转参数', () => {
  assert.equal(readInboundListLocation(new URLSearchParams('tab=submitted')).tab, 'on_the_way')
  assert.equal(readInboundListLocation(new URLSearchParams('tab=garbage')).tab, 'all')
  assert.equal(inboundListReturn('?returnTo=https://example.com&tab=garbage&skuMode=other&dateFrom=wrong'), '/inbound/records')
})

test('接受短收并上架完成后，状态和短收件数同时明确显示', () => {
  const html = renderToStaticMarkup(createElement(InboundReceiptStatus, { order: { status: 'shelved', totalQty: 3, receivedQty: 2 } }))
  assert.match(html, /上架完成/);assert.match(html, /短收 1 件/);assert.doesNotMatch(html, /部分收货/)
})
test('足量上架完成不显示短收或零件差异', () => {
  const html = renderToStaticMarkup(createElement(InboundReceiptStatus, { order: { status: 'shelved', totalQty: 3, receivedQty: 3 } }))
  assert.match(html, /上架完成/);assert.doesNotMatch(html, /短收/)
})
test('尚未上架完结的部分收货不会提前显示上架完成', () => {
  const html = renderToStaticMarkup(createElement(InboundReceiptStatus, { order: { status: 'partial', totalQty: 3, receivedQty: 2 } }))
  assert.match(html, /部分收货/);assert.doesNotMatch(html, /上架完成/)
})
test('零收货完结明确显示零收货结束，不表示有实物上架', () => {
  const html = renderToStaticMarkup(createElement(InboundReceiptStatus, { order: { status: 'shelved', totalQty: 3, receivedQty: 0 } }))
  assert.match(html, /零收货结束/);assert.match(html, /短收 3 件/);assert.doesNotMatch(html, /上架完成/)
})

test('a failed page provides Chinese recovery with both retry and return actions', () => {
  const boundary = new PageErrorBoundary({ children: createElement('p', {}, '正常页面') })
  boundary.state = PageErrorBoundary.getDerivedStateFromError()
  const html = renderToStaticMarkup(boundary.render())
  assert.match(html, /页面暂时无法显示/)
  assert.match(html, /重新加载/)
  assert.match(html, /返回首页/)
  assert.match(html, /href="\/"/)
})
test('入库保存恢复为写账号提供核对、重试、取消和返回，读账号只显示核对和返回', t => {
  const descriptors = ['localStorage', 'sessionStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const key of ['localStorage', 'sessionStorage']) { const map = new Map<string, string>();Object.defineProperty(globalThis, key, { configurable: true, value: { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value), removeItem: (key: string) => map.delete(key) } }) }
  t.after(() => { for (const [key, descriptor] of descriptors) if (descriptor) Object.defineProperty(globalThis, key, descriptor);else Reflect.deleteProperty(globalThis, key) })
  const session: any = { token: 'test', user: { id: 'u1', username: 'test', role: 'hybrid', customerId: 'c1', customerCode: 'TKL9001', permissions: ['inbound:read', 'inbound:write'] } }
  storeAuthSession(session)
  const requestId = '00000000-0000-4000-8000-000000000097'
  localStorage.setItem(inboundSaveKey('u1', 'c1'), JSON.stringify({ version: 1, userId: 'u1', customerId: 'c1', requestId, createdAt: new Date().toISOString(), orders: [{ id: 'x', inboundNo: 'IB001', customerId: 'c1', saveRequestId: requestId }] }))
  const render = () => renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(InboundSaveRecovery, { customerId: 'c1' })))
  const write = render();assert.match(write, /核对原保存结果/);assert.match(write, /重试原保存/);assert.match(write, /取消原保存请求/);assert.match(write, /返回入库记录/)
  storeAuthSession({ ...session, user: { ...session.user, permissions: ['inbound:read'] } })
  const read = render();assert.match(read, /核对原保存结果/);assert.doesNotMatch(read, /重试原保存|取消原保存请求/)
  localStorage.setItem(inboundSaveKey('u1', 'c1'), '{broken')
  const corrupt = render();assert.match(corrupt, /原草稿保存记录无法读取/);assert.doesNotMatch(corrupt, /核对原保存结果|重试原保存|取消原保存请求/);assert.equal(localStorage.getItem(inboundSaveKey('u1', 'c1')), '{broken')
})

test('missing edit targets cannot fall through into a new product form', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ProductForm, { mode: 'edit' })))
  assert.match(html, /未找到该商品/)
  assert.match(html, /返回我的商品/)
  assert.match(html, /href="\/products"/)
  assert.doesNotMatch(html, /保存并提交|<input/)
})

test('single-file recovery returns within the current document', () => {
  const boundary = new PageErrorBoundary({ children: createElement('p', {}, '正常页面'), hashRouting: true })
  boundary.state = PageErrorBoundary.getDerivedStateFromError()
  const html = renderToStaticMarkup(boundary.render())
  assert.match(html, /href="#\/"/)
  assert.doesNotMatch(html, /href="\/"/)
})
