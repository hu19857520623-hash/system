import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { PageErrorBoundary } from './PageErrorBoundary'
import ProductForm from '../products/ProductForm'

test('a failed page provides Chinese recovery with both retry and return actions', () => {
  const boundary = new PageErrorBoundary({ children: createElement('p', {}, '正常页面') })
  boundary.state = PageErrorBoundary.getDerivedStateFromError()
  const html = renderToStaticMarkup(boundary.render())
  assert.match(html, /页面暂时无法显示/)
  assert.match(html, /重新加载/)
  assert.match(html, /返回首页/)
  assert.match(html, /href="\/"/)
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
