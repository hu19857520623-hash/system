<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { asyncIoApi } from '@/api/client.js'
import { fmtTime } from '@/api/mappers.ts'
import { useAsyncIo } from '@/composables/useAsyncIo'
import { useAppStore } from '@/stores/app'
import { internalRedirect } from '@/auth/internalRedirect'
import { downloadLeadsImportTemplate, downloadProductImportTemplate, downloadPurchaseOrderImportTemplate } from '@/constants/importTemplates.ts'
import { parseImportFailures } from '@/utils/importResultFeedback.ts'
import { downloadImportFailuresCsv, formatImportFailureLine } from '@/utils/importFailureDetail.ts'
import { asyncJobState, asyncJobNextStep, asyncJobError, asyncFilterSummary, asyncModuleLabel } from '@/utils/asyncIoFeedback'
import { userFacingError } from '@erp/shared/user-facing-error'
import ListPagination from '@/components/ListPagination.vue'

const { importCsv, downloadJob, exportModule, exportBusy } = useAsyncIo()
const app = useAppStore(), route = useRoute(), router = useRouter()
const tab = ref(route.query.tab === 'export' ? 'export' : 'import')
const loading = ref(false), error = ref(''), items = ref<any[]>([]), total = ref(0)
const page = ref(1), pageSize = ref(20), scope = ref('own')
const detailVisible = ref(false), detailLoading = ref(false), detailError = ref(''), detail = ref<any>(null), detailId = ref<number | null>(null)
const retrying = ref(false), importBusy = ref(false)
let listVersion = 0, detailVersion = 0
const returnTo = computed(() => internalRedirect(route.query.returnTo))
const failures = computed(() => parseImportFailures(detail.value))
const importModules = [
  { module: '线索', label: '线索', perm: 'leads_pool.create', template: downloadLeadsImportTemplate },
  { module: '商品主数据', label: '商品', perm: 'products.import', template: downloadProductImportTemplate },
  { module: '采购订单', label: '采购单', perm: 'purchase.create', template: downloadPurchaseOrderImportTemplate },
]
const allowedImports = computed(() => importModules.filter(m => app.hasPerm('async_io.import') && app.hasPerm(m.perm)))

async function load() {
  const version = ++listVersion
  loading.value = true; error.value = ''
  try {
    const res = await asyncIoApi.list({ jobType: tab.value, page: page.value, pageSize: pageSize.value })
    if (version !== listVersion) return
    items.value = res.items || []; total.value = res.total ?? 0; scope.value = res.scope || 'own'
    if (page.value > 1 && !items.value.length && total.value) page.value = Math.ceil(total.value / pageSize.value)
  } catch (e) {
    if (version !== listVersion) return
    items.value = []; total.value = 0; error.value = userFacingError(e)
  } finally { if (version === listVersion) loading.value = false }
}
async function openDetail(id: number) {
  const version = ++detailVersion
  detailId.value = id; detailVisible.value = true; detailLoading.value = true; detailError.value = ''; detail.value = null
  try {
    const job = await asyncIoApi.detail(id)
    if (version === detailVersion) detail.value = job
  } catch (e) { if (version === detailVersion) detailError.value = userFacingError(e) }
  finally { if (version === detailVersion) detailLoading.value = false }
}
async function retryExport(restart = false) {
  if (retrying.value || !(restart ? detail.value?.canRestart : detail.value?.canRetry)) return
  const id = detail.value.id, attempt = detail.value.retryAttempt
  retrying.value = true
  try {
    const job = await (restart ? asyncIoApi.restart(id, attempt) : asyncIoApi.retry(id, attempt))
    if (detailId.value === id) { detail.value = job; detailId.value = job.id }
    if (job.status === 'completed') ElMessage.success('重试已完成，可以下载文件')
    else ElMessage.warning('任务尚未成功，请查看详情后核对')
  } catch (e) {
    ElMessage.error(userFacingError(e) + '；请刷新任务核对结果后再试')
    // An uncertain response must be reread before enabling another attempt.
    if (detailId.value === id) await openDetail(id)
  } finally { retrying.value = false; await load() }
}
async function upload(module: string) {
  if (importBusy.value) return
  importBusy.value = true
  try { await importCsv(module); await load() } finally { importBusy.value = false }
}
async function newExport() { await exportModule('库存'); await load() }
function closeDetail() { ++detailVersion; detail.value = null; detailId.value = null }
watch(tab, () => { page.value = 1; void load() })
watch([page, pageSize], load)
watch(() => route.query.tab, value => { if (value === 'import' || value === 'export') tab.value = value })
watch(() => route.query.jobId, value => {
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))) void openDetail(Number(value))
}, { immediate: true })
onBeforeUnmount(() => { ++listVersion; ++detailVersion })
void load()
</script>

<template>
  <el-card v-loading="loading">
    <template #header>
      <div class="task-header"><span class="page-title">异步导出导入</span><div>
        <el-button size="small" @click="router.push(returnTo)">{{ route.query.returnTo ? '返回来源页面' : '返回工作台' }}</el-button>
        <el-button size="small" :loading="loading" @click="load">刷新任务</el-button>
      </div></div>
    </template>
    <el-alert :title="scope === 'all' ? '显示全部任务；重试或恢复仅限本人创建的导出。' : '显示本人有权限模块的任务。'" type="info" :closable="false" />
    <el-tabs v-model="tab" type="card">
      <el-tab-pane label="导入任务" name="import" /><el-tab-pane label="导出任务" name="export" />
    </el-tabs>
    <el-alert v-if="error" :title="error" type="error" :closable="false"><el-button link type="primary" @click="load">重新加载任务</el-button></el-alert>
    <div class="task-actions" v-if="tab === 'import'">
      <template v-for="m in allowedImports" :key="m.module">
        <el-button type="primary" size="small" :disabled="importBusy" @click="upload(m.module)">上传模板导入{{ m.label }}</el-button>
        <el-button link size="small" type="primary" @click="m.template">下载{{ m.label }}导入模板</el-button>
      </template>
      <span v-if="!allowedImports.length">当前账号没有导入权限，可查看有权限的历史任务。</span>
    </div>
    <div class="task-actions" v-else>
      <el-button v-if="app.hasPerm('inventory_query.export')" type="primary" size="small" :loading="exportBusy" @click="newExport">新建导出任务（库存）</el-button>
    </div>
    <el-table :data="items" stripe border size="small">
      <el-table-column prop="jobNo" label="任务编号" min-width="235" />
      <el-table-column label="类型" width="110"><template #default="{ row }">{{ asyncModuleLabel(row.module) }}</template></el-table-column>
      <el-table-column prop="fileName" label="文件名" min-width="180" />
      <el-table-column prop="totalRows" label="行数" width="65" align="center" />
      <el-table-column v-if="tab === 'import'" prop="processedRows" label="成功" width="65" align="center" />
      <el-table-column v-if="tab === 'import'" prop="failedRows" label="失败" width="65" align="center" />
      <el-table-column label="状态" width="95"><template #default="{ row }"><el-tag :type="asyncJobState(row.displayStatus || row.status).tone" size="small">{{ asyncJobState(row.displayStatus || row.status).label }}</el-tag></template></el-table-column>
      <el-table-column label="时间" width="140"><template #default="{ row }">{{ fmtTime(row.createdAt) }}</template></el-table-column>
      <el-table-column label="操作" width="135" fixed="right"><template #default="{ row }">
        <el-button link type="primary" size="small" @click="openDetail(row.id)">详情</el-button>
        <el-button v-if="row.jobType === 'export' && row.status === 'completed'" link type="primary" size="small" @click="downloadJob(row.id, row.fileName)">下载</el-button>
      </template></el-table-column>
    </el-table>
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
    <el-dialog v-model="detailVisible" title="任务详情" width="680px" @closed="closeDetail">
      <div v-loading="detailLoading" class="task-detail">
        <el-alert v-if="detailError" :title="detailError" type="error" :closable="false"><el-button link type="primary" @click="detailId && openDetail(detailId)">重新读取详情</el-button></el-alert>
        <template v-if="detail">
          <el-descriptions :column="1" border>
            <el-descriptions-item label="任务编号">{{ detail.jobNo }}</el-descriptions-item>
            <el-descriptions-item label="类型">{{ asyncModuleLabel(detail.module) }}</el-descriptions-item>
            <el-descriptions-item label="文件名">{{ detail.fileName || '—' }}</el-descriptions-item>
            <el-descriptions-item label="状态">{{ asyncJobState(detail.displayStatus || detail.status).label }}</el-descriptions-item>
            <el-descriptions-item label="行数">共 {{ detail.totalRows || 0 }} 行；成功 {{ detail.processedRows || 0 }}，失败 {{ detail.failedRows || 0 }}</el-descriptions-item>
            <el-descriptions-item v-if="detail.jobType === 'export'" label="原筛选条件">{{ asyncFilterSummary(detail.exportParams) }}</el-descriptions-item>
            <el-descriptions-item label="失败原因">{{ asyncJobError(detail.errorMessage) }}</el-descriptions-item>
          </el-descriptions>
          <el-alert :title="asyncJobNextStep(detail)" type="info" :closable="false" />
          <pre v-if="failures.length" class="failure-list">{{ failures.map(formatImportFailureLine).join('\n') }}</pre>
        </template>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">返回任务列表</el-button>
        <el-button v-if="detailId" :disabled="retrying" :loading="detailLoading" @click="openDetail(detailId)">刷新状态</el-button>
        <el-button v-if="failures.length" @click="downloadImportFailuresCsv('导入失败明细', failures)">下载失败明细</el-button>
        <el-button v-if="detail?.replacementJobId" type="primary" @click="openDetail(detail.replacementJobId)">查看恢复任务</el-button>
        <el-button v-if="detail?.canRestart" type="primary" :loading="retrying" @click="retryExport(true)">按原筛选新建恢复任务</el-button>
        <el-button v-if="detail?.canRetry" type="primary" :loading="retrying" @click="retryExport(false)">{{ detail?.displayStatus === 'interrupted' ? '按原筛选恢复' : '按原筛选重试' }}</el-button>
        <el-button v-if="detail?.jobType === 'export' && detail.status === 'completed'" type="primary" @click="downloadJob(detail.id, detail.fileName)">下载文件</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>
<style scoped>
.page-title { font-weight:600; font-size:15px; }
.task-header { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
.task-actions { display:flex; align-items:center; gap:8px; margin:12px 0; flex-wrap:wrap; }
.task-detail { min-height:80px; }
.failure-list { white-space:pre-wrap; max-height:240px; overflow:auto; }
</style>
