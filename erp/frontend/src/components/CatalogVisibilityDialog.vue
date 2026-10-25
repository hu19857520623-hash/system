<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { pricingApi } from '@/api/client.js'
import { useAppStore } from '@/stores/app'
import { userFacingError } from '@erp/shared/user-facing-error'
type Attempt={id:number;sku:string;payload:{visibleStockQty:number;expectedVisibleStockQty:number|null;expectedReceivedGoodQty:number}}
const props=defineProps<{modelValue:boolean;pricingId?:number}>()
const emit=defineEmits<{'update:modelValue':[value:boolean];updated:[];'pending-change':[value:boolean]}>()
const app=useAppStore(),visible=computed({get:()=>props.modelValue,set:(v:boolean)=>emit('update:modelValue',v)})
const quote=ref<any>(null),quantity=ref(0),reading=ref(false),saving=ref(false),error=ref(''),storageError=ref(''),pending=ref<Attempt|null>(null),selectedId=ref<number>()
const allowed=computed(()=>app.hasPerm('pricing.set'))
const storageKey=(owner=Number(app.authenticatedUser?.id))=>`erp:catalog-visibility:${owner}`
function readPending(){
  try{const raw=localStorage.getItem(storageKey()),row=raw?JSON.parse(raw):null
    if(row&&(!Number.isSafeInteger(row.id)||row.id<=0||typeof row.sku!=='string'||!row.sku||!row.payload||![row.payload.visibleStockQty,row.payload.expectedReceivedGoodQty].every(n=>Number.isSafeInteger(n)&&n>=0)||!(row.payload.expectedVisibleStockQty===null||Number.isSafeInteger(row.payload.expectedVisibleStockQty)&&row.payload.expectedVisibleStockQty>=0)))throw new Error()
    pending.value=row;storageError.value='';emit('pending-change',!!row)
  }catch{storageError.value='原额度设置信息无法读取，请先核对商品操作记录，勿覆盖待核对设置';emit('pending-change',true)}
}
onMounted(readPending)
let sequence=0
async function load(){
  readPending();if(storageError.value)return
  const id=pending.value?.id||selectedId.value||props.pricingId,current=++sequence,owner=app.authenticatedUser?.id
  error.value='';quote.value=null
  if(!id){error.value='请从货盘列表选择商品后调整额度';return}
  selectedId.value=id;reading.value=true
  try{const row=await pricingApi.detail(id)
    if(current!==sequence||owner!==app.authenticatedUser?.id||!visible.value)return
    if(row.id!==id||typeof row.sku!=='string'||!Number.isSafeInteger(row.receivedGoodQty)||row.receivedGoodQty<0)throw new Error('累计实收范围未能核对，请重新读取')
    quote.value=row;quantity.value=pending.value?.payload.visibleStockQty??Math.min(row.visibleStockQty??row.receivedGoodQty,row.receivedGoodQty)
  }catch(e){if(current===sequence)error.value=`当前额度未能读取。${userFacingError(e)}`}
  finally{if(current===sequence)reading.value=false}
}
async function submit(){
  if(saving.value||reading.value||!allowed.value||storageError.value)return
  const owner=Number(app.authenticatedUser?.id)
  if(!Number.isSafeInteger(owner)||owner<=0){error.value='请使用原账号登录后核对额度';return}
  if(!pending.value&&(!quote.value||!Number.isSafeInteger(quantity.value)||quantity.value<0||quantity.value>quote.value.receivedGoodQty)){error.value='请在累计良品实收上限内填写非负整数额度';return}
  const attempt:Attempt=pending.value||{id:quote.value.id,sku:quote.value.sku,payload:{visibleStockQty:quantity.value,expectedVisibleStockQty:quote.value.visibleStockQty??null,expectedReceivedGoodQty:quote.value.receivedGoodQty}}
  saving.value=true;error.value='';let sent=false
  try{
    try{localStorage.setItem(storageKey(owner),JSON.stringify(attempt))}catch{throw new Error('无法保留原额度设置，本次尚未提交，请检查浏览器存储后重试')}
    pending.value=attempt;emit('pending-change',true)
    if(Number(app.authenticatedUser?.id)!==owner)throw new Error('登录账号已变化，请使用原账号核对额度')
    sent=true
    const result=await pricingApi.setVisibleStock(attempt.id,attempt.payload)
    if(Number(app.authenticatedUser?.id)!==owner)return
    if(result.id!==attempt.id||result.sku!==attempt.sku||result.visibleStockQty!==attempt.payload.visibleStockQty)throw new Error('返回结果与原额度设置不一致，请核对该商品')
    error.value=result.message||'额度设置已核对'
    if(!result.syncPending){localStorage.removeItem(storageKey(owner));pending.value=null;emit('pending-change',false);emit('updated');visible.value=false}
  }catch(e){
    if(Number(app.authenticatedUser?.id)!==owner)return
    const status=Number((e as {status?:unknown})?.status)
    if([400,404,422].includes(status)){
      try{localStorage.removeItem(storageKey(owner));pending.value=null;quote.value=null;emit('pending-change',false)}
      catch{storageError.value='原设置信息暂无法清除，请恢复浏览器存储后重新读取核对'}
    }
    error.value=sent?`额度结果待核对。${userFacingError(e)}${pending.value?(status===409?'；请重新读取，核对后可放弃原设置重新填写':'；原设置已保留，请重试核对原设置'):'；请重新读取当前额度后继续'}`:userFacingError(e)
  }finally{saving.value=false}
}
async function discardPending(){
  if(saving.value||reading.value||!quote.value)return
  try{localStorage.removeItem(storageKey());pending.value=null;emit('pending-change',false);await load()}
  catch{storageError.value='原设置信息暂无法清除，请恢复浏览器存储后重新读取核对'}
}
watch(()=>props.modelValue,v=>{if(v){selectedId.value=props.pricingId;void load()}else{++sequence;reading.value=false}})
watch(()=>app.authenticatedUser?.id,()=>{++sequence;quote.value=null;pending.value=null;selectedId.value=undefined;visible.value=false;reading.value=false;readPending()},{flush:'sync'})
</script>

<template>
  <el-dialog v-model="visible" title="调整总可见额度" width="650px" destroy-on-close>
    <el-alert type="info" :closable="false" title="总额度不超过累计良品实收，已售量另扣；在途与破损不计入。设置较低额度后不会自动补足。" />
    <el-alert v-if="storageError" :title="storageError" type="error" :closable="false" />
    <el-alert v-if="error" :title="error" type="warning" :closable="false" />
    <el-alert v-if="pending" :title="`原设置待核对：${pending.sku} · 总可见额度 ${pending.payload.visibleStockQty} 件`" type="warning" :closable="false" />
    <el-button :loading="reading" :disabled="saving" @click="load">重新读取当前额度</el-button>
    <el-descriptions v-if="quote" :column="2" border style="margin-top:14px">
      <el-descriptions-item label="商品" :span="2">{{ quote.name }} · {{ quote.sku }}</el-descriptions-item>
      <el-descriptions-item label="累计良品实收">{{ quote.receivedGoodQty }} 件</el-descriptions-item>
      <el-descriptions-item label="原设置总额度">{{ quote.visibleStockQty ?? '未设置' }}</el-descriptions-item>
      <el-descriptions-item label="有效可见总额度">{{ quote.catalogStockPool }} 件</el-descriptions-item>
      <el-descriptions-item label="已售量">{{ quote.soldQty }} 件</el-descriptions-item>
      <el-descriptions-item label="当前剩余可售">{{ quote.remainingStockQty }} 件</el-descriptions-item>
    </el-descriptions>
    <el-alert v-if="quote && quote.visibleStockQty > quote.receivedGoodQty" type="warning" :closable="false" title="原设置超过累计良品实收，当前已按实收限制；保存时请填写上限内的额度。" />
    <el-form v-if="quote||pending" label-width="140px" style="margin-top:14px">
      <el-form-item label="新总可见额度"><el-input-number v-model="quantity" :min="0" :max="quote?.receivedGoodQty ?? pending?.payload.expectedReceivedGoodQty ?? 0" :precision="0" :disabled="!allowed||saving||reading||!!pending" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible=false">{{ pending?'返回（保留原设置）':'取消' }}</el-button>
      <el-button v-if="pending" :disabled="saving||reading||!quote" @click="discardPending">放弃原设置并重新读取</el-button>
      <el-button type="primary" :loading="saving" :disabled="!allowed||reading||!!storageError||(!quote&&!pending)" @click="submit">{{ pending?'核对原设置并同步':'保存总可见额度' }}</el-button>
    </template>
  </el-dialog>
</template>
