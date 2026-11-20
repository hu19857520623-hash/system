<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { inventoryApi } from '@/api/client.js'
import { fmtTime } from '@/api/mappers'
import { useAppStore } from '@/stores/app'
import { getAccessToken } from '@/auth/tokenStore'
import { userFacingError } from '@erp/shared/user-facing-error'
import ListPagination from '@/components/ListPagination.vue'
const props=defineProps<{modelValue:boolean;initialSku?:string;initialCustomerCode?:string}>()
const emit=defineEmits<{'update:modelValue':[value:boolean]}>()
const app=useAppStore(),visible=computed({get:()=>props.modelValue,set:v=>emit('update:modelValue',v)})
const allowed=computed(()=>['pricing.view','inventory_query.view','inventory_query.detail','logistics_wh.view'].some(p=>app.hasPerm(p)))
const rows=ref<any[]>([]),total=ref(0),page=ref(1),pageSize=ref(20),summary=ref({quantity:0}),warnings=ref<string[]>([])
const customer=ref(''),product=ref(''),orderNo=ref(''),status=ref(''),dates=ref<[string,string]|null>(null),loading=ref(false),error=ref('')
const applied=ref<Record<string,unknown>>({}),detail=ref<any>(null),detailVisible=ref(false)
const labels:Record<string,string>={confirmed:'已入账',pending:'待入账',cancelled:'已取消',failed:'失败'}
const money=(value:any)=>value==null?'待核对':`¥${Number(value).toFixed(2)}`
let sequence=0
async function load(){
  if(!visible.value || !allowed.value)return
  const current=++sequence,owner=app.authenticatedUser?.id,token=getAccessToken()
  const active=()=>current===sequence && owner===app.authenticatedUser?.id && token===getAccessToken() && visible.value && allowed.value
  loading.value=true;error.value='';detailVisible.value=false;detail.value=null
  try {
    const result=await inventoryApi.catalogPurchases({...applied.value,page:page.value,pageSize:pageSize.value})
    if(!active())return
    if(!Array.isArray(result.items)||!Number.isSafeInteger(result.total)||result.total<0||!result.summary)throw Error('采购记录返回不完整，请重新读取')
    rows.value=result.items;total.value=result.total;summary.value={quantity:result.summary.quantity};warnings.value=result.warnings||[]
  }catch(e){if(active()){rows.value=[];total.value=0;summary.value={quantity:0};warnings.value=[];error.value=userFacingError(e)}}
  finally{if(active())loading.value=false}
}
function search(){
  applied.value={customerKeyword:customer.value.trim()||undefined,productKeyword:product.value.trim()||undefined,orderNo:orderNo.value.trim()||undefined,status:status.value||undefined,startDate:dates.value?.[0],endDate:dates.value?.[1]};page.value=1;void load()
}
function reset(){customer.value='';product.value='';orderNo.value='';status.value='';dates.value=null;search()}
function changePage(value:number){page.value=value;void load()}
function changeSize(value:number){pageSize.value=value;page.value=1;void load()}
function showDetail(row:any){detail.value=row;detailVisible.value=true}
watch(()=>[props.modelValue,props.initialSku,props.initialCustomerCode],()=>{
  ++sequence;rows.value=[];total.value=0;summary.value={quantity:0};warnings.value=[];error.value='';loading.value=false;detailVisible.value=false;detail.value=null
  if(!props.modelValue || !allowed.value)return
  customer.value=props.initialCustomerCode||'';product.value=props.initialSku||'';orderNo.value='';status.value='';dates.value=null;page.value=1
  applied.value={sku:props.initialSku||undefined,customerCode:props.initialCustomerCode||undefined};void load()
})
watch(()=>[app.authenticatedUser?.id,allowed.value],()=>{++sequence;rows.value=[];detail.value=null;detailVisible.value=false;loading.value=false;visible.value=false},{flush:'sync'})
</script>
<template>
  <el-dialog v-model="visible" title="OMS货盘采购记录" width="min(1400px, 96vw)" destroy-on-close>
    <el-alert type="info" :closable="false" title="来自OMS原采购单，按当时成交价展示；当前持有归零后仍保留记录。退回数量仅统计已审核入账的退款，净采购不等同于当前可用库存。" style="margin-bottom:12px" />
    <el-form inline :disabled="loading" @submit.prevent="search">
      <el-form-item label="客户"><el-input v-model="customer" placeholder="客户代码 / 名称" maxlength="100" clearable /></el-form-item>
      <el-form-item label="商品"><el-input v-model="product" placeholder="SKU / 商品名称" maxlength="100" clearable /></el-form-item>
      <el-form-item label="采购单号"><el-input v-model="orderNo" placeholder="采购单号" maxlength="50" clearable /></el-form-item>
      <el-form-item label="采购日期"><el-date-picker v-model="dates" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" style="width:240px" /></el-form-item>
      <el-form-item label="采购状态"><el-select v-model="status" clearable placeholder="全部" style="width:120px"><el-option v-for="(label,key) in labels" :key="key" :value="key" :label="label" /></el-select></el-form-item>
      <el-form-item><el-button type="primary" @click="search">查询</el-button><el-button @click="reset">重置 / 查看全部</el-button><el-button @click="load">刷新记录</el-button></el-form-item>
    </el-form>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-button v-if="error" :loading="loading" @click="load">重新读取采购记录</el-button>
    <el-alert v-for="warning in warnings" :key="warning" :title="warning" type="warning" :closable="false" />
    <template v-if="!error">
      <p>筛选结果共 {{ total }} 笔 · 原采购数量 {{ summary.quantity }} 件</p>
      <el-table :data="rows" v-loading="loading" border stripe max-height="460" row-key="id" empty-text="暂无符合条件的OMS货盘采购记录">
        <el-table-column label="采购时间" width="155"><template #default="{row}">{{ fmtTime(row.createdAt) }}</template></el-table-column>
        <el-table-column prop="orderNo" label="OMS采购单号" min-width="180" show-overflow-tooltip />
        <el-table-column prop="customerCode" label="客户代码" width="110" />
        <el-table-column prop="customerName" label="客户名称" min-width="125" show-overflow-tooltip />
        <el-table-column prop="sku" label="SKU" min-width="155" show-overflow-tooltip />
        <el-table-column prop="productName" label="商品名称" min-width="150" show-overflow-tooltip />
        <el-table-column prop="priceTier" label="成交档位" width="85" />
        <el-table-column prop="quantity" label="原采购数量" width="105" align="right" />
        <el-table-column label="原成交单价" width="110" align="right"><template #default="{row}">{{ money(row.unitPrice) }}</template></el-table-column>
        <el-table-column label="已退回数量" width="105" align="right"><template #default="{row}">{{ row.refundedQuantity??'待核对' }}</template></el-table-column>
        <el-table-column label="净采购数量" width="105" align="right"><template #default="{row}">{{ row.netQuantity??'待核对' }}</template></el-table-column>
        <el-table-column label="采购状态" width="90"><template #default="{row}">{{ labels[row.status]||row.status }}</template></el-table-column>
        <el-table-column label="操作" width="75" fixed="right"><template #default="{row}"><el-button link type="primary" @click="showDetail(row)">详情</el-button></template></el-table-column>
      </el-table>
      <ListPagination :page="page" :page-size="pageSize" :total="total" @update:page="changePage" @update:page-size="changeSize" />
    </template>
    <template #footer><el-button @click="visible=false">返回货盘库存</el-button></template>
  </el-dialog>
  <el-dialog v-model="detailVisible" title="OMS采购与退回明细" width="820px" append-to-body destroy-on-close>
    <template v-if="detail">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="采购单号" :span="2">{{ detail.orderNo }}</el-descriptions-item>
        <el-descriptions-item label="客户">{{ detail.customerCode }} {{ detail.customerName }}</el-descriptions-item>
        <el-descriptions-item label="SKU">{{ detail.sku }}</el-descriptions-item>
        <el-descriptions-item label="商品" :span="2">{{ detail.productName||'—' }}</el-descriptions-item>
        <el-descriptions-item label="采购时间">{{ fmtTime(detail.createdAt) }}</el-descriptions-item>
        <el-descriptions-item label="成交档位">{{ detail.priceTier }}档</el-descriptions-item>
        <el-descriptions-item label="原采购数量">{{ detail.quantity }}</el-descriptions-item>
        <el-descriptions-item label="原成交单价">{{ money(detail.unitPrice) }}</el-descriptions-item>
        <el-descriptions-item label="已退回金额">{{ money(detail.refundAmount) }}</el-descriptions-item>
        <el-descriptions-item label="已退回数量">{{ detail.refundedQuantity??'待核对' }}</el-descriptions-item>
        <el-descriptions-item label="净采购数量">{{ detail.netQuantity??'待核对' }}</el-descriptions-item>
        <el-descriptions-item v-if="detail.refundAmount > 0" label="净采购金额">{{ money(detail.netAmount) }}</el-descriptions-item>
        <el-descriptions-item label="采购状态">{{ labels[detail.status]||detail.status }}</el-descriptions-item>
        <el-descriptions-item label="采购前余额（当时）">{{ money(detail.balanceBefore) }}</el-descriptions-item>
        <el-descriptions-item label="采购后余额（当时）">{{ money(detail.balanceAfter) }}</el-descriptions-item>
      </el-descriptions>
      <p>已审核退回记录（不会改写原采购单）：</p>
      <el-alert v-if="!detail.refundVerified" title="退款依据待核对，暂不展示退回数量和净金额" type="warning" :closable="false" />
      <el-table v-else :data="detail.refunds" border empty-text="暂无已审核退回记录">
        <el-table-column prop="referenceNo" label="退款流水" min-width="220" />
        <el-table-column prop="quantity" label="退回数量" width="100" />
        <el-table-column label="退回金额" width="110"><template #default="{row}">{{ money(row.amount) }}</template></el-table-column>
        <el-table-column label="退回时间" width="160"><template #default="{row}">{{ fmtTime(row.createdAt) }}</template></el-table-column>
      </el-table>
    </template>
    <template #footer><el-button @click="detailVisible=false">返回采购记录</el-button></template>
  </el-dialog>
</template>
