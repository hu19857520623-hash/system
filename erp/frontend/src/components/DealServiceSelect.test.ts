// @vitest-environment client-render
import { describe, expect, it } from 'vitest'
import { createRenderer, defineComponent, h, nextTick, ref } from 'vue'
import DealServiceSelect from './DealServiceSelect.vue'
import { DEAL_SERVICES } from '@erp/shared/deal-services'

type Node = { text: string; props: Record<string, any>; children: Node[]; parent?: Node }
const node = (text = ''): Node => ({ text, props: {}, children: [] })
const renderer = createRenderer<Node, Node>({
  createElement: tag => node(tag), createText: text => node(text), createComment: () => node(),
  setText: (el, text) => { el.text = text }, setElementText: (el, text) => { el.children = [node(text)] },
  parentNode: el => el.parent || null, nextSibling: () => null,
  patchProp: (el, key, _old, value) => { el.props[key] = value },
  insert: (el, parent) => { el.parent = parent; parent.children.push(el) }, remove: () => {},
  insertStaticContent: (text, parent) => { const el = node(text); parent.children.push(el); return [el, el] },
})
const text = (n: Node): string => [n.text, ...n.children.map(text)].join(' ')
function find(n: Node, tag: string): Node | undefined { return n.text === tag ? n : n.children.map(c => find(c, tag)).find(Boolean) }
function mount(initial = '') {
  const value = ref(initial), root = node(), app = renderer.createApp(defineComponent({ setup: () => () => h(DealServiceSelect, { modelValue: value.value, 'onUpdate:modelValue': v => { value.value = v } }) }))
  app.component('ElSelect', defineComponent({ props: ['modelValue'], setup: (p, { attrs, slots }) => () => h('select', { ...attrs, value: p.modelValue }, slots.default?.()) }))
  app.component('ElOptionGroup', defineComponent({ setup: (_, { slots }) => () => h('group', slots.default?.()) }))
  app.component('ElOption', defineComponent({ props: ['label', 'value'], setup: p => () => h('option', { value: p.value }, p.label) }))
  app.mount(root)
  return { root, value, app }
}
describe('共用成交服务选择器', () => {
  it('两个成交入口可复用全部19个完整服务标签，支持搜索且不启用多选', () => {
    const { root, app } = mount()
    try {
      for (const service of DEAL_SERVICES) expect(text(root)).toContain(`${service.code}｜${service.name}`)
      expect(find(root, 'select')?.props.filterable).toBeDefined()
      expect(find(root, 'select')?.props.multiple).toBeUndefined()
    } finally { app.unmount() }
  })
  it('选择A5后完整展示含XT回款的长名称，回传单个代码而非名称', async () => {
    const { root, value, app } = mount()
    try {
      find(root, 'select')!.props['onUpdate:modelValue']('A5')
      await nextTick()
      expect(value.value).toBe('A5')
      const summary = root.children.flatMap(n => n.children).find(n => n.props.class === 'selected-service')
      expect(summary && text(summary)).toContain('A5｜跨境本土店（南非公司注册＋公户，XT 回款）')
    } finally { app.unmount() }
  })
})
