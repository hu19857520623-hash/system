<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { inventoryApi } from '@/api/client.js'
import { fmtTime } from '@/api/mappers'
import { useAppStore } from '@/stores/app'
import { userFacingError } from '@erp/shared/user-facing-error'
import ListPagination from '@/components/ListPagination.vue'

type Refund = { id:number; referenceNo:string; customerCode:string; customerName:string; sku:string; quantity:number; amount:number; balanceBefore:number; balanceAfter:number; createdAt:string; operatorName:string; canRetrySync:boolean; remark:string; allocations:Array<{orderId:number;orderNo:string;quantity:number;unitPrice:number;amount:number}> }
const props=defineProps<{ modelValue:boolean }>()
const emit=defineEmits<{ 'update:modelValue':[value:boolean]; refreshed:[] }>()
const app=useAppStore()
const visible=computed({get:()=>props.modelValue,set:(value:boolean)=>emit('update:modelValue',value)})
const allowed=computed(()=>['admin','finance'].includes(app.authenticatedUser?.roleCode || '') && app.hasPerm('inventory_query.reclaim_refund'))
const rows=ref<Refund[]>([]),total=ref(0),page=ref(1),pageSize=ref(20),customerCode=ref(''),sku=ref('')
const loading=ref(false),error=ref(''),syncError=ref(''),syncSuccess=ref(''),busyId=ref<number|null>(null),detail=ref<Refund|null>(null),detailVisible=ref(false)
let sequence=0
async function load() {
  if (!visible.value || !allowed.value) {rows.value=[];total.value=0;return}
  const current=++sequence,owner=app.authenticatedUser?.id
  loading.value=true;error.value=''
  try {
    const result=await inventoryApi.catalogReclaimHistory({page:page.value,pageSize:pageSize.value,customerCode:customerCode.value.trim()||undefined,sku:sku.value.trim()||undefined})
    if(current!==sequence || owner!==app.authenticatedUser?.id || !visible.value)return
    if(!Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total<0)throw new Error('退款记录返回不完整，请重新读取')
    rows.value=result.items;total.value=result.total
  } catch(e) {if(current===sequence){rows.value=[];total.value=0;error.value=`退款记录未能读取。${userFacingError(e)}`}}
  finally {if(current===sequence)loading.value=false}
}
function search() {if(page.value!==1)page.value=1;else void load()}
function reset() {customerCode.value='';sku.value='';search()}
function showDetail(row:Refund) {detail.value=row;detailVisible.value=true}
async function retrySync(row:Refund) {
  if(busyId.value!==null || !allowed.value || !row.canRetrySync)return
  const owner=app.authenticatedUser?.id
  busyId.value=row.id;syncError.value='';syncSuccess.value=''
  try {
    const result=await inventoryApi.retryCatalogReclaimSync(row.id)
    if(owner!==app.authenticatedUser?.id)return
    if(result.referenceNo!==row.referenceNo || result.customerCode!==row.customerCode || result.quantity!==row.quantity || result.refundAmount!==row.amount || result.duplicate!==true)throw new Error('同步结果与原退款回执不一致，请核对该记录')
    if(result.syncPending)syncError.value=`${row.referenceNo}：原退款已保存，OMS仍待同步，可重试核对同步；不会重复退款。`
    else {syncSuccess.value=`${row.referenceNo}：原退款已核对，同步完成，未重复退款。`;emit('refreshed')}
  } catch(e) {if(owner===app.authenticatedUser?.id)syncError.value=`${row.referenceNo}：同步结果待核对，可重试同一记录；不会新增退款。${userFacingError(e)}`}
  finally {if(owner===app.authenticatedUser?.id)busyId.value=null}
}
watch(()=>props.modelValue,value=>{if(value)void load();else {++sequence;loading.value=false;detailVisible.value=false}})
watch([page,pageSize],()=>{void load()})
watch(()=>app.authenticatedUser?.id,()=>{++sequence;rows.value=[];total.value=0;error.value='';syncError.value='';syncSuccess.value='';busyId.value=null;detail.value=null;detailVisible.value=false;visible.value=false},{flush:'sync'})
</script>

<template>
  <el-dialog v-model="visible" title="收回退款记录" width="1100px" destroy-on-close>
    <el-alert type="info" :closable="false" style="margin-bottom:12px" title="记录来自 ERP 已保存的退款回执。持有归零后仍可查询；核对同步只更新 OMS 展示，不再次退钱。" />
    <el-form inline :disabled="loading || busyId !== null" @submit.prevent="search">
      <el-form-item label="客户代码"><el-input v-model="customerCode" maxlength="30" placeholder="完整客户代码" clearable @keyup.enter="search" /></el-form-item>
      <el-form-item label="SKU"><el-input v-model="sku" maxlength="30" placeholder="完整商品编码" clearable @keyup.enter="search" /></el-form-item>
      <el-form-item><el-button type="primary" @click="search">查询</el-button><el-button @click="reset">重置</el-button></el-form-item>
    </el-form>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-button v-if="error" :loading="loading" @click="load">重新读取退款记录</el-button>
    <el-alert v-if="syncError" :title="syncError" type="warning" :closable="false" />
    <el-alert v-if="syncSuccess" :title="syncSuccess" type="success" :closable="false" />
    <el-table v-if="!error" v-loading="loading" :data="rows" border stripe max-height="440" row-key="id">
      <el-table-column prop="referenceNo" label="退款单号" min-width="180" show-overflow-tooltip />
      <el-table-column prop="customerCode" label="客户代码" width="110" />
      <el-table-column prop="sku" label="SKU" min-width="140" show-overflow-tooltip />
      <el-table-column prop="quantity" label="收回数量" width="90" align="right" />
      <el-table-column label="已退款" width="100" align="right"><template #default="{ row }">¥{{ Number(row.amount).toFixed(2) }}</template></el-table-column>
      <el-table-column prop="operatorName" label="操作人" width="110" show-overflow-tooltip />
      <el-table-column label="退款时间" width="160"><template #default="{ row }">{{ fmtTime(row.createdAt) }}</template></el-table-column>
      <el-table-column label="操作" width="190" fixed="right"><template #default="{ row }">
        <el-button link type="primary" @click="showDetail(row as Refund)">明细</el-button>
        <el-button v-if="row.canRetrySync && allowed" link type="primary" :loading="busyId === row.id" :disabled="loading || busyId !== null" @click="retrySync(row as Refund)">核对同步</el-button>
        <span v-else style="font-size:12px;color:#64748b">原账号可核对同步</span>
      </template></el-table-column>
    </el-table>
    <ListPagination v-if="!error" v-model:page="page" v-model:page-size="pageSize" :total="total" />
    <template #footer><el-button @click="visible = false">返回货盘持有</el-button></template>
  </el-dialog>
  <el-dialog v-model="detailVisible" title="原退款明细" width="800px" append-to-body destroy-on-close>
    <template v-if="detail">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="退款单号" :span="2">{{ detail.referenceNo }}</el-descriptions-item>
        <el-descriptions-item label="客户">{{ detail.customerCode }} {{ detail.customerName }}</el-descriptions-item>
        <el-descriptions-item label="SKU">{{ detail.sku }}</el-descriptions-item>
        <el-descriptions-item label="收回数量">{{ detail.quantity }}</el-descriptions-item>
        <el-descriptions-item label="退款金额">¥{{ detail.amount.toFixed(2) }}</el-descriptions-item>
        <el-descriptions-item label="退款前余额（当时）">¥{{ detail.balanceBefore.toFixed(2) }}</el-descriptions-item>
        <el-descriptions-item label="退款后余额（当时）">¥{{ detail.balanceAfter.toFixed(2) }}</el-descriptions-item>
        <el-descriptions-item label="备注" :span="2">{{ detail.remark || '—' }}</el-descriptions-item>
      </el-descriptions>
      <p>按以下原购买单成交价退款：</p>
      <el-table :data="detail.allocations" border>
        <el-table-column prop="orderNo" label="原购买单号" min-width="180" />
        <el-table-column prop="quantity" label="退款数量" width="100" />
        <el-table-column label="原成交单价" width="120"><template #default="{ row }">¥{{ row.unitPrice.toFixed(2) }}</template></el-table-column>
        <el-table-column label="退款金额" width="120"><template #default="{ row }">¥{{ row.amount.toFixed(2) }}</template></el-table-column>
      </el-table>
    </template>
    <template #footer><el-button @click="detailVisible = false">返回退款记录</el-button></template>
  </el-dialog>
</template>
