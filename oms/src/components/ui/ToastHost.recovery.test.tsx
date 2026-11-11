import assert from 'node:assert/strict'
import test from 'node:test'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { ToastHost } from './ToastHost'
import { notifyError, notifySuccess } from '../../utils/userNotify'

test('failure notices stay until closed while success notices can expire', async () => {
  const scheduled: Array<() => void> = []
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { setTimeout: (fn: () => void) => { scheduled.push(fn); return scheduled.length }, clearTimeout: () => {} },
  })
  let renderer: ReactTestRenderer | undefined
  try {
    await act(async () => { renderer = create(<ToastHost />) })
    await act(async () => { notifyError('库存不足，请减少数量后继续提交') })
    assert.match(JSON.stringify(renderer!.toJSON()), /库存不足，请减少数量后继续提交/)
    assert.equal(scheduled.length, 0)
    const close = renderer!.root.findByProps({ 'aria-label': '关闭' })
    await act(async () => { close.props.onClick() })
    assert.equal(renderer!.toJSON(), null)

    await act(async () => { notifySuccess('已保存') })
    assert.equal(scheduled.length, 1)
    await act(async () => { scheduled[0]() })
    assert.equal(renderer!.toJSON(), null)
  } finally {
    await act(async () => { renderer?.unmount() })
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete (globalThis as { window?: unknown }).window
  }
})
