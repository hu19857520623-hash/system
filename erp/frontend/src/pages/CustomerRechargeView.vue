<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { customerApi } from '@/api/client.js'
import { fmtTime } from '@/api/mappers'
import { useAppStore } from '@/stores/app'
import { getAccessToken } from '@/auth/tokenStore'
import { downloadCsv } from '@/utils/csv'
import { userFacingError } from '@erp/shared/user-facing-error'
import ListPagination from '@/components/ListPagination.vue'
defineOptions({name:'CustomerRechargeView'})
withDefaults(defineProps<{embedded?:boolean}>(),{embedded:false})
const app=useAppStore(),route=useRoute(),router=useRouter()
const keyword=ref(''),customer=ref(''),rechargeNo=ref(''),method=ref(''),status=ref(''),dates=ref<[string,string]|null>(null)
const minAmount=ref<number|undefined>(),maxAmount=ref<number|undefined>(),scopeCustomerId=ref<number|undefined>()
const rows=ref<any[]>([]),total=ref(0),page=ref(1),pageSize=ref(20),loading=ref(false),error=ref(''),routeError=ref('')
const summary=ref({amount:0,confirmedAmount:0}),methods=ref<string[]>([]),applied=ref<Record<string,unknown>>({})
const statuses:Record<string,string>={confirmed:'已确认',pending:'待确认',cancelled:'已取消',failed:'失败'}
const methodLabels:Record<string,string>={bank:'银行转账',cash:'现金',alipay:'支付宝',wechat:'微信',card:'银行卡',other:'其他'}
const allowed=computed(()=>app.hasPerm('budget_credit.view'))
const money=(v:number)=>`¥${Number(v).toFixed(2)}`
let sequence=0,active=true,firstActivation=true
function query(){return {keyword:keyword.value.trim()||undefined,customerKeyword:customer.value.trim()||undefined,rechargeNo:rechargeNo.value.trim()||undefined,paymentMethod:method.value||undefined,status:status.value||undefined,startDate:dates.value?.[0],endDate:dates.value?.[1],minAmount:minAmount.value??undefined,maxAmount:maxAmount.value??undefined,customerId:scopeCustomerId.value}}
function clearResults(){rows.value=[];total.value=0;summary.value={amount:0,confirmedAmount:0}}
async function load(){
  if(!active||!allowed.value||routeError.value)return
  const current=++sequence,owner=app.authenticatedUser?.id,token=getAccessToken()
  const currentScope=()=>active&&current===sequence&&owner===app.authenticatedUser?.id&&token===getAccessToken()&&allowed.value
  loading.value=true;error.value=''
  try{
    const result=await customerApi.rechargeRecords({...applied.value,page:page.value,pageSize:pageSize.value})
    if(!currentScope())return
    if(!Array.isArray(result.items)||!Number.isSafeInteger(result.total)||result.total<0||!result.summary)throw Error('充值明细返回不完整，请重新查询')
    rows.value=result.items;total.value=result.total;summary.value=result.summary;methods.value=result.paymentMethods||[]
  }catch(e){if(currentScope()){clearResults();error.value=userFacingError(e)}}finally{if(currentScope())loading.value=false}
}
function search(){applied.value=query();page.value=1;void load()}
function initialScope(){
  routeError.value='';scopeCustomerId.value=undefined
  const raw=route.query.customerId
  if(raw!=null&&raw!==''){
    const id=Number(raw)
    if(Array.isArray(raw)||!Number.isSafeInteger(id)||id<=0){routeError.value='客户筛选参数无效，请点击重置查看全部充值记录';clearResults();return}
    scopeCustomerId.value=id
  }
  search()
}
function reset(){
  keyword.value='';customer.value='';rechargeNo.value='';method.value='';status.value='';dates.value=null;minAmount.value=undefined;maxAmount.value=undefined;scopeCustomerId.value=undefined;routeError.value=''
  if(route.query.customerId!=null){void router.replace({path:route.path,query:{...route.query,customerId:undefined},hash:route.hash})}
  search()
}
function changePage(v:number){page.value=v;void load()}
function changeSize(v:number){pageSize.value=v;page.value=1;void load()}
function exportPage(){
  if(loading.value||error.value||!app.hasPerm('budget_credit.export')||!rows.value.length)return
  const day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})
  downloadCsv(`客户充值明细_${day}_第${page.value}页.csv`,['充值时间','充值单号','客户代码','客户名称','充值金额(RMB)','支付方式','状态','操作人','备注'],rows.value.map(r=>[fmtTime(r.createdAt),r.rechargeNo,r.customerCode,r.customerName,Number(r.amount).toFixed(2),methodLabels[r.paymentMethod]||r.paymentMethod,statuses[r.status]||r.status,r.operatorName,r.remark]))
}
onMounted(initialScope)
onActivated(()=>{active=true;if(firstActivation){firstActivation=false;return}void load()})
onDeactivated(()=>{active=false;++sequence;loading.value=false})
watch(()=>route.query.customerId,initialScope)
watch(()=>[app.authenticatedUser?.id,allowed.value],()=>{++sequence;clearResults();error.value='';loading.value=false;if(allowed.value)void load()},{flush:'sync'})
</script>
<template>
  <el-card :class="{'is-embedded':embedded}" :shadow="embedded?'never':undefined">
    <template v-if="!embedded" #header><span class="page-title">客户充值明细</span></template>
    <el-form inline :disabled="loading" class="recharge-filters" @submit.prevent="search">
      <el-form-item label="关键词"><el-input v-model="keyword" clearable maxlength="100" placeholder="客户代码 / 名称 / 充值单号 / 备注" style="width:300px" /></el-form-item>
      <el-form-item label="客户"><el-input v-model="customer" clearable maxlength="100" placeholder="客户代码 / 名称" /></el-form-item>
      <el-form-item label="充值单号"><el-input v-model="rechargeNo" clearable maxlength="50" placeholder="完整或部分充值单号" /></el-form-item>
      <el-form-item label="支付方式"><el-select v-model="method" clearable placeholder="全部支付方式" style="width:155px"><el-option v-for="m in methods" :key="m" :value="m" :label="methodLabels[m]||m" /></el-select></el-form-item>
      <el-form-item label="状态"><el-select v-model="status" clearable placeholder="全部状态" style="width:125px"><el-option v-for="(label,key) in statuses" :key="key" :value="key" :label="label" /></el-select></el-form-item>
      <el-form-item label="充值日期"><el-date-picker v-model="dates" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" style="width:250px" /></el-form-item>
      <el-form-item label="金额范围"><el-input-number v-model="minAmount" :min="0" :max="999999999999.99" :precision="2" :controls="false" placeholder="最低金额" style="width:140px" /><span style="margin:0 8px">至</span><el-input-number v-model="maxAmount" :min="0" :max="999999999999.99" :precision="2" :controls="false" placeholder="最高金额" style="width:140px" /></el-form-item>
      <el-form-item><el-button type="primary" native-type="submit">查询</el-button><el-button @click="reset">重置</el-button><el-button @click="load">刷新</el-button><el-button v-if="app.hasPerm('budget_credit.export')" :disabled="!rows.length||!!error" @click="exportPage">导出本页明细</el-button></el-form-item>
    </el-form>
    <el-alert v-if="scopeCustomerId" type="info" :closable="false" title="当前按指定客户筛选，点击重置可查看全部客户的逐笔充值记录。" />
    <el-alert v-if="error||routeError" :title="error||routeError" type="error" :closable="false" />
    <el-button v-if="error" :loading="loading" @click="load">重新查询充值明细</el-button>
    <template v-if="!error&&!routeError">
      <div class="recharge-summary"><span>充值记录 <strong>{{ total }}</strong> 笔</span><span>筛选金额合计 <strong>{{ money(summary.amount) }}</strong></span><span>已确认入账金额 <strong>{{ money(summary.confirmedAmount) }}</strong></span></div>
      <el-table v-loading="loading" :data="rows" row-key="id" border stripe empty-text="暂无符合条件的充值记录">
        <el-table-column label="充值时间" width="160"><template #default="{row}">{{ fmtTime(row.createdAt) }}</template></el-table-column>
        <el-table-column prop="rechargeNo" label="充值单号" min-width="190" show-overflow-tooltip />
        <el-table-column prop="customerCode" label="客户代码" width="115" />
        <el-table-column prop="customerName" label="客户名称" min-width="170" show-overflow-tooltip />
        <el-table-column label="充值金额(RMB)" width="145" align="right"><template #default="{row}">{{ money(row.amount) }}</template></el-table-column>
        <el-table-column label="支付方式" width="120"><template #default="{row}">{{ methodLabels[row.paymentMethod]||row.paymentMethod }}</template></el-table-column>
        <el-table-column label="状态" width="100"><template #default="{row}"><el-tag :type="row.status==='confirmed'?'success':'info'">{{ statuses[row.status]||row.status }}</el-tag></template></el-table-column>
        <el-table-column prop="operatorName" label="操作人" min-width="130" />
        <el-table-column prop="remark" label="备注" min-width="230" show-overflow-tooltip />
      </el-table>
      <ListPagination :page="page" :page-size="pageSize" :total="total" @update:page="changePage" @update:page-size="changeSize" />
    </template>
  </el-card>
</template>
<style scoped>
.recharge-filters { margin-bottom:8px; }
.recharge-summary { display:flex;gap:28px;flex-wrap:wrap;padding:12px 0 18px;color:var(--text-muted); }
.recharge-summary strong { color:var(--text);margin-left:6px; }
</style>
