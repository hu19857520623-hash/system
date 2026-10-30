// @vitest-environment client-render
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, defineComponent, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { createPinia } from 'pinia'
import FinanceBooksView from './FinanceBooksView.vue'
import { useAppStore } from '../stores/app'

vi.mock('./CostLedgerView.vue', () => ({ __esModule: true, default: { name: 'CostLedgerView', render: () => h('div', '采购货款内容') } }))
vi.mock('./SupplierSeaFreightBillView.vue', () => ({ __esModule: true, default: { name: 'SupplierSeaFreightBillView', render: () => h('div', '海运账单内容') } }))
vi.mock('./OperatingLedgerView.vue', () => ({ __esModule: true, default: { name: 'OperatingLedgerView', render: () => h('div', '经营收支内容') } }))
vi.mock('./ProfitAnalysisView.vue', () => ({ __esModule: true, default: { name: 'ProfitAnalysisView', render: () => h('div', '利润分析内容') } }))

type Node = { text: string; props: Record<string, any>; children: Node[]; parent?: Node }
const node = (text = ''): Node => ({ text, props: {}, children: [] })
const renderer = createRenderer<Node, Node>({
  createElement: tag => node(tag), createText: text => node(text), createComment: () => node(),
  setText: (el, text) => { el.text = text }, setElementText: (el, text) => { el.children = [node(text)] },
  parentNode: el => el.parent || null, nextSibling: el => { const items = el.parent?.children || []; return items[items.indexOf(el) + 1] || null },
  patchProp: (el, key, _old, value) => { el.props[key] = value },
  insert: (el, parent, anchor) => { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = parent; const index = anchor ? parent.children.indexOf(anchor) : -1; if (index < 0) parent.children.push(el); else parent.children.splice(index, 0, el) },
  remove: el => { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1) },
  insertStaticContent: (text, parent) => { const el = node(text); el.parent = parent; parent.children.push(el); return [el, el] },
})
const text = (el: Node): string => [el.text, ...el.children.map(text)].join(' ')
function find(el: Node, tag: string): Node | undefined { return el.text === tag ? el : el.children.map(child => find(child, tag)).find(Boolean) }
const plain = defineComponent({ setup: (_, { slots }) => () => h('section', slots.default?.()) })
const tabLabels = defineComponent({ props: ['label'], setup: props => () => h('span', props.label) })
const controls = defineComponent({ props: ['modelValue', 'beforeLeave'], setup: (props, { slots }) => () => h('tabs', { active: props.modelValue, navigate: props.beforeLeave }, slots.default?.()) })
const notice = defineComponent({ props: ['title'], setup: props => () => h('aside', props.title) })
const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).forEach(fn => fn()) })
async function settle() { for (let i = 0; i < 15; i++) { await Promise.resolve(); await nextTick() } }
const user = { id: 1, username: 'finance', realName: '财务', roleCode: 'finance', permissions: ['receivable_payable.view', 'cost.view', 'operating_ledger.view', 'profit_analysis.view'] }

async function mount(path = '/finance-books') {
  const pinia = createPinia(), app = useAppStore(pinia)
  app.applyAuthUser({ ...user })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/finance-books/:tab?', component: FinanceBooksView }] })
  await router.push(path)
  const root = node(), view = renderer.createApp({ render: () => h(RouterView) })
  view.use(pinia); view.use(router); view.config.warnHandler = () => {}
  view.component('ElCard', plain); view.component('ElTabs', controls); view.component('ElTabPane', tabLabels)
  view.component('ElEmpty', plain); view.component('ElAlert', notice)
  view.mount(root); cleanups.push(() => view.unmount()); await settle()
  return { app, router, root, navigate: (key: string) => find(root, 'tabs')!.props.navigate(key) as Promise<boolean> }
}

describe('账本分析页签与路由同步', () => {
  it('从无页签参数入口连续点击四个入口，导航期间刷新权限也不会取消切换', async () => {
    const page = await mount()
    const replace = vi.spyOn(page.router, 'replace')
    page.router.beforeEach(async () => {
      page.app.applyAuthUser({ ...user, permissions: [...user.permissions] })
      await nextTick()
    })
    for (const [key, content] of [['purchase', '采购货款内容'], ['operating', '经营收支内容'], ['analysis', '利润分析内容'], ['freight', '海运账单内容']]) {
      expect(await page.navigate(key)).toBe(true)
      await settle()
      expect(page.router.currentRoute.value.path).toBe(`/finance-books/${key}`)
      expect(find(page.root, 'tabs')!.props.active).toBe(key)
      expect(text(page.root)).toContain(content)
    }
    expect(replace).not.toHaveBeenCalled()
  })

  it('导航被取消时保留原页签和原内容，并给出中文提示', async () => {
    const page = await mount('/finance-books/operating')
    page.router.beforeEach(() => false)
    expect(await page.navigate('purchase')).toBe(false)
    await settle()
    expect(find(page.root, 'tabs')!.props.active).toBe('operating')
    expect(text(page.root)).toContain('经营收支内容')
    expect(text(page.root)).toContain('页面未能切换')
  })

  it('浏览器前进后退和直达链接同步选中项与内容', async () => {
    const page = await mount('/finance-books/analysis')
    expect(text(page.root)).toContain('利润分析内容')
    await page.navigate('purchase'); await settle()
    await new Promise<void>(resolve => {
      const stop = page.router.afterEach(() => { stop(); resolve() })
      page.router.back()
    })
    await settle()
    expect(find(page.root, 'tabs')!.props.active).toBe('analysis')
    expect(text(page.root)).toContain('利润分析内容')
  })

  it('权限变更只显示允许入口，不能切入无权页签', async () => {
    const page = await mount('/finance-books/operating')
    page.app.applyAuthUser({ ...user, permissions: ['cost.view'] }); await settle()
    expect(find(page.root, 'tabs')!.props.active).toBe('purchase')
    expect(text(page.root)).toContain('采购货款内容')
    expect(text(page.root)).not.toContain('经营收支内容')
    expect(await page.navigate('freight')).toBe(false)
  })
})
