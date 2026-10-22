import assert from 'node:assert/strict'
import test from 'node:test'
import { Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { User } from 'lucide-react'
import { FormField } from './form'

function labelTarget(html: string) { return html.match(/<label[^>]*for="([^"]+)"/)?.[1] }
function inputTarget(html: string) { return html.match(/<input[^>]*id="([^"]+)"/)?.[1] }

test('字段标签与提示指向实际输入框，不指向前置图标', () => {
  const html = renderToStaticMarkup(<FormField label="手机号" hint="开户时登记的手机号"><div><User /><input type="tel" /></div></FormField>)
  assert.ok(labelTarget(html))
  assert.equal(labelTarget(html), inputTarget(html))
  assert.doesNotMatch(html, /<svg[^>]*\sid=/)
  assert.match(html, /<input[^>]*aria-describedby="[^"]+-hint"/)
})

test('装饰性容器和片段不会抢占字段绑定', () => {
  const html = renderToStaticMarkup(<FormField label="数量"><Fragment><div><span>说明</span></div><input type="number" /></Fragment></FormField>)
  assert.equal(labelTarget(html), inputTarget(html))
  assert.ok(inputTarget(html))
})

test('已有控件编号会被标签复用', () => {
  const html = renderToStaticMarkup(<FormField label="产品名称"><input id="product-name" /></FormField>)
  assert.equal(labelTarget(html), 'product-name')
  assert.equal(inputTarget(html), 'product-name')
})

test('首个嵌套控件缺少编号时不会借用后面控件的编号', () => {
  const html = renderToStaticMarkup(<FormField label="范围"><div><input /></div><input id="range-end" /></FormField>)
  assert.equal(labelTarget(html), inputTarget(html))
  assert.notEqual(labelTarget(html), 'range-end')
  assert.equal((html.match(/id="range-end"/g) || []).length, 1)
})

test('绑定提示时保留输入框已有的说明关联', () => {
  const html = renderToStaticMarkup(<FormField label="数量" hint="请输入正整数"><input id="quantity" aria-describedby="existing-description" /></FormField>)
  assert.match(html, /aria-describedby="existing-description quantity-hint"/)
})

test('可转发编号的自定义输入组件保持标签绑定', () => {
  const Custom = (props: { id?: string; value: string }) => <input {...props} readOnly />
  const html = renderToStaticMarkup(<FormField label="SKU"><Custom value="SKU-01" /></FormField>)
  assert.equal(labelTarget(html), inputTarget(html))
  assert.ok(inputTarget(html))
})
