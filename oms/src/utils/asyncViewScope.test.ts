import test from 'node:test'
import assert from 'node:assert/strict'
import { createAsyncViewScope } from './asyncViewScope'

test('旧单据回执不能影响新单据，也不能影响重新打开的同一单据', () => {
  const view = createAsyncViewScope(); view.update('session:A'); const first = view.capture()
  view.update('session:A'); assert.equal(first(), true)
  view.update('session:B'); assert.equal(first(), false)
  view.update('session:A'); assert.equal(first(), false); assert.equal(view.capture()(), true)
})
test('离开页面、换账号或卸载使旧响应及旧 finally 失效', () => {
  const view = createAsyncViewScope(); view.update('one:A'); const before = view.capture()
  view.dispose(); assert.equal(before(), false)
  view.update('one:A'); assert.equal(before(), false)
  const current = view.capture(); view.update('two:A'); assert.equal(current(), false)
})

test('迟到成功、失败和完成不更新新单据，服务器已完成结果仍独立保留', async () => {
  for (const failure of [false, true]) {
    const view = createAsyncViewScope(); view.update('one:document-A')
    const current = view.capture(), effects: string[] = []
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const request = (async () => {
      try {
        await gate; effects.push('server-completed-A')
        if (failure) throw Error('failure')
        if (!current()) return
        effects.push('replace-current-detail')
      } catch { if (current()) effects.push('show-error') }
      finally { if (current()) effects.push('clear-busy') }
    })()
    view.update('one:document-B'); release(); await request
    assert.deepEqual(effects, ['server-completed-A'])
  }
})
