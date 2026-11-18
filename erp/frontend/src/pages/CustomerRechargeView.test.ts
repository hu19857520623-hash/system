// @vitest-environment client-render
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, defineComponent, h, nextTick } from 'vue'
import { createPinia } from 'pinia'
import { useAppStore } from '../stores/app'
import { customerApi } from '../api/client.js'
import CustomerRechargeView from './CustomerRechargeView.vue'
vi.mock('../api/client.js',()=>({customerApi:{rechargeRecords:vi.fn()},authApi:{}}))
vi.mock('vue-router',()=>({useRoute:()=>({query:{},path:'/finance-books/recharge',hash:''}),useRouter:()=>({replace:vi.fn()})}))
type Node={text:string;props:Record<string,any>;children:Node[];parent?:Node}
const node=(text=''):Node=>({text,props:{},children:[]})
const renderer=createRenderer<Node,Node>({createElement:tag=>node(tag),createText:text=>node(text),createComment:()=>node(),setText:(el,text)=>{el.text=text},setElementText:(el,text)=>{el.children=[node(text)]},parentNode:el=>el.parent||null,nextSibling:el=>{const list=el.parent?.children||[];return list[list.indexOf(el)+1]||null},patchProp:(el,key,_old,value)=>{el.props[key]=value},insert:(el,parent,anchor)=>{if(el.parent)el.parent.children.splice(el.parent.children.indexOf(el),1);el.parent=parent;const index=anchor?parent.children.indexOf(anchor):-1;if(index<0)parent.children.push(el);else parent.children.splice(index,0,el)},remove:el=>{if(el.parent)el.parent.children.splice(el.parent.children.indexOf(el),1)},insertStaticContent:(text,parent)=>{const el=node(text);el.parent=parent;parent.children.push(el);return[el,el]}})
const text=(n:Node):string=>[n.text,...n.children.map(text)].join(' ')
const all=(n:Node,tag:string):Node[]=>[...(n.text===tag?[n]:[]),...n.children.flatMap(c=>all(c,tag))]
const wrapper=(tag:string)=>defineComponent({setup:(_,{slots,attrs})=>()=>h(tag,attrs,slots.default?.())})
const input=defineComponent({props:['modelValue','placeholder'],emits:['update:modelValue'],setup:(p,{emit})=>()=>h('input',{placeholder:p.placeholder,value:p.modelValue,onInput:(v:string)=>emit('update:modelValue',v)})})
const table=defineComponent({props:['data'],setup:p=>()=>h('table',(p.data||[]).map((r:any)=>h('row',`${r.rechargeNo} ${r.customerCode} ${r.amount}`)))})
const response={items:[{id:2,rechargeNo:'RC2',customerCode:'TKL1',amount:200},{id:1,rechargeNo:'RC1',customerCode:'TKL1',amount:100}],total:2,summary:{amount:300,confirmedAmount:300},paymentMethods:['bank']}
const cleanups:Array<()=>void>=[]
afterEach(()=>{cleanups.splice(0).forEach(f=>f());vi.clearAllMocks();vi.unstubAllGlobals()})
async function settle(){for(let i=0;i<12;i++){await Promise.resolve();await nextTick()}}
async function mount(){
 vi.stubGlobal('sessionStorage',{getItem:()=>null,setItem:()=>{},removeItem:()=>{}})
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{},removeItem:()=>{}})
 vi.mocked(customerApi.rechargeRecords).mockResolvedValue(response)
 const pinia=createPinia(),store=useAppStore(pinia);store.applyAuthUser({id:1,username:'finance',realName:'财务',roleCode:'finance',permissions:['budget_credit.view','budget_credit.create','budget_credit.export']})
 const root=node(),app=renderer.createApp(CustomerRechargeView,{embedded:true});app.use(pinia);app.config.warnHandler=()=>{}
 for(const tag of ['ElCard','ElFormItem','ElSelect','ElOption','ElDatePicker','ElInputNumber','ElPagination'])app.component(tag,wrapper('section'))
 app.component('ElForm',wrapper('form'));app.component('ElButton',wrapper('button'));app.component('ElInput',input);app.component('ElTable',table);app.component('ElAlert',defineComponent({props:['title'],setup:p=>()=>h('aside',p.title)}));app.component('ElTableColumn',wrapper('span'));app.mount(root);cleanups.push(()=>app.unmount());await settle();return root
}
describe('客户充值明细逐笔展示与搜索',()=>{
 it('同一客户的两笔充值分行展示，即使有充值权限也没有充值和明细操作按钮',async()=>{const root=await mount();expect(all(root,'row')).toHaveLength(2);expect(text(root)).toContain('RC2 TKL1 200');expect(text(root)).toContain('RC1 TKL1 100');const buttons=all(root,'button').map(n=>n.children.map(text).join('').trim());expect(buttons).not.toContain('充值');expect(buttons).not.toContain('明细');expect(buttons).toContain('查询');expect(buttons).toContain('重置');expect(buttons).toContain('导出本页明细')})
 it('完整关键词框输入与回车查询使用真实流水接口，失败不继续展示旧结果',async()=>{const root=await mount();const field=all(root,'input').find(n=>n.props.placeholder==='客户代码 / 名称 / 充值单号 / 备注')!;field.props.onInput(' RC1 ');await nextTick();all(root,'form')[0]!.props.onSubmit({preventDefault(){}});await settle();expect(customerApi.rechargeRecords).toHaveBeenLastCalledWith(expect.objectContaining({keyword:'RC1',page:1,pageSize:20}));vi.mocked(customerApi.rechargeRecords).mockRejectedValueOnce(Error('读取失败'));all(root,'form')[0]!.props.onSubmit({preventDefault(){}});await settle();expect(all(root,'row')).toHaveLength(0);expect(text(root)).toContain('重新查询充值明细')})
})
