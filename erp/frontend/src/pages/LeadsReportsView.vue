<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { leadApi } from '@/api/client.js'
import { useTablePagination } from '@/composables/useTablePagination.ts'
import { useRowActions } from '@/composables/useRowActions'
import ListPagination from '@/components/ListPagination.vue'

const { exportTask } = useRowActions()

const range = ref('all')
const loading = ref(false)

const metrics = ref({
  total: 0,
  following: 0,
  won: 0,
  lost: 0,
  pending: 0,
  thisMonthNew: 0,
})

const funnel = ref<{ label: string; value: number; color: string }[]>([])
const channels = ref<{ name: string; value: number; color: string }[]>([])
const statusDist = ref<{ name: string; value: number; color: string }[]>([])
const monthly = ref<{ month: string; count: number; won: number }[]>([])
const salesRank = ref<{ name: string; total: number; following: number; won: number; rate: number }[]>([])

const { page, pageSize, total, pagedItems } = useTablePagination(salesRank)

const convRate = computed(() => metrics.value.total ? ((metrics.value.won / metrics.value.total) * 100).toFixed(1) : '0')
const validRate = computed(() => metrics.value.total ? (((metrics.value.total - metrics.value.lost) / metrics.value.total) * 100).toFixed(1) : '0')
const funnelMax = computed(() => Math.max(...funnel.value.map((f) => f.value), 1))
const channelTotal = computed(() => channels.value.reduce((s, c) => s + c.value, 0))
const statusTotal = computed(() => statusDist.value.reduce((s, c) => s + c.value, 0))
const monthlyMax = computed(() => Math.max(...monthly.value.map((m) => m.count), 1))

const CHANNEL_COLORS = ['#f07178', '#1a1a1a', '#2ec4b6', '#5b9fd4', '#b0a89c', '#c4782b']

async function loadReport() {
  loading.value = true
  try {
    const data = await leadApi.report()
    const total = data.total ?? 0
    const following = data.following ?? 0
    const won = data.deal ?? 0
    const lost = data.lost ?? 0
    const pending = Math.max(0, total - following - won - lost)

    metrics.value = {
      total,
      following,
      won,
      lost,
      pending,
      thisMonthNew: pending,
    }

    const valid = total - lost
    funnel.value = [
      { label: '总线索', value: total, color: '#5b9fd4' },
      { label: '有效线索', value: valid, color: '#2ec4b6' },
      { label: '跟进中', value: following, color: '#e8a23a' },
      { label: '已成交', value: won, color: '#1f9d92' },
    ]

    channels.value = (data.bySource || []).map((s: any, i: number) => ({
      name: s.source || '其他',
      value: s.count ?? 0,
      color: CHANNEL_COLORS[i % CHANNEL_COLORS.length],
    }))

    statusDist.value = [
      { name: '已流失/无效', value: lost, color: '#c95e60' },
      { name: '新线索/暂无意向', value: pending, color: '#b0a89c' },
      { name: '跟进中', value: following, color: '#e8a23a' },
      { name: '已成交', value: won, color: '#1f9d92' },
    ]
  } finally {
    loading.value = false
  }
}

function pct(v: number, total: number) {
  return total ? ((v / total) * 100).toFixed(1) : '0'
}

onMounted(loadReport)
</script>

<template>
  <div v-loading="loading" class="reports-page">
    <el-card>
      <template #header>
        <div class="page-header">
          <span class="page-title">获客报表</span>
          <div class="header-actions">
            <el-radio-group v-model="range" size="small">
              <el-radio-button value="all">全部</el-radio-button>
              <el-radio-button value="quarter">本季度</el-radio-button>
              <el-radio-button value="month">本月</el-radio-button>
            </el-radio-group>
            <el-button size="small" @click="exportTask('获客报表')">导出报表</el-button>
          </div>
        </div>
      </template>

      <div class="kpi-strip">
        <div class="kpi-item"><div class="kpi-value">{{ metrics.total.toLocaleString() }}</div><div class="kpi-label">总线索</div></div>
        <div class="kpi-item"><div class="kpi-value success">{{ metrics.won }}</div><div class="kpi-label">已成交</div></div>
        <div class="kpi-item"><div class="kpi-value warning">{{ convRate }}%</div><div class="kpi-label">成交转化率</div></div>
        <div class="kpi-item"><div class="kpi-value info">{{ validRate }}%</div><div class="kpi-label">有效线索率</div></div>
        <div class="kpi-item"><div class="kpi-value warning">{{ metrics.following }}</div><div class="kpi-label">跟进中</div></div>
        <div class="kpi-item"><div class="kpi-value">{{ metrics.thisMonthNew }}</div><div class="kpi-label">本月新增</div></div>
      </div>
    </el-card>

    <div class="grid-2">
      <el-card>
        <template #header><span class="card-title">转化漏斗</span></template>
        <div class="funnel">
          <div v-for="(f, i) in funnel" :key="f.label" class="funnel-row">
            <span class="funnel-label">{{ f.label }}</span>
            <div class="funnel-bar-wrap">
              <div class="funnel-bar" :style="{ width: (f.value / funnelMax * 100) + '%', background: f.color }">
                <span class="funnel-val">{{ f.value.toLocaleString() }}</span>
              </div>
            </div>
            <span class="funnel-rate">{{ i === 0 ? '100%' : pct(f.value, funnel[0]?.value || 1) + '%' }}</span>
          </div>
        </div>
      </el-card>

      <el-card>
        <template #header><span class="card-title">来源渠道分布</span></template>
        <div class="dist">
          <div v-for="c in channels" :key="c.name" class="dist-row">
            <span class="dist-label">{{ c.name }}</span>
            <div class="dist-bar-wrap">
              <div class="dist-bar" :style="{ width: channelTotal ? (c.value / channelTotal * 100) + '%' : '0%', background: c.color }"></div>
            </div>
            <span class="dist-val">{{ c.value }}</span>
            <span class="dist-pct">{{ pct(c.value, channelTotal) }}%</span>
          </div>
        </div>
      </el-card>
    </div>

    <div class="grid-2">
      <el-card>
        <template #header><span class="card-title">跟进状态分布</span></template>
        <div class="dist">
          <div v-for="s in statusDist" :key="s.name" class="dist-row">
            <span class="dist-label">{{ s.name }}</span>
            <div class="dist-bar-wrap">
              <div class="dist-bar" :style="{ width: statusTotal ? (s.value / statusTotal * 100) + '%' : '0%', background: s.color }"></div>
            </div>
            <span class="dist-val">{{ s.value }}</span>
            <span class="dist-pct">{{ pct(s.value, statusTotal) }}%</span>
          </div>
        </div>
      </el-card>

      <el-card>
        <template #header><span class="card-title">月度新增趋势</span></template>
        <div v-if="monthly.length" class="trend">
          <div v-for="m in monthly" :key="m.month" class="trend-col">
            <div class="trend-bars">
              <div class="trend-bar total" :style="{ height: (m.count / monthlyMax * 120) + 'px' }" :title="'新增 ' + m.count">
                <span class="trend-num">{{ m.count }}</span>
              </div>
            </div>
            <div class="trend-month">{{ m.month }}</div>
            <div class="trend-won">成交 {{ m.won }}</div>
          </div>
        </div>
        <el-empty v-else description="暂无月度数据" :image-size="60" />
      </el-card>
    </div>

    <el-card>
      <template #header><span class="card-title">销售业绩排行</span></template>
      <el-table v-if="salesRank.length" :data="pagedItems" border size="small">
        <el-table-column type="index" label="排名" width="60" align="center" />
        <el-table-column prop="name" label="对接销售" min-width="140" />
        <el-table-column prop="total" label="负责线索" width="110" align="right" />
        <el-table-column prop="following" label="跟进中" width="100" align="right" />
        <el-table-column prop="won" label="已成交" width="100" align="right">
          <template #default="{ row }"><span style="color:#1f9d92;font-weight:600">{{ row.won }}</span></template>
        </el-table-column>
        <el-table-column label="转化率" width="140">
          <template #default="{ row }">
            <div class="rate-cell">
              <div class="rate-bar-wrap"><div class="rate-bar" :style="{ width: Math.min(row.rate * 12, 100) + '%' }"></div></div>
              <span>{{ row.rate }}%</span>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <ListPagination v-if="salesRank.length" v-model:page="page" v-model:page-size="pageSize" :total="total" />
      <el-empty v-else description="暂无销售排行数据" :image-size="60" />
    </el-card>
  </div>
</template>

<style scoped>
.reports-page { display:flex; flex-direction:column; gap:14px; }
.page-header { display:flex; align-items:center; justify-content:space-between; }
.page-title { font-weight:600; font-size:15px; }
.card-title { font-weight:600; font-size:14px; }
.header-actions { display:flex; gap:10px; align-items:center; }

.kpi-strip {
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(120px,1fr));
  overflow:hidden;
  background:linear-gradient(145deg,rgba(18,17,48,0.86),rgba(10,9,25,0.76));
  border:1px solid rgba(99,102,241,0.17);
  border-radius:14px;
  box-shadow:0 16px 38px rgba(0,0,0,0.16);
}
.kpi-item {
  position:relative;
  min-height:86px;
  padding:17px 16px;
  border-right:1px solid rgba(99,102,241,0.12);
  text-align:center;
  transition:background 0.18s ease;
}
.kpi-item:last-child { border-right:0; }
.kpi-item:hover { background:rgba(99,102,241,0.08); }
.kpi-value { font-size:24px; color:#f1f5f9; font-family:var(--font-mono); font-variant-numeric:tabular-nums; font-weight:700; line-height:1.1; }
.kpi-value.success { color:#34d399; }
.kpi-value.warning { color:#fbbf24; }
.kpi-value.info { color:#67e8f9; }
.kpi-label { font-size:11px; color:#94a3b8; margin-top:8px; }

.grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:14px; }

.funnel { display:flex; flex-direction:column; gap:10px; padding:4px 0; }
.funnel-row { display:flex; align-items:center; gap:10px; }
.funnel-label { width:64px; font-size:12px; color:#94a3b8; flex-shrink:0; }
.funnel-bar-wrap { flex:1; background:rgba(30,27,75,0.45); border:1px solid rgba(99,102,241,0.1); border-radius:6px; overflow:hidden; }
.funnel-bar { height:26px; border-radius:6px; display:flex; align-items:center; justify-content:flex-end; padding:0 8px; min-width:40px; transition:width 0.4s; }
.funnel-val { color:#fff; font-size:12px; font-weight:600; font-family:var(--font-mono); }
.funnel-rate { width:48px; text-align:right; font-size:12px; color:#94a3b8; font-family:var(--font-mono); }

.dist { display:flex; flex-direction:column; gap:12px; padding:4px 0; }
.dist-row { display:flex; align-items:center; gap:10px; }
.dist-label { width:80px; font-size:12px; color:#94a3b8; flex-shrink:0; }
.dist-bar-wrap { flex:1; background:rgba(30,27,75,0.45); border:1px solid rgba(99,102,241,0.1); border-radius:5px; overflow:hidden; height:14px; }
.dist-bar { height:14px; border-radius:5px; transition:width 0.4s; }
.dist-val { width:46px; text-align:right; font-size:12px; font-family:var(--font-mono); color:#e2e8f0; }
.dist-pct { width:46px; text-align:right; font-size:11px; color:#718096; font-family:var(--font-mono); }

.trend { display:flex; align-items:flex-end; justify-content:space-around; gap:8px; padding:10px 0 0; min-height:170px; }
.trend-col { display:flex; flex-direction:column; align-items:center; gap:4px; flex:1; }
.trend-bars { display:flex; align-items:flex-end; height:130px; }
.trend-bar { width:34px; border-radius:6px 6px 0 0; display:flex; align-items:flex-start; justify-content:center; transition:height 0.4s; }
.trend-bar.total { background:linear-gradient(180deg,#818cf8,#6366f1); }
.trend-num { color:#fff; font-size:10px; font-family:var(--font-mono); margin-top:3px; }
.trend-month { font-size:12px; color:#94a3b8; }
.trend-won { font-size:10px; color:#34d399; }

.rate-cell { display:flex; align-items:center; gap:8px; }
.rate-bar-wrap { flex:1; background:rgba(30,27,75,0.45); border-radius:4px; height:8px; overflow:hidden; }
.rate-bar { height:8px; background:#10b981; border-radius:4px; }

@media (max-width:840px) {
  .grid-2 { grid-template-columns:1fr; }
  .kpi-strip { grid-template-columns:repeat(3,minmax(0,1fr)); }
  .kpi-item { border-bottom:1px solid rgba(99,102,241,0.12); }
}
@media (max-width:520px) {
  .page-header { align-items:flex-start; gap:12px; }
  .header-actions { align-items:flex-end; flex-direction:column; }
  .kpi-strip { grid-template-columns:repeat(2,minmax(0,1fr)); }
}
</style>
