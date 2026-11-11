import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import ReturnApply from './ReturnApply'
import { RoleProvider } from '../auth/RoleContext'
import { storeAuthSession, type AuthSession } from '../api/client'
import { setReturnOrders } from '../data/entityStore'
import { hydrateAccounts } from '../auth/accountStore'
import type { ReturnOrder } from '../data/returnStore'

const draft = (id: string): ReturnOrder => ({ id, customerId: 'c1', returnNo: `RT-TKL9001-${id}`,
  orderNo: `ORDER-${id}`, returnPlatform: 'other', returnWarehouse: 'JHB3', returnReason: '平台退货',
  requestedProcess: 'restock', status: 'draft', createdAt: '2026-11-11', lineItems: [] })

async function mount(t: TestContext, path = '/returns/apply?edit=A', admin = false) {
  const originals = ['window', 'document', 'FileReader', 'localStorage', 'sessionStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  const reads: { result: string; error?: Error; onload?: () => void; onerror?: () => void }[] = []
  const storage = () => { const rows = new Map<string, string>(); return { getItem: (k: string) => rows.get(k) ?? null, setItem: (k: string, v: string) => rows.set(k, v), removeItem: (k: string) => rows.delete(k) } }
  const globals = {
    window: Object.assign(new EventTarget(), { setInterval: () => 0, clearInterval: () => {}, alert: () => { throw Error('Unexpected alert') } }),
    document: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
    localStorage: storage(), sessionStorage: storage(),
    FileReader: class { result = ''; readAsDataURL() { reads.push(this) } },
  }
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value })
  const session = { token: 'return-form-test', user: { id: 'return-tester', username: 'return-tester', name: '退件测试', email: '', role: admin ? 'sys_admin' : 'hybrid',
    status: 'active', customerId: 'c1', customerCode: 'TKL9001', permissions: ['returns:read', 'returns:write'], mustChangePassword: false } } as AuthSession
  storeAuthSession(session)
  hydrateAccounts(['c1', 'c2'].map((id, i) => ({ id, code: `TKL900${i+1}`, status: 'active', permissions: [] } as any)))
  setReturnOrders([draft('A'), draft('B')])
  const previousFetch = globalThis.fetch
  const writes: string[] = []
  let respondToSave: ((response: Response) => void) | undefined
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith('/auth/me')) return Response.json({ user: session.user })
    writes.push(String(input))
    assert.equal(init?.method, 'PUT')
    return new Promise<Response>(resolve => { respondToSave = resolve })
  }
  let navigate!: ReturnType<typeof useNavigate>, location = ''
  function Probe() { navigate = useNavigate(); location = useLocation().search; return null }
  let tree!: ReactTestRenderer
  await act(async () => { tree = create(<MemoryRouter initialEntries={[path]}><RoleProvider><Probe /><ReturnApply /></RoleProvider></MemoryRouter>) })
  t.after(async () => {
    await act(async () => tree.unmount())
    globalThis.fetch = previousFetch
    setReturnOrders([]); hydrateAccounts([])
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key) }
  })
  return { tree, reads, writes, session, get location() { return location }, respondToSave: () => respondToSave!(Response.json({ ok: true })),
    go: async (id: string) => { await act(async () => navigate(`/returns/apply?edit=${id}`)) } }
}

const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : text(child)).join('')
const button = (tree: ReactTestRenderer, label: string) => tree.root.findAllByType('button').find(node => text(node) === label)!
const fileInput = (tree: ReactTestRenderer) => tree.root.findByProps({ type: 'file' })

test('退件文件读取期间阻止保存及第二批读取，批次失败保留原输入且不回填半批附件', async t => {
  const ui = await mount(t)
  await act(async () => fileInput(ui.tree).props.onChange({ target: { files: [{ name: 'one.txt' }, { name: 'two.txt' }] } }))
  assert.equal(ui.reads.length, 1)
  assert.equal(ui.tree.root.findByType('fieldset').props.disabled, true)
  await act(async () => button(ui.tree, '保存草稿').props.onClick())
  await act(async () => button(ui.tree, '提交退件申请').props.onClick())
  assert.deepEqual(ui.writes, [])
  await act(async () => fileInput(ui.tree).props.onChange({ target: { files: [{ name: 'ignored.txt' }] } }))
  assert.equal(ui.reads.length, 1)
  await act(async () => { ui.reads[0].result = 'data:one'; ui.reads[0].onload!() })
  assert.equal(ui.reads.length, 2)
  await act(async () => { ui.reads[1].error = Error('Failed to read'); ui.reads[1].onerror!() })
  assert.equal(ui.tree.root.findByType('fieldset').props.disabled, false)
  assert.equal(ui.tree.root.findAllByType('a').some(node => node.props.href === 'data:one'), false)
  assert.ok(ui.tree.root.findAllByType('input').some(node => node.props.value === 'ORDER-A'))
  assert.match(text(ui.tree.root.findByProps({ role: 'alert' })), /[\u4e00-\u9fff]/)
})

test('管理员切换退件客户时清空前一个客户的表单输入', async t => {
  const ui = await mount(t, '/returns/apply', true)
  const filter = () => ui.tree.root.findAllByType('select').find(node => node.findAllByType('option').some(option => option.props.value === 'all'))!
  await act(async () => filter().props.onChange({ target: { value: 'c1' } }))
  const orderInput = ui.tree.root.findByProps({ placeholder: 'ORD-...' })
  assert.ok(orderInput)
  await act(async () => orderInput.props.onChange({ target: { value: 'CUSTOMER-ONE-ORDER' } }))
  assert.ok(ui.tree.root.findAllByType('input').some(node => node.props.value === 'CUSTOMER-ONE-ORDER'))
  await act(async () => filter().props.onChange({ target: { value: 'c2' } }))
  assert.equal(ui.tree.root.findAllByType('input').some(node => node.props.value === 'CUSTOMER-ONE-ORDER'), false)
})

test('读取附件期间更换登录会话，迟到失败不污染新表单且仍可重新读取', async t => {
  const ui = await mount(t)
  await act(async () => fileInput(ui.tree).props.onChange({ target: { files: [{ name: 'old.txt' }] } }))
  await act(async () => {
    storeAuthSession({ ...ui.session, token: 'replacement-session' })
    window.dispatchEvent(new Event('storage'))
  })
  await act(async () => { ui.reads[0].error = Error('old read failed'); ui.reads[0].onerror!() })
  assert.equal(ui.tree.root.findAllByProps({ role: 'alert' }).length, 0)
  assert.equal(ui.tree.root.findByType('fieldset').props.disabled, false)
  await act(async () => fileInput(ui.tree).props.onChange({ target: { files: [{ name: 'new.txt' }] } }))
  assert.equal(ui.reads.length, 2)
  await act(async () => { ui.reads[1].result = 'data:new'; ui.reads[1].onload!() })
  assert.ok(ui.tree.root.findAllByType('a').some(node => node.props.href === 'data:new'))
})

test('退件 A 切 B 再回 A，旧附件结果既不回填也不释放新批次，当前批次可继续完成', async t => {
  const ui = await mount(t)
  await act(async () => fileInput(ui.tree).props.onChange({ target: { files: [{ name: 'old.txt' }, { name: 'old-next.txt' }] } }))
  await ui.go('B'); await ui.go('A')
  await act(async () => fileInput(ui.tree).props.onChange({ target: { files: [{ name: 'current.txt' }] } }))
  assert.equal(ui.reads.length, 2)
  await act(async () => { ui.reads[0].result = 'data:old'; ui.reads[0].onload!() })
  assert.equal(ui.reads.length, 2)
  assert.equal(ui.tree.root.findByType('fieldset').props.disabled, true)
  assert.equal(ui.tree.root.findAllByType('a').some(node => node.props.href === 'data:old'), false)
  await act(async () => { ui.reads[1].result = 'data:current'; ui.reads[1].onload!() })
  assert.equal(ui.tree.root.findByType('fieldset').props.disabled, false)
  assert.ok(ui.tree.root.findAllByType('a').some(node => node.props.href === 'data:current'))
})

test('保存 A 期间打开 B，迟到的保存成功不跳走，也不改写 B 的表单', async t => {
  const ui = await mount(t)
  let saving!: Promise<void>
  await act(async () => { saving = button(ui.tree, '保存草稿').props.onClick() })
  assert.equal(ui.writes.length, 1)
  await ui.go('B')
  await act(async () => { ui.respondToSave(); await saving })
  assert.equal(ui.location, '?edit=B')
  assert.ok(ui.tree.root.findAllByType('input').some(node => node.props.value === 'ORDER-B'))
})
