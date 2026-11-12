// @vitest-environment client-render
import { describe, expect, it, vi } from 'vitest'
import { createRenderer, defineComponent, h, nextTick } from 'vue'
import LeadsDealsView from './LeadsDealsView.vue'
import { leadApi } from '@/api/client.js'
vi.mock('@/api/client.js', () => ({leadApi:{list:vi.fn(async()=>({items:[],total:0})),confirmToErp:vi.fn(async()=>({customerCode:'C1',customerId:1}))},usersApi:{list:vi.fn(async()=>({items:[]}))},warehouseApi:{list:vi.fn(async()=>({items:[]}))}}))
vi.mock('@/stores/app',()=>({useAppStore:()=>({hasPerm:()=>true})}))
vi.mock('@/composables/useRowActions',()=>({useRowActions:()=>({exportTask:vi.fn()})}))
vi.mock('vue-router',()=>({useRouter:()=>({push:vi.fn()})}))
vi.mock('element-plus',()=>({ElMessage:{warning:vi.fn(),error:vi.fn(),success:vi.fn()}}))
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
const plain=defineComponent({setup:(_, {slots})=>()=>h('section',slots.default?.())})
async function mount() {
 const root=node(), app=renderer.createApp({render:()=>h(LeadsDealsView)})
 const form=defineComponent({setup:(_, {slots,expose})=>{expose({validate:async()=>true});return()=>h('form',slots.default?.())}})
 for(const name of ['ElCard','ElInput','ElSelect','ElOption','ElTable','ElTableColumn','ElTag','ElButton','ElDrawer','ElEmpty','ElDialog','ElFormItem','ElDatePicker','ElResult'])app.component(name,plain)
 app.component('ElTable',defineComponent({render:()=>h('table')}))
 app.component('ElForm',form);app.directive('loading',{});app.config.warnHandler=()=>{}
 app.mount(root)
 for(let i=0;i<15;i++){await Promise.resolve();await nextTick()}
 const state=(app as any)._instance.subTree.component.setupState
 return {state,app}
}
describe('成交服务与OMS开户分离',()=>{
 it('所有服务及历史店铺类型均不预选OMS类型，重新打开弹窗清除上次选择',async()=>{
  const {state,app}=await mount()
  try {
   for(const shopType of ['南非公司注册','TM 标','LOA 认证','货盘使用押金','海外仓','跨境店']){
    state.omsForm.omsType='hybrid';state.omsForm.permissionTemplate='hybrid'
    await state.toErp({_leadId:1,leadNo:'L1',shopType,name:'测试客户',contactPhone:'13800000000'})
    expect(state.omsForm.omsType).toBe('');expect(state.omsForm.permissionTemplate).toBe('')
   }
  }finally{app.unmount()}
 })
 it('未选择类型不能提交，手动选定后按该类型和模板申请开户',async()=>{
  vi.mocked(leadApi.confirmToErp).mockClear()
  const {state,app}=await mount()
  try {
   await state.toErp({_leadId:1,leadNo:'L1',shopType:'南非公司注册',name:'测试客户',contactPhone:'13800000000'})
   await nextTick();await state.submitOmsAccount()
   expect(leadApi.confirmToErp).not.toHaveBeenCalled()
   state.omsForm.omsType='catalog';state.omsForm.permissionTemplate='catalog'
   await state.submitOmsAccount()
   expect(leadApi.confirmToErp).toHaveBeenCalledWith(1,expect.objectContaining({omsType:'catalog',portalType:'catalog',permissionTemplate:'catalog'}))
  }finally{app.unmount()}
 })
})
