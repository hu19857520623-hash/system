// @vitest-environment client-render
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, defineComponent, h, nextTick } from 'vue'
import { createPinia } from 'pinia'
import DashboardView from './DashboardView.vue'
import { useAppStore } from '../stores/app'
import { dashboardApi, announcementApi } from '../api/client'
import { setAccessToken } from '../auth/tokenStore'

vi.mock('../api/client', () => ({ dashboardApi: { stats: vi.fn(), announcements: vi.fn(), notifications: vi.fn(), trends: vi.fn() }, announcementApi: { request: vi.fn(), cancelRequest: vi.fn(), list: vi.fn(), detail: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }, authApi: {} }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('element-plus', () => ({ ElMessage: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }))

const plain = defineComponent({ props: ['title', 'description'], setup: (props, { slots }) => () => h('div', [props.title, props.description, slots.default?.(), slots.footer?.()]) })
const dialog = defineComponent({ props: ['modelValue'], setup: (props, { slots }) => () => props.modelValue ? h('dialog', [slots.default?.(), slots.footer?.()]) : null })

// Render the real page and Vue watchers without a browser or DOM implementation.
type Node = { text: string; props: Record<string, any>; style: Record<string, string>; children: Node[]; parent?: Node }
const makeNode = (text = ''): Node => ({ text, props: {}, style: {}, children: [] })
const renderer = createRenderer<Node, Node>({
  createElement: tag => makeNode(tag), createText: text => makeNode(text), createComment: () => makeNode(),
  setText: (node, text) => { node.text = text }, setElementText: (node, text) => { node.children = [makeNode(text)] },
  parentNode: node => node.parent || null, nextSibling: node => { const siblings = node.parent?.children || []; return siblings[siblings.indexOf(node) + 1] || null },
  patchProp: (node, key, _old, value) => { node.props[key] = value },
  insert: (node, parent, anchor) => { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = parent; const index = anchor ? parent.children.indexOf(anchor) : -1; if (index < 0) parent.children.push(node); else parent.children.splice(index, 0, node) },
  remove: node => { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1) },
  insertStaticContent: (text, parent, anchor) => { const node = makeNode(text); node.parent = parent; const i = anchor ? parent.children.indexOf(anchor) : -1; if (i < 0) parent.children.push(node); else parent.children.splice(i, 0, node); return [node, node] },
})
const text = (node: Node): string => [node.text, ...node.children.map(text)].join(' ')
function control(node: Node, label: string): Node | undefined {
  return node.children.map(child => control(child, label)).find(Boolean)
    || (node.props.onClick && text(node).includes(label) ? node : undefined)
}
const cleanups: (() => void)[] = []
beforeEach(() => {
  const storage = () => { const rows = new Map<string, string>(); return { getItem: (k: string) => rows.get(k) ?? null, setItem: (k: string, v: string) => rows.set(k, v), removeItem: (k: string) => rows.delete(k) } }
  vi.stubGlobal('localStorage', storage()); vi.stubGlobal('sessionStorage', storage()); setAccessToken('same-session'); vi.clearAllMocks()
  vi.mocked(dashboardApi.stats).mockResolvedValue({ products: 409 })
  vi.mocked(dashboardApi.announcements).mockResolvedValue([{ id: 1, title: '当前公开公告', content: '公开正文' }])
  vi.mocked(dashboardApi.notifications).mockResolvedValue({ items: [{ screenId: 'leads_pool', title: '私有线索待办', count: 1 }], badges: {} })
  vi.mocked(dashboardApi.trends).mockResolvedValue({ series: [] })
  vi.mocked(announcementApi.list).mockResolvedValue({ items: [{ id: 2, title: '管理计划公告', content: '计划私有正文', scheduledAt:'2077-01-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }] })
})
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.unstubAllGlobals() })
const manager = { id: 51, username: 'audit_admin', realName: '隔离管理员', roleCode: 'admin', permissions: ['dashboard.view', 'announcement.manage', 'dashboard.trends_logistics'] }
function mount() {
  const pinia = createPinia(), app = useAppStore(pinia); app.applyAuthUser(manager)
  const root = makeNode(), view = renderer.createApp(defineComponent({ setup: () => () => h(DashboardView) }))
  for (const name of ['ElButton', 'ElAlert', 'ElEmpty', 'ElTag', 'ElForm', 'ElFormItem', 'ElRadioGroup', 'ElRadio', 'ElInput', 'ElSelect', 'ElOption', 'ElDatePicker', 'ElDialog']) view.component(name, name === 'ElDialog' ? dialog : plain)
  view.directive('loading', {})
  view.use(pinia); view.config.warnHandler = () => {}; view.mount(root); cleanups.push(() => view.unmount())
  return { app, root }
}
async function settle() { for (let i = 0; i < 6; i++) { await Promise.resolve(); await nextTick() } }
describe('工作台真实页面权限变化', () => {
  it('重载后的原发布展示核对继续取消和返回入口，确认回执后刷新并清除原请求', async () => {
    const requestId=crypto.randomUUID()
    localStorage.setItem('erp.announcement.publish.51',JSON.stringify({requestId,actor:'51',payload:{title:'原发布公告',content:'原正文'}}))
    const { root }=mount();await settle()
    for(const label of ['核对原发布结果','继续原公告发布','取消原发布请求','原发布公告'])expect(text(root)).toContain(label)
    control(root,'发布公告')!.props.onClick();await settle();expect(text(root)).toContain('返回工作台')
    vi.mocked(announcementApi.request).mockResolvedValue({requestId,status:'confirmed',announcementId:71})
    await control(root,'核对原发布结果')!.props.onClick();await settle()
    expect(localStorage.getItem('erp.announcement.publish.51')).toBeNull()
    expect(text(root)).toContain('公告编号71');expect(text(root)).not.toContain('继续原公告发布')
  })
  it('编辑保存携带原版本，重复点击合并；冲突保留输入并可重新读取后继续', async () => {
    let reject!: (cause: Error) => void
    vi.mocked(announcementApi.update).mockReturnValueOnce(new Promise((_resolve,no)=>{reject=no}))
    const { root } = mount(); await settle(); control(root, '编辑')!.props.onClick(); await settle()
    const save = control(root, '保存修改')!.props.onClick(); await control(root, '保存修改')!.props.onClick()
    expect(announcementApi.update).toHaveBeenCalledTimes(1)
    expect(vi.mocked(announcementApi.update).mock.calls[0][1]).toMatchObject({expectedUpdatedAt:'2026-10-01T00:00:00.000Z'})
    reject(new Error('公告内容或发布状态已变化，旧页面不能覆盖')); await save; await settle()
    expect(text(root)).toContain('输入已保留');expect(text(root)).toContain('重新加载最新公告')
    vi.mocked(announcementApi.detail).mockResolvedValue({id:2,title:'最新公告',content:'后续新正文',updatedAt:'2026-10-02T00:00:00.000Z'})
    await control(root,'重新加载最新公告')!.props.onClick(); await settle()
    expect(text(root)).toContain('已加载最新公告')
    vi.mocked(announcementApi.update).mockResolvedValue({})
    await control(root,'保存修改')!.props.onClick(); await settle()
    expect(vi.mocked(announcementApi.update).mock.calls[1][1]).toMatchObject({title:'最新公告',content:'后续新正文',expectedUpdatedAt:'2026-10-02T00:00:00.000Z'})
  })
  it('首次读取失败后可点中文重试，恢复后稳定权限刷新不会重复读取', async () => {
    vi.mocked(dashboardApi.stats).mockRejectedValueOnce(new Error('NetworkError'))
    const { app, root } = mount(); await settle()
    expect(text(root)).toContain('重新读取工作台'); expect(text(root)).not.toContain('NetworkError')
    await control(root, '重新读取工作台')!.props.onClick(); await settle()
    expect(text(root)).toContain('管理计划公告'); expect(text(root)).not.toContain('重新读取工作台')
    app.applyAuthUser({ ...manager }); await settle()
    expect(dashboardApi.stats).toHaveBeenCalledTimes(2)
  })
  it('同账号从管理员改仓库后清除计划公告和无权待办，不重新读取管理列表', async () => {
    const { app, root } = mount(); await settle()
    expect(text(root)).toContain('管理计划公告'); expect(text(root)).toContain('私有线索待办')
    app.applyAuthUser({ ...manager, roleCode: 'warehouse', permissions: ['dashboard.view', 'inbound.view'] })
    await settle()
    expect(text(root)).not.toContain('管理计划公告'); expect(text(root)).not.toContain('计划私有正文'); expect(text(root)).not.toContain('私有线索待办')
    expect(text(root)).toContain('当前公开公告'); expect(text(root)).not.toContain('发布公告'); expect(announcementApi.list).toHaveBeenCalledTimes(1)
  })
  it('管理范围的迟到读取无法重新显示撤权公告；趋势失败显示中文重试按钮', async () => {
    let release!: (data: any) => void
    vi.mocked(announcementApi.list).mockReturnValue(new Promise(resolve => { release = resolve }))
    vi.mocked(dashboardApi.trends).mockRejectedValue(new Error('NetworkError'))
    const { app, root } = mount(); await settle()
    expect(text(root)).toContain('重新读取收货趋势'); expect(text(root)).not.toContain('NetworkError')
    app.applyAuthUser({ ...manager, roleCode: 'warehouse', permissions: ['dashboard.view', 'inbound.view'] }); await settle()
    release({ items: [{ id: 2, title: '迟到的管理公告', content: '不应显示' }] }); await settle()
    expect(text(root)).not.toContain('迟到的管理公告'); expect(text(root)).not.toContain('重新读取收货趋势'); expect(text(root)).toContain('当前公开公告')
  })
  it('撤销管理权限会关闭已打开的公告编辑窗口', async () => {
    const { app, root } = mount(); await settle()
    control(root, '编辑')!.props.onClick(); await settle()
    expect(text(root)).toContain('保存修改')
    app.applyAuthUser({ ...manager, roleCode: 'warehouse', permissions: ['dashboard.view'] }); await settle()
    expect(text(root)).not.toContain('保存修改'); expect(text(root)).not.toContain('管理计划公告')
  })
})
