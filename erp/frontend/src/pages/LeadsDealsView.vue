<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { leadApi, usersApi } from '@/api/client.js'
import { mapLead, fmtTime } from '@/api/mappers.ts'
import { useListLoader, withAction } from '@/composables/useListLoader.ts'
import { useServerPagination } from '@/composables/useTablePagination.ts'
import { useRowActions } from '@/composables/useRowActions'
import ListPagination from '@/components/ListPagination.vue'

const { showDetail, exportTask, confirmAction, toast } = useRowActions()

interface SalesUser {
  id: number
  name: string
  username: string
}

const searchQ = ref('')
const sourceFilter = ref('')
const shopTypeFilter = ref('')
const assigneeFilter = ref<number | ''>('')
const dealStatusFilter = ref('')
const dateFrom = ref('')
const dateTo = ref('')
const salesUsers = ref<SalesUser[]>([])
const selectedRow = ref<any | null>(null)

const SOURCE_OPTIONS = ['Takealot', '官网', '展会', '推荐', '小红书', '抖音', '其他']
const SHOP_TYPE_OPTIONS = ['本土店', '海外仓']
const DEAL_STATUS_OPTIONS = [
  { value: 'pending', label: '待转 ERP' },
  { value: 'confirmed', label: '已转 ERP' },
]

const { page, pageSize, total, resetPage } = useServerPagination()

const { loading, items: deals, load } = useListLoader(async () => {
  const params: Record<string, string | number> = {
    status: 'deal',
    page: page.value,
    pageSize: pageSize.value,
  }
  const keyword = searchQ.value.trim()
  if (keyword) params.keyword = keyword
  if (sourceFilter.value) params.source = sourceFilter.value
  if (shopTypeFilter.value) params.shopType = shopTypeFilter.value
  if (assigneeFilter.value !== '') params.assigneeId = assigneeFilter.value
  if (dealStatusFilter.value) params.dealStatus = dealStatusFilter.value
  if (dateFrom.value) params.dealDateFrom = dateFrom.value
  if (dateTo.value) params.dealDateTo = dateTo.value

  const res = await leadApi.list(params)
  total.value = res.total ?? 0
  return {
    items: (res.items || []).map((r: any) => {
      const m = mapLead(r)
      const deal = r.deals?.[0]
      const erpStatus = deal?.status || 'pending'
      return {
        id: deal?.dealNo || m.leadNo,
        name: m.company,
        channel: m.source || '—',
        shopType: deal?.productDesc || '本土店',
        dealDate: deal?.dealDate
          ? new Date(deal.dealDate).toLocaleDateString('zh-CN')
          : fmtTime(r.createdAt).split(' ')[0] || '—',
        owner: m.owner,
        contact: m.contact || r.contactPhone || '',
        erpStatus,
        erpStatusLabel: erpStatus === 'confirmed' ? '已转 ERP' : '待转 ERP',
        _leadId: r.id,
      }
    }),
  }
})

async function loadSalesUsers() {
  try {
    const res = await usersApi.list({ roleCode: 'cs', pageSize: 50 })
    salesUsers.value = (res.items || [])
      .filter((u: any) => u.status === 1)
      .map((u: any) => ({
        id: Number(u.id),
        name: u.realName || u.username,
        username: u.username,
      }))
  } catch {
    salesUsers.value = []
  }
}

function applyFilters() {
  resetPage()
  selectedRow.value = null
  load()
}

function resetFilters() {
  searchQ.value = ''
  sourceFilter.value = ''
  shopTypeFilter.value = ''
  assigneeFilter.value = ''
  dealStatusFilter.value = ''
  dateFrom.value = ''
  dateTo.value = ''
  selectedRow.value = null
  applyFilters()
}

function toggleSelect(row: any, checked: boolean) {
  selectedRow.value = checked ? row : null
}

function detail(row: any) {
  showDetail(`成交详情 · ${row.id}`, [
    ['成交编号', row.id],
    ['客户名', row.name],
    ['渠道', row.channel],
    ['店铺类型', row.shopType],
    ['联系方式', row.contact],
    ['负责人', row.owner],
    ['成交日期', row.dealDate],
    ['转 ERP 状态', row.erpStatusLabel],
  ])
}

async function toErp(row: any) {
  if (row.erpStatus === 'confirmed') return
  if (await confirmAction(`确认将成交客户「${row.name}」转为 ERP 正式客户并开通 OMS 账户？`, '转 ERP 客户')) {
    const ok = await withAction(async () => {
      await leadApi.deal(row._leadId, { status: 'confirmed', productDesc: row.shopType })
      await load()
    })
    if (ok) toast(`「${row.name}」已转为 ERP 客户，请在「客户充值」中充值`)
  }
}

watch([page, pageSize], () => {
  selectedRow.value = null
  load()
})
onMounted(async () => {
  await loadSalesUsers()
  await load()
})
</script>

<template>
  <el-card v-loading="loading">
    <template #header>
      <div class="page-header">
        <span class="page-title">成交管理</span>
        <el-button size="small" @click="exportTask('成交客户')">导出</el-button>
      </div>
    </template>

    <div class="filter-bar">
      <el-input
        v-model="searchQ"
        placeholder="客户名 / 成交编号 / 联系人"
        clearable
        size="small"
        style="width: 200px"
        @keyup.enter="applyFilters"
        @clear="applyFilters"
      />
      <el-select v-model="sourceFilter" placeholder="全部渠道" clearable size="small" style="width: 110px" @change="applyFilters">
        <el-option v-for="s in SOURCE_OPTIONS" :key="s" :label="s" :value="s" />
      </el-select>
      <el-select v-model="shopTypeFilter" placeholder="店铺类型" clearable size="small" style="width: 110px" @change="applyFilters">
        <el-option v-for="s in SHOP_TYPE_OPTIONS" :key="s" :label="s" :value="s" />
      </el-select>
      <el-select
        v-model="assigneeFilter"
        placeholder="全部负责人"
        clearable
        filterable
        size="small"
        style="width: 120px"
        @change="applyFilters"
      >
        <el-option v-for="u in salesUsers" :key="u.id" :label="u.name" :value="u.id" />
      </el-select>
      <el-select v-model="dealStatusFilter" placeholder="转 ERP 状态" clearable size="small" style="width: 120px" @change="applyFilters">
        <el-option v-for="s in DEAL_STATUS_OPTIONS" :key="s.value" :label="s.label" :value="s.value" />
      </el-select>
      <el-date-picker
        v-model="dateFrom"
        type="date"
        value-format="YYYY-MM-DD"
        placeholder="成交开始"
        size="small"
        style="width: 130px"
        @change="applyFilters"
      />
      <el-date-picker
        v-model="dateTo"
        type="date"
        value-format="YYYY-MM-DD"
        placeholder="成交结束"
        size="small"
        style="width: 130px"
        @change="applyFilters"
      />
      <el-button type="primary" size="small" @click="applyFilters">查询</el-button>
      <el-button size="small" @click="resetFilters">重置</el-button>
    </div>

    <el-table :data="deals" stripe border size="small" row-key="_leadId">
      <el-table-column label="" width="48" align="center" fixed="left">
        <template #default="{ row }">
          <el-checkbox
            :model-value="selectedRow?._leadId === row._leadId"
            @change="(checked) => toggleSelect(row, Boolean(checked))"
          />
        </template>
      </el-table-column>
      <el-table-column prop="id" label="成交编号" width="140">
        <template #default="{ row }"><span style="font-family:var(--font-mono);font-size:12px">{{ row.id }}</span></template>
      </el-table-column>
      <el-table-column prop="name" label="客户名" min-width="130" />
      <el-table-column prop="channel" label="渠道" width="80" />
      <el-table-column prop="shopType" label="店铺类型" width="100">
        <template #default="{ row }">
          <el-tag :type="row.shopType === '本土店' ? 'success' : row.shopType === '海外仓' ? 'warning' : 'info'" size="small">{{ row.shopType }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="contact" label="联系方式" width="130" />
      <el-table-column prop="owner" label="负责人" width="120" />
      <el-table-column prop="dealDate" label="成交日期" width="110" />
      <el-table-column prop="erpStatusLabel" label="转 ERP" width="100">
        <template #default="{ row }">
          <el-tag :type="row.erpStatus === 'confirmed' ? 'success' : 'warning'" size="small">{{ row.erpStatusLabel }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="detail(row)">详情</el-button>
          <el-button
            v-if="row.erpStatus !== 'confirmed'"
            link
            type="primary"
            size="small"
            @click="toErp(row)"
          >
            转ERP客户
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
  </el-card>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; }
.page-title { font-weight:600; font-size:15px; }
.filter-bar { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; align-items:center; }
</style>
