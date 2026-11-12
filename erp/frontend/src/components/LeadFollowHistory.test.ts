// @vitest-environment client-render
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, defineComponent, h, nextTick } from 'vue'
import LeadFollowHistory from './LeadFollowHistory.vue'
import { leadApi } from '@/api/client.js'

const permissions = vi.hoisted(() => ({ edit: true }))
vi.mock('@/api/client.js', () => ({ leadApi: { updateFollowUp: vi.fn(async () => ({})) } }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ hasPerm: () => permissions.edit }) }))
vi.mock('element-plus', () => ({ ElMessage: { warning: vi.fn(), success: vi.fn(), error: vi.fn() } }))

type Node = { text: string; children: Node[]; parent?: Node }
const node = (text = ''): Node => ({ text, children: [] })
const renderer = createRenderer<Node, Node>({
  createElement: node, createText: node, createComment: () => node(),
  setText: (el, text) => { el.text = text }, setElementText: (el, text) => { el.children = [node(text)] },
  parentNode: el => el.parent || null,
  nextSibling: el => { const children = el.parent?.children || []; return children[children.indexOf(el) + 1] || null },
  patchProp: () => {},
  insert: (el, parent, anchor) => {
    if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1)
    el.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(el); else parent.children.splice(index, 0, el)
  },
  remove: el => { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1) },
  insertStaticContent: (text, parent) => { const el = node(text); el.parent = parent; parent.children.push(el); return [el, el] },
})
const plain = defineComponent({ setup: (_, { slots }) => () => h('section', slots.default?.()) })
const record = { id: 20, followType: 'wechat', content: '历史沟通', nextPlan: null, nextFollowAt: null, revision: 'revision1', operatorName: '其他销售', createdAt: '2026-09-20T08:00:00Z' }
async function mount(canEdit = true, followType = 'wechat') {
  const updated = vi.fn()
  const lead = { id: 10, canEditFollowUps: canEdit, followUps: [{ ...record, followType }] }
  const app = renderer.createApp({ render: () => h(LeadFollowHistory, { lead, onUpdated: updated }) })
  for (const name of ['ElEmpty', 'ElTimeline', 'ElTimelineItem', 'ElButton', 'ElDialog', 'ElForm', 'ElFormItem', 'ElRadioGroup', 'ElRadio', 'ElInput', 'ElDatePicker']) app.component(name, plain)
  app.config.warnHandler = () => {}
  app.mount(node())
  await nextTick()
  const state = (app as any)._instance.subTree.component.setupState
  return { app, state, updated, lead }
}

describe('历史跟进记录编辑', () => {
  beforeEach(() => { permissions.edit = true; vi.mocked(leadApi.updateFollowUp).mockReset().mockResolvedValue({}) })

  it('负责人可编辑他人填写的记录，明确选择企微后提交版本并通知列表刷新', async () => {
    const { app, state, updated, lead } = await mount()
    try {
      state.openEdit(lead.followUps[0])
      expect(state.form.followType).toBe('wechat')
      state.form.followType = 'wecom'
      state.form.content = '更新后内容'
      await state.save()
      expect(leadApi.updateFollowUp).toHaveBeenCalledWith(10, 20, {
        followType: 'wecom', content: '更新后内容', nextPlan: null, nextFollowAt: null, expectedRevision: 'revision1',
      })
      expect(updated).toHaveBeenCalledOnce()
      expect(state.editing).toBe(false)
      expect(lead.followUps[0]!.followType).toBe('wechat')
    } finally { app.unmount() }
  })

  it('原有微信记录取消编辑不写入，历史空值不自动填成电话或企微', async () => {
    for (const followType of ['wechat', '']) {
      const { app, state, lead } = await mount(true, followType)
      try {
        state.openEdit(lead.followUps[0])
        expect(state.form.followType).toBe(followType)
        state.editing = false
        expect(leadApi.updateFollowUp).not.toHaveBeenCalled()
      } finally { app.unmount() }
    }
  })

  it('服务端未授予归属编辑权或功能权限被收回时不能编辑/提交', async () => {
    for (const canEdit of [false, true]) {
      permissions.edit = !canEdit
      const { app, state, lead } = await mount(canEdit)
      try {
        state.openEdit(lead.followUps[0])
        expect(state.editing).toBe(false)
        await state.save()
        expect(leadApi.updateFollowUp).not.toHaveBeenCalled()
      } finally { app.unmount() }
    }
  })

  it('并发冲突保留输入，不能提示保存成功或触发刷新', async () => {
    const { app, state, lead, updated } = await mount()
    try {
      state.openEdit(lead.followUps[0])
      state.form.content = '未提交成功的输入'
      vi.mocked(leadApi.updateFollowUp).mockRejectedValue(new Error('记录已被更新，请刷新后重新编辑'))
      await state.save()
      expect(state.editing).toBe(true)
      expect(state.form.content).toBe('未提交成功的输入')
      expect(updated).not.toHaveBeenCalled()
    } finally { app.unmount() }
  })
})
