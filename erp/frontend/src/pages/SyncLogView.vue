<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { syncApi } from '@/api/client.js'
import { mapSyncLog } from '@/api/mappers.ts'
import { useListLoader, withAction } from '@/composables/useListLoader.ts'
import { useTablePagination } from '@/composables/useTablePagination.ts'
import { useRowActions } from '@/composables/useRowActions'
import { useAppStore } from '@/stores/app'
import ListPagination from '@/components/ListPagination.vue'

const app = useAppStore()
const { showDetail, exportTask, toast } = useRowActions()

function toSyncRow(row: any) {
  const m = mapSyncLog(row)
  const ok = row.status === 'success'
  const outbound = ['OMS'].some((s) => String(m.target || '').toUpperCase().includes(s))
  return {
    id: row.id?.toString() || String(m.id),
    intf: m.type,
    dir: outbound ? '出站' : '入站',
    src: m.ref || '—',
    tgt: m.target,
    statusLabel: ok ? '成功' : '失败',
    tone: ok ? 'ok' : 'err',
    err: m.message || '—',
    time: m.time,
    retries: row.retryCount ?? 0,
    _raw: row,
  }
}

const { loading, items: entries, load } = useListLoader(async () => {
  const res = await syncApi.list({ pageSize: 100 })
  return { items: (res.items || []).map(toSyncRow) }
})

const { page, pageSize, total, pagedItems } = useTablePagination(entries)

const failCount = computed(() => entries.value.filter((e) => e.tone === 'err').length)
const failRate = computed(() => {
  if (!entries.value.length) return '0%'
  return `${((failCount.value / entries.value.length) * 100).toFixed(1)}%`
})

const canRetry = computed(() => app.hasPerm('sync.retry'))

async function retry(row: any) {
  if (!canRetry.value) return
  const ok = await withAction(async () => {
    await syncApi.retry(row._raw.id)
    await load()
  })
  if (ok) toast(`${row.id} 已重试同步成功`)
}

function detail(row: any) {
  showDetail(`同步日志 · ${row.id}`, [
    ['业务ID', row.id], ['接口', row.intf], ['方向', row.dir], ['源单', row.src], ['目标单', row.tgt],
    ['状态', row.statusLabel], ['错误', row.err], ['重试次数', row.retries], ['时间', row.time],
  ])
}

onMounted(load)
</script>

<template>
  <el-card v-loading="loading">
    <template #header>
      <div class="page-header">
        <span class="page-title">同步日志</span>
        <div class="header-actions">
          <el-tag v-if="failCount" type="danger" size="small">{{ failCount }} 条失败待重试</el-tag>
          <el-button size="small" @click="exportTask('同步日志')">导出</el-button>
        </div>
      </div>
    </template>
    <div class="callout info">
      <div class="callout-title">对外同步（OMS，后续接入）</div>
      <div class="callout-body">展示 ERP 与 OMS 之间的接口调用记录。入库库存已在 ERP 内部闭环，不再产生 WMS 推送日志。</div>
    </div>
    <div class="kpi-row">
      <div class="kpi"><strong>{{ entries.length }}</strong><span>近期调用</span></div>
      <div class="kpi" :class="{ warn: failCount > 0 }"><strong>{{ failRate }}</strong><span>失败率</span></div>
      <div class="kpi err"><strong>{{ failCount }}</strong><span>待补偿</span></div>
    </div>
    <el-table :data="pagedItems" stripe border size="small">
      <el-table-column prop="id" label="业务ID" width="120">
        <template #default="{ row }"><span class="mono">{{ row.id }}</span></template>
      </el-table-column>
      <el-table-column prop="intf" label="接口" width="100" />
      <el-table-column prop="dir" label="方向" width="70" />
      <el-table-column prop="src" label="源单" width="130">
        <template #default="{ row }"><span class="mono">{{ row.src }}</span></template>
      </el-table-column>
      <el-table-column prop="tgt" label="目标系统" width="100" />
      <el-table-column prop="statusLabel" label="状态" width="80">
        <template #default="{ row }">
          <el-tag :type="row.tone === 'ok' ? 'success' : 'danger'" size="small">{{ row.statusLabel }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="retries" label="重试" width="60" align="center" />
      <el-table-column prop="err" label="错误" min-width="140" show-overflow-tooltip />
      <el-table-column prop="time" label="时间" width="130" />
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.tone === 'err' && canRetry" link type="primary" size="small" @click="retry(row)">重试</el-button>
          <el-button link type="primary" size="small" @click="detail(row)">详情</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && !entries.length" description="暂无对外同步记录" />
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
  </el-card>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; }
.page-title { font-weight:600; font-size:15px; }
.header-actions { display:flex; gap:8px; align-items:center; }
.callout { padding:12px 16px; border-radius:8px; margin-bottom:12px; font-size:13px; }
.callout.info { background:#eef6ff; border:1px solid #c5dff8; color:#3d4f63; }
.callout-title { font-weight:600; margin-bottom:4px; }
.kpi-row { display:flex; gap:12px; margin-bottom:12px; }
.kpi { display:flex; flex-direction:column; align-items:center; padding:8px 20px; background:#faf8f4; border:1px solid #ece6dd; border-radius:8px; min-width:90px; }
.kpi strong { font-size:18px; }
.kpi span { font-size:11px; color:#8b95a8; }
.kpi.warn strong { color:#e8953a; }
.kpi.err strong { color:#e85d5d; }
.mono { font-family:var(--font-mono,Consolas,monospace); font-size:12px; }
</style>
