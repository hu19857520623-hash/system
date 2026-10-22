<script setup lang="ts">
import { userFacingError } from '@erp/shared/user-facing-error'

import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { flowDebugApi } from '@/api/client.js'
import { useAppStore } from '@/stores/app'
const app = useAppStore()
const catalog = ref<any>({ tables: [], endpoints: [], flows: [], notes: [] })
const tab = ref('fields')
const keyword = ref('')
const system = ref('')
const stage = ref('')
const page = ref(1)
const loading = ref(false)
const query = ref({ orderNo: '', customerCode: '', sku: '' })
const trace = ref<any>(null)
const tracing = ref(false)
const selectedField = ref<any>(null)
const fields = computed(() => catalog.value.tables.flatMap((table: any) => table.fields.map((field: any) => ({ ...field, system: table.system, stage: table.stage, model: table.model, table: table.table, source: table.source, relations: table.relations }))))
const stages = computed(() => [...new Set(fields.value.map((f: any) => f.stage))] as string[])
const filteredFields = computed(() => fields.value.filter(matches))
const filteredEndpoints = computed(() => catalog.value.endpoints.filter(matches))
const pageFields = computed(() => filteredFields.value.slice((page.value - 1) * 50, page.value * 50))
function matches(row: any) {
  return (!system.value || row.system === system.value) && (!stage.value || row.stage === stage.value)
    && (!keyword.value || JSON.stringify(row).toLowerCase().includes(keyword.value.toLowerCase()))
}
const fieldEndpoints = computed(() => selectedField.value ? catalog.value.endpoints.filter((e: any) => e.system === selectedField.value.system && e.stage === selectedField.value.stage) : [])
async function lookup() {
  tracing.value = true
  trace.value = null
  try { trace.value = await flowDebugApi.trace(query.value) }
  catch (e: any) { ElMessage.error(userFacingError(e.message || '查询失败')) }
  finally { tracing.value = false }
}
function download(name: string, value: string, type: string) {
  const url = URL.createObjectURL(new Blob([value], { type }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function exportFields() {
  const columns = ['system', 'stage', 'model', 'table', 'name', 'column', 'type', 'nullable', 'comment', 'source', 'line']
  const csv = [columns, ...filteredFields.value.map((r: any) => columns.map(k => String(r[k] ?? '')))].map((row: string[]) => row.map((v: string) => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\r\n')
  download('流程字段总表.csv', '\ufeff' + csv, 'text/csv;charset=utf-8')
}
onMounted(async () => {
  if (app.authenticatedUser?.roleCode !== 'admin') return
  loading.value = true
  try { catalog.value = await flowDebugApi.catalog() } catch (e: any) { ElMessage.error(userFacingError(e.message || '字段目录加载失败')) } finally { loading.value = false }
})
</script>

<template>
  <el-card v-if="app.authenticatedUser?.roleCode !== 'admin'"><el-result icon="warning" title="仅系统管理员可查看跨系统调试数据" /></el-card>
  <el-card v-else v-loading="loading">
    <template #header><div class="header"><span>流程字段与接口调试</span><el-tag>只读 · ERP / OMS / PDA</el-tag></div></template>
    <el-alert type="info" :closable="false" title="统一查看字段、接口和关联数据。业务数据由现有流程维护；不同系统的库存只对照、不相加。" />
    <el-tabs v-model="tab" style="margin-top:16px">
      <el-tab-pane :label="`字段总表（${fields.length}）`" name="fields" />
      <el-tab-pane :label="`接口目录（${catalog.endpoints.length}）`" name="api" />
      <el-tab-pane label="流转映射" name="flow" />
      <el-tab-pane label="实时调试视图" name="trace" />
    </el-tabs>
    <div v-if="tab === 'fields' || tab === 'api'" class="filters">
      <el-input v-model="keyword" clearable placeholder="字段 / 数据库列 / 单据 / 接口 / 处理方法" style="width:340px" @input="page = 1" />
      <el-select v-model="system" clearable placeholder="系统" style="width:130px" @change="page = 1"><el-option label="ERP" value="ERP" /><el-option label="OMS" value="OMS" /></el-select>
      <el-select v-model="stage" clearable placeholder="业务功能" style="width:200px" @change="page = 1"><el-option v-for="s in stages" :key="s" :label="s" :value="s" /></el-select>
      <el-button v-if="tab === 'fields'" @click="exportFields">导出字段总表</el-button>
    </div>
    <template v-if="tab === 'fields'">
      <el-table :data="pageFields" stripe border @row-click="selectedField = $event">
        <el-table-column prop="system" label="系统" width="75" /><el-table-column prop="stage" label="功能" width="140" />
        <el-table-column prop="table" label="数据库表" min-width="190" /><el-table-column prop="name" label="代码字段" min-width="180" />
        <el-table-column prop="column" label="数据库列" min-width="180" /><el-table-column prop="type" label="类型" width="90" />
        <el-table-column label="可空" width="70"><template #default="{ row }">{{ row.nullable ? '是' : '否' }}</template></el-table-column>
        <el-table-column prop="comment" label="源码说明" min-width="240" show-overflow-tooltip />
      </el-table>
      <el-pagination v-model:current-page="page" :page-size="50" :total="filteredFields.length" layout="total, prev, pager, next" style="margin-top:16px" />
      <p class="muted">点击字段查看关联关系和同功能接口。目录覆盖持久化业务字段；接口的派生显示字段以实际返回和源码为准。</p>
    </template>
    <template v-else-if="tab === 'api'">
      <el-table :data="filteredEndpoints" border stripe max-height="640">
        <el-table-column prop="system" label="系统" width="75" /><el-table-column prop="method" label="方法" width="90" /><el-table-column prop="path" label="接口路径" min-width="360" />
        <el-table-column prop="handler" label="处理方法" min-width="170" /><el-table-column prop="stage" label="功能" width="150" />
        <el-table-column type="expand"><template #default="{ row }"><p>{{ row.source }}:{{ row.line }}</p><pre>{{ row.declaration }}</pre></template></el-table-column>
      </el-table><p class="muted">展开查看源码声明。PDA 使用 ERP 接口；页面不会主动调用写入接口。</p>
    </template>
    <el-table v-else-if="tab === 'flow'" :data="catalog.flows" border>
      <el-table-column prop="name" label="流程" width="130" /><el-table-column prop="from" label="来源功能" min-width="200" /><el-table-column prop="to" label="去向功能" min-width="260" /><el-table-column prop="fields" label="关键流转字段" min-width="300" /><el-table-column prop="rule" label="关联与状态规则" min-width="300" />
    </el-table>
    <template v-else-if="tab === 'trace'">
      <el-form inline @submit.prevent="lookup">
        <el-form-item label="单号"><el-input v-model="query.orderNo" placeholder="入库 / 出库 / 退件 / 采购单号" maxlength="100" style="width:290px" /></el-form-item>
        <el-form-item label="客户"><el-input v-model="query.customerCode" placeholder="TKL005" maxlength="100" style="width:140px" /></el-form-item>
        <el-form-item label="SKU"><el-input v-model="query.sku" placeholder="客户 SKU 或内部 SKU" maxlength="100" style="width:220px" /></el-form-item>
        <el-form-item><el-button type="primary" :loading="tracing" @click="lookup">查询关联数据</el-button></el-form-item>
      </el-form>
      <el-alert type="info" :closable="false" title="按 SKU 查询必须填写客户。按单号查询会展开相关明细、商品、库存、费用和日志；每表最多 20 条，最多 4 层关联。" />
      <div v-if="trace" style="margin-top:16px">
        <div class="header"><span>查询时间：{{ trace.capturedAt }} · {{ trace.sections.length }} 张相关表</span><el-button @click="download('流程调试快照.json', JSON.stringify(trace, null, 2), 'application/json')">导出当前快照</el-button></div>
        <el-empty v-if="!trace.sections.length" description="未找到关联记录，请核对单号及客户 SKU" />
        <el-collapse>
          <el-collapse-item v-for="section in trace.sections" :key="section.system + section.table" :name="section.system + section.table">
            <template #title><span>{{ section.system }} · {{ section.stage }} · {{ section.table }} · {{ section.rows.length }} 条</span><el-tag v-if="section.truncated" type="warning" style="margin-left:12px">结果已截断</el-tag><el-tag v-if="section.state === 'unavailable'" type="danger">表或字段未同步</el-tag></template>
            <el-alert v-if="section.message" type="warning" :title="section.message" :closable="false" />
            <pre v-for="(row, i) in section.rows" :key="i">{{ JSON.stringify(row, null, 2) }}</pre>
          </el-collapse-item>
        </el-collapse>
        <p v-for="note in trace.notes" :key="note" class="muted">{{ note }}</p>
      </div>
    </template>
    <el-dialog :model-value="!!selectedField" title="字段来源与接口" width="850px" @close="selectedField = null">
      <template v-if="selectedField">
        <p>{{ selectedField.system }} · {{ selectedField.table }}.{{ selectedField.column }} → {{ selectedField.model }}.{{ selectedField.name }}</p>
        <p>源码：{{ selectedField.source }}:{{ selectedField.line }}</p>
        <p>Schema 外键关系：{{ JSON.stringify(selectedField.relations) }}</p>
        <p class="muted">以下为同功能接口，不表示每个接口都读写此字段；展开源码核对具体请求及返回。</p>
        <el-table :data="fieldEndpoints" max-height="360"><el-table-column prop="method" label="方法" width="80" /><el-table-column prop="path" label="接口" /><el-table-column prop="handler" label="处理方法" width="170" /></el-table>
      </template>
    </el-dialog>
  </el-card>
</template>
<style scoped>
.header{display:flex;align-items:center;justify-content:space-between;gap:12px}.filters{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px}.muted{color:#718096;font-size:13px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f7fa;padding:16px;max-height:500px;overflow:auto;font-size:13px}
</style>
