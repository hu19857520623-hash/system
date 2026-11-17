<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { pricingApi } from '@/api/client.js'
import { useAppStore } from '@/stores/app'
import { getAccessToken } from '@/auth/tokenStore'
import { downloadCsv } from '@/utils/csv'
import { priceTiers, priceImportHeaders, readPriceImportFile, type PriceDraft, type Prices } from '@/utils/catalogPriceImport'
import { readPriceBatchAttempt, assertPriceBatchReceipt, type BatchPayload } from '@/utils/catalogPriceBatchAttempt'
import { userFacingError } from '@erp/shared/user-facing-error'
const props=defineProps<{modelValue:boolean}>()
const emit=defineEmits<{'update:modelValue':[value:boolean];updated:[]}>()
const app=useAppStore(), visible=computed({get:()=>props.modelValue,set:v=>emit('update:modelValue',v)})
const rows=ref<PriceDraft[]>([]), selected=ref<PriceDraft[]>([]), search=ref(''), total=ref(0), remark=ref('')
const busy=ref(false), error=ref(''), notice=ref(''), blocked=ref(false), attempt=ref<BatchPayload|null>(null)
const preview=ref<{items:Array<{id:number;sku:string;name:string;prices:Prices;expectedPrices:Prices}>;errors:Array<{line:number;sku:string;message:string}>;canSubmit:boolean}|null>(null)
const input=ref<HTMLInputElement|null>(null), uniformTier=ref<typeof priceTiers[number]>('B'), uniformValue=ref<number|undefined>()
const storageKey=computed(()=>`erp.pricing.prices-batch.${app.authenticatedUser?.id}`)
const locked=computed(()=>busy.value || !!attempt.value || blocked.value)
let revision=0
function context() {const owner=app.authenticatedUser?.id, token=getAccessToken(), epoch=revision;return ()=>props.modelValue && owner===app.authenticatedUser?.id && token===getAccessToken() && epoch===revision}
function invalidate(){preview.value=null;notice.value=''}
watch(rows,invalidate,{deep:true})
watch(()=>[props.modelValue,app.authenticatedUser?.id],()=>{
  revision++;busy.value=false;error.value='';notice.value='';preview.value=null;rows.value=[];selected.value=[];blocked.value=false;attempt.value=null;remark.value='';total.value=0
  if(!props.modelValue || !app.authenticatedUser?.id)return
  try {attempt.value=readPriceBatchAttempt(localStorage,storageKey.value)} catch(e) {blocked.value=true;error.value=userFacingError(e)}
})
async function load() {
  if(locked.value)return
  const active=context();busy.value=true;error.value='';preview.value=null
  try {const result=await pricingApi.batchPriceItems({keyword:search.value.trim()||undefined});if(!active())return;rows.value=result.items.map((r:any)=>({sku:r.sku,name:r.name,prices:{...r.prices}}));total.value=result.total}
  catch(e){if(active())error.value=userFacingError(e)}finally{if(active())busy.value=false}
}
function downloadTemplate(){downloadCsv('货盘四档价格导入模板.csv',priceImportHeaders,[])}
function exportRows(){downloadCsv('货盘当前四档价格.csv',priceImportHeaders,rows.value.map(r=>[r.sku,r.name||'',...priceTiers.map(t=>r.prices[t]??'')]))}
async function upload(event:Event) {
  const file=(event.target as HTMLInputElement).files?.[0];if(!file || locked.value)return
  const active=context();busy.value=true;error.value='';preview.value=null
  try {const imported=await readPriceImportFile(file);if(!active())return;rows.value=imported;selected.value=[];total.value=imported.length;notice.value=`已读取 ${imported.length} 行，尚未保存，请预览校验。`}
  catch(e){if(active())error.value=userFacingError(e)}finally{if(active())busy.value=false;if(input.value)input.value.value=''}
}
function uniform(clear=false) {
  if(locked.value || !selected.value.length)return
  if(clear && uniformTier.value==='A')return
  if(!clear && (!uniformValue.value || uniformValue.value<=0)){error.value='请填写要批量设置的价格';return}
  selected.value.forEach(r=>{r.prices[uniformTier.value]=clear?null:uniformValue.value!});invalidate()
}
async function validate() {
  if(locked.value || !rows.value.length)return
  const active=context();busy.value=true;error.value='';notice.value=''
  try {const result=await pricingApi.previewBatchPrices(rows.value);if(active())preview.value=result}
  catch(e){if(active())error.value=userFacingError(e)}finally{if(active())busy.value=false}
}
function finish(result:any,payload:BatchPayload) {
  const receipt=assertPriceBatchReceipt(result,payload)
  if(receipt.status==='unknown'){error.value='尚未查到原批次结果，请继续提交原批次，或取消原批次后重新预览。';return}
  localStorage.removeItem(storageKey.value);attempt.value=null;preview.value=null
  notice.value=receipt.status==='applied'?`原批次已保存：${receipt.total} 个商品，修改 ${receipt.changed} 个，未变化 ${receipt.unchanged} 个。`:'原批次已取消，迟到请求不会再覆盖价格；可修改后重新预览。'
  if(receipt.status==='applied')emit('updated')
}
async function run(mode:'submit'|'check'|'cancel') {
  if(busy.value || blocked.value)return
  const active=context();busy.value=true;error.value='';notice.value=''
  try {
    let payload=attempt.value
    if(!payload) {
      if(mode!=='submit' || !preview.value?.canSubmit || !remark.value.trim())return
      const previous=readPriceBatchAttempt(localStorage,storageKey.value)
      if(previous){attempt.value=previous;error.value='发现原批次待核对，请先处理原批次';return}
      payload={requestId:crypto.randomUUID(),remark:remark.value.trim(),rows:preview.value.items.map(r=>({id:r.id,prices:r.prices,expectedPrices:r.expectedPrices}))}
      localStorage.setItem(storageKey.value,JSON.stringify(payload));attempt.value=payload
    }
    const result=mode==='check'?await pricingApi.batchPriceReceipt(payload.requestId):mode==='cancel'?await pricingApi.cancelBatchPrices(payload.requestId):await pricingApi.saveBatchPrices(payload)
    if(active())finish(result,payload)
  } catch(e){if(active())error.value=`${userFacingError(e)}${attempt.value?' 原批次已保留；请核对结果或取消原批次后重新预览。':''}`}
  finally{if(active())busy.value=false}
}
</script>
<template>
  <el-dialog v-model="visible" title="四档价格 · 批量上传 / 修改" width="min(1200px, 96vw)" :close-on-click-modal="false" :show-close="!busy" :close-on-press-escape="!busy">
    <el-alert type="info" :closable="false" title="支持.xlsx（第一个工作表）和.csv，每批最多500个商品、文件不超过5MB。按SKU匹配，空白保留原价；填写“清空”可清除B/C/D档，A档不能清空。预览后整批保存。" />
    <el-alert v-if="error" :title="error" type="error" :closable="false" style="margin-top:12px" />
    <el-alert v-if="notice" :title="notice" type="success" :closable="false" style="margin-top:12px" />
    <div v-if="attempt" style="margin:12px 0">
      <p>原批次 {{ attempt.requestId }} 待核对，涉及 {{ attempt.rows.length }} 个商品。请使用原请求继续，不要创建重复批次。</p>
      <el-button :disabled="busy" @click="run('check')">核对原批次结果</el-button>
      <el-button :disabled="busy" type="primary" @click="run('submit')">继续提交原批次</el-button>
      <el-button :disabled="busy" @click="run('cancel')">取消原批次</el-button>
    </div>
    <template v-else>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0">
        <el-button :disabled="locked" @click="downloadTemplate">下载模板（CSV）</el-button>
        <el-button :disabled="locked" @click="input?.click()">上传Excel / CSV</el-button>
        <input ref="input" type="file" accept=".xlsx,.csv" hidden @change="upload" />
        <el-input v-model="search" :disabled="locked" placeholder="SKU / 商品名称" style="width:200px" @keyup.enter="load" />
        <el-button :disabled="locked" @click="load">加载现有价格</el-button>
        <el-button :disabled="locked || !rows.length" @click="exportRows">导出表内价格</el-button>
      </div>
      <p v-if="total>500">匹配 {{ total }} 个商品，本次仅加载前500个。请缩小搜索范围或分批上传；导出仅包含表内商品。</p>
      <div v-if="rows.length" style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
        <span>已选 {{ selected.length }} 个</span>
        <el-select v-model="uniformTier" :disabled="locked" style="width:100px"><el-option v-for="tier in priceTiers" :key="tier" :value="tier" :label="tier+'档'" /></el-select>
        <el-input-number v-model="uniformValue" :disabled="locked" :min="0.01" :max="9999999999.99" :precision="2" :controls="false" placeholder="统一价格" />
        <el-button :disabled="locked || !selected.length" @click="uniform()">设置所选商品</el-button>
        <el-button :disabled="locked || !selected.length || uniformTier==='A'" @click="uniform(true)">清空所选档价</el-button>
      </div>
      <el-table :data="rows" max-height="300" size="small" @selection-change="selected=$event">
        <el-table-column type="selection" width="45" :selectable="()=>!locked" />
        <el-table-column label="SKU" width="200"><template #default="{row}"><el-input v-model="row.sku" :disabled="locked" maxlength="30" /></template></el-table-column>
        <el-table-column prop="name" label="商品" min-width="140" />
        <el-table-column v-for="tier in priceTiers" :key="tier" :label="tier+'档价格'" min-width="165"><template #default="{row}">
          <el-input-number v-model="row.prices[tier]" :disabled="locked" :min="0.01" :max="9999999999.99" :precision="2" :controls="false" :placeholder="row.prices[tier]===null?'清空定价':'保留原价'" style="width:130px" />
          <el-button v-if="tier!=='A'" link :disabled="locked" @click="row.prices[tier]=null">清空</el-button>
        </template></el-table-column>
        <el-table-column label="操作" width="65"><template #default="{row}"><el-button link type="danger" :disabled="locked" @click="rows=rows.filter(r=>r!==row)">移除</el-button></template></el-table-column>
      </el-table>
      <el-input v-model="remark" :disabled="locked" type="textarea" maxlength="500" placeholder="填写本批调价原因（必填）" style="margin:12px 0" />
      <template v-if="preview">
        <el-alert :type="preview.canSubmit?'success':'error'" :closable="false" :title="preview.canSubmit?`校验通过：${preview.items.length}个商品，请核对原价→新价后确认保存`:`有${preview.errors.length}行错误，整批尚未保存；修改后重新预览`" />
        <p v-for="item in preview.errors" :key="item.line" style="color:var(--el-color-danger)">第{{ item.line }}行 · {{ item.sku }}：{{ item.message }}</p>
        <el-table :data="preview.items" max-height="250" size="small">
          <el-table-column prop="sku" label="匹配SKU" width="190" /><el-table-column prop="name" label="商品" min-width="140" />
          <el-table-column v-for="tier in priceTiers" :key="tier" :label="tier+'档：原价 → 新价'" min-width="155"><template #default="{row}">{{ row.expectedPrices[tier]??'未定价' }} → {{ row.prices[tier]??'未定价' }}</template></el-table-column>
        </el-table>
      </template>
    </template>
    <template #footer>
      <el-button :disabled="busy" @click="visible=false">关闭</el-button>
      <el-button v-if="!attempt" :disabled="locked || !rows.length" @click="validate">预览校验</el-button>
      <el-button v-if="!attempt" type="primary" :disabled="locked || !preview?.canSubmit || !remark.trim()" @click="run('submit')">确认整批保存</el-button>
    </template>
  </el-dialog>
</template>
