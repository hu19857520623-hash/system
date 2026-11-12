import assert from 'node:assert/strict'
import test from 'node:test'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { PageConfirmProvider } from './PageConfirm'
import { pageConfirm, pageNotice, registerPageConfirm } from '../../utils/pageConfirm'

function button(renderer: ReactTestRenderer, label: string) {
  return renderer.root.findAll((node: any) => node.type === 'button' && JSON.stringify(node.children).includes(label))[0]
}

function stubWindow() {
  const listeners = new Map<string, (event: unknown) => void>()
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: (type: string, fn: (event: unknown) => void) => { listeners.set(type, fn) },
      removeEventListener: (type: string) => { listeners.delete(type) },
    },
  })
  return { keydown: () => listeners.get('keydown'), restore: () => { if (previous) Object.defineProperty(globalThis, 'window', previous); else delete (globalThis as { window?: unknown }).window } }
}

test('没有宿主时页内确认安全默认为取消，不执行危险动作', async () => {
  assert.equal(await pageConfirm({ title: '删除', message: '确认删除？' }), false)
})

test('取消与显式确认分支：仅确认才执行，取消后模态关闭', async () => {
  const stub = stubWindow()
  let renderer: ReactTestRenderer | undefined
  try {
    await act(async () => { renderer = create(<PageConfirmProvider><div>业务页面</div></PageConfirmProvider>) })
    for (const expected of [false, true]) {
      const pending = pageConfirm({ title: '撤回出库单', message: '确认撤回这张待拣货出库单？', confirmLabel: '确认撤回', cancelLabel: '返回', danger: true })
      await act(async () => {})
      const html = JSON.stringify(renderer!.toJSON())
      assert.match(html, /撤回出库单/)
      assert.match(html, /确认撤回这张待拣货出库单/)
      await act(async () => { button(renderer!, expected ? '确认撤回' : '返回').props.onClick() })
      assert.equal(await pending, expected)
      assert.doesNotMatch(JSON.stringify(renderer!.toJSON()), /确认撤回这张待拣货出库单/)
    }
  } finally {
    await act(async () => { renderer?.unmount() })
    stub.restore()
  }
})

test('Escape 与点击遮罩都视为取消', async () => {
  const stub = stubWindow()
  let renderer: ReactTestRenderer | undefined
  try {
    await act(async () => { renderer = create(<PageConfirmProvider><div /></PageConfirmProvider>) })
    const byEscape = pageConfirm({ title: '删除商品', message: '此操作不可恢复。' })
    await act(async () => {})
    stub.keydown()!({ key: 'Escape', preventDefault: () => {} })
    assert.equal(await byEscape, false)

    const byOverlay = pageConfirm({ title: '删除商品', message: '此操作不可恢复。' })
    await act(async () => {})
    const overlay = renderer!.root.findAll((node: any) => typeof node.type === 'string' && JSON.stringify(node.props.className || '').includes('fixed inset-0'))[0]
    await act(async () => { overlay.props.onMouseDown({ target: overlay, currentTarget: overlay }) })
    assert.equal(await byOverlay, false)
  } finally {
    await act(async () => { renderer?.unmount() })
    stub.restore()
  }
})

test('通知模式只展示关闭按钮，关闭即结束', async () => {
  const stub = stubWindow()
  let renderer: ReactTestRenderer | undefined
  try {
    await act(async () => { renderer = create(<PageConfirmProvider><div /></PageConfirmProvider>) })
    const pending = pageConfirm({ title: '无法删除商品', message: '该商品存在库存，不能删除。', noticeOnly: true })
    await act(async () => {})
    const buttons = renderer!.root.findAll((node: any) => node.type === 'button')
    assert.equal(buttons.length, 1)
    assert.match(JSON.stringify(buttons[0].children), /关闭/)
    await act(async () => { buttons[0].props.onClick() })
    assert.equal(await pending, true)
  } finally {
    await act(async () => { renderer?.unmount() })
    stub.restore()
  }
})

test('pageNotice 走页内提示，卸载宿主后恢复安全默认', async () => {
  const stub = stubWindow()
  let seen: { title?: string; noticeOnly?: boolean } | null = null
  const unregister = registerPageConfirm(options => { seen = options as any; return Promise.resolve(true) })
  pageNotice('已从 ERP 同步 3 条物流记录', '同步完成')
  assert.equal((seen as any)?.title, '同步完成')
  assert.equal((seen as any)?.noticeOnly, true)
  unregister()
  assert.equal(await pageConfirm({ title: 'x', message: 'y' }), false)
  stub.restore()
})
