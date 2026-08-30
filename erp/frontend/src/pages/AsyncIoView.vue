<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { asyncIoApi } from '@/api/client.js'
import { fmtTime } from '@/api/mappers.ts'
import { useListLoader } from '@/composables/useListLoader.ts'
import { useTablePagination } from '@/composables/useTablePagination.ts'
import { useRowActions } from '@/composables/useRowActions'
import { useAsyncIo } from '@/composables/useAsyncIo'
import { downloadLeadsImportTemplate, downloadProductImportTemplate } from '@/constants/importTemplates.ts'
import ListPagination from '@/components/ListPagination.vue'

const { showDetail } = useRowActions()
const { importCsv, downloadJob, exportModule } = useAsyncIo()

const tab = ref('import')

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  completed: { label: '已完成', tone: 'ok' },
  partial: { label: '部分成功', tone: 'warn' },
  failed: { label: '失败', tone: 'err' },
  pending: { label: '生成中', tone: 'warn' },
  processing: { label: '生成中', tone: 'warn' },
}

function mapJob(row: any) {
  const st = STATUS_LABEL[row.status] || { label: row.status, tone: 'info' }
  return {
    id: row.jobNo,
    jobId: row.id,
    type: row.module,
    file: row.fileName || '—',
    rows: row.totalRows ?? 0,
    format: 'CSV',
    status: st.label,
    tone: st.tone,
    time: fmtTime(row.createdAt),
    jobType: row.jobType,
    _raw: row,
  }
}

const { loading, items, load } = useListLoader(async () => {
  const res = await asyncIoApi.list({ pageSize: 100 })
  return { items: (res.items || []).map(mapJob) }
})

const importTasks = computed(() => items.value.filter((i) => i.jobType === 'import'))
const exportTasks = computed(() => items.value.filter((i) => i.jobType === 'export'))

const { page: importPage, pageSize: importPageSize, total: importTotal, pagedItems: importPagedItems } = useTablePagination(importTasks)
const { page: exportPage, pageSize: exportPageSize, total: exportTotal, pagedItems: exportPagedItems } = useTablePagination(exportTasks)

async function handleImport() {
  const job = await importCsv('线索')
  if (job) await load()
}

async function importProducts() {
  const job = await importCsv('商品主数据')
  if (job) await load()
}

async function newExport() {
  const job = await exportModule('库存')
  if (job) await load()
}

function importDetail(row: any) {
  showDetail(`导入任务 · ${row.id}`, [
    ['任务编号', row.id], ['导入类型', row.type], ['文件名', row.file], ['行数', row.rows], ['状态', row.status], ['时间', row.time],
  ])
}

function download(row: any) {
  const id = row.jobId ?? row._raw?.id
  if (!id) return
  downloadJob(id, row.file)
}

onMounted(load)
</script>

<template>
  <el-card v-loading="loading">
    <template #header><span class="page-title">异步导出导入</span></template>
    <el-tabs v-model="tab" type="card">
      <el-tab-pane label="导入任务" name="import" />
      <el-tab-pane label="导出任务" name="export" />
    </el-tabs>

    <template v-if="tab === 'import'">
      <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap">
        <el-button type="primary" size="small" @click="handleImport">上传模板导入线索</el-button>
        <el-button size="small" link type="primary" @click="downloadLeadsImportTemplate">下载线索导入模板</el-button>
        <el-button type="primary" size="small" @click="importProducts">上传模板导入商品</el-button>
        <el-button size="small" link type="primary" @click="downloadProductImportTemplate">下载商品导入模板</el-button>
      </div>
      <el-table :data="importPagedItems" stripe border size="small">
        <el-table-column prop="id" label="任务编号" width="140">
          <template #default="{ row }"><span style="font-family:var(--font-mono);font-size:12px">{{ row.id }}</span></template>
        </el-table-column>
        <el-table-column prop="type" label="导入类型" width="120" />
        <el-table-column prop="file" label="文件名" min-width="180" />
        <el-table-column prop="rows" label="行数" width="70" align="center" />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="(row.tone as any)" size="small">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="time" label="时间" width="130" />
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }"><el-button link type="primary" size="small" @click="importDetail(row)">详情</el-button></template>
        </el-table-column>
      </el-table>
      <ListPagination v-model:page="importPage" v-model:page-size="importPageSize" :total="importTotal" />
    </template>

    <template v-else>
      <div style="margin-bottom:12px">
        <el-button type="primary" size="small" @click="newExport">新建导出任务（库存）</el-button>
      </div>
      <el-table :data="exportPagedItems" stripe border size="small">
        <el-table-column prop="id" label="任务编号" width="140">
          <template #default="{ row }"><span style="font-family:var(--font-mono);font-size:12px">{{ row.id }}</span></template>
        </el-table-column>
        <el-table-column prop="type" label="导出类型" width="120" />
        <el-table-column prop="format" label="格式" width="70" />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="(row.tone as any)" size="small">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="file" label="文件名" min-width="180" />
        <el-table-column prop="time" label="时间" width="130" />
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.tone === 'ok'" link type="primary" size="small" @click="download(row)">下载</el-button>
            <el-button v-else link type="primary" size="small" disabled>等待中</el-button>
          </template>
        </el-table-column>
      </el-table>
      <ListPagination v-model:page="exportPage" v-model:page-size="exportPageSize" :total="exportTotal" />
    </template>
  </el-card>
</template>

<style scoped>
.page-title { font-weight:600; font-size:15px; }
</style>
