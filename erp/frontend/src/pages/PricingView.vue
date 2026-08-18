<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { pricingApi, inventoryApi } from '@/api/client.js'
import { mapPricing, fmtTime } from '@/api/mappers.ts'
import { useListLoader, withAction } from '@/composables/useListLoader.ts'
import { useTablePagination } from '@/composables/useTablePagination.ts'
import { useAppStore } from '@/stores/app'
import ListPagination from '@/components/ListPagination.vue'
import DetailSheet from '@/components/ui/DetailSheet.vue'
import { PIPELINE_PRICING_ALERT } from '@/constants/productPipeline.ts'

const app = useAppStore()
const route = useRoute()

const section = ref<'pool' | 'holdings'>('pool')
const tab = ref('all')
const searchQ = ref('')

interface PriceHistory { time: string; role: string; action: string; detail: string }
interface PriceRecord { date: string; marketPrice: number; price: number; operator: string; note: string }

interface PriceItem {
  id: number
  sku: string
  name: string
  spec: string
  cost: number
  purchaseQty: number
  inboundQty: number
  visibleStockQty: number | null
  soldQty: number
  remainingStockQty: number
  catalogStockPool: number
  warehouseAvailableQty: number
  poNo: string
  inboundNo: string
  seaFreight: number
  domesticFee: number
  exchangeRate: number
  freightCallbackTime: string
  marketPrice: number
  pricingLogic: string
  targetProfitRate: number
  finalPrice: number
  overseasDeliveryFee: number
  platformCommission: number
  platformDeliveryFee: number
  pricingStatus: string
  omsSyncTime: string
  visibleOnOms: boolean
  orderableOnOms: boolean
  visibleOnOmsAt: string
  orderableOnOmsAt: string
  history: PriceHistory[]
  priceRecords: PriceRecord[]
}

/** 汇率：1 人民币 = exchangeRate 兰特 */
function zarToRmb(zar: number, exchangeRate: number) {
  const rate = Number(exchangeRate) || 2.5
  return rate ? Number(zar) / rate : 0
}

function calcProfit(
  priceRmb: number,
  e: Pick<PriceItem, 'cost' | 'seaFreight' | 'overseasDeliveryFee' | 'platformCommission' | 'platformDeliveryFee' | 'exchangeRate'>,
) {
  if (!priceRmb) return 0
  const rate = Number(e.exchangeRate) || 2.5
  const commissionRmb = zarToRmb(Number(e.platformCommission), rate)
  const deliveryRmb = zarToRmb(Number(e.platformDeliveryFee), rate)
  return priceRmb - Number(e.cost) - Number(e.seaFreight) - Number(e.overseasDeliveryFee) - commissionRmb - deliveryRmb
}

function ensureFeeDefaults(item: PriceItem) {
  if (item.platformCommission == null) item.platformCommission = 0
  if (item.overseasDeliveryFee == null) item.overseasDeliveryFee = 0
  if (item.platformDeliveryFee == null) item.platformDeliveryFee = 0
  if (!item.exchangeRate) item.exchangeRate = 2.5
}

const { loading, items, load } = useListLoader<PriceItem>(async () => {
  const res = await pricingApi.list({ pageSize: 100 })
  return { items: (res.items || []).map(mapPricing), total: res.total }
})

onMounted(() => {
  load()
  if (route.query.section === 'holdings') section.value = 'holdings'
})

const pricingStatusMap: Record<string, { label: string; type: string }> = {
  waiting_freight: { label: '待发运', type: 'info' },
  pending_pricing: { label: '待定价', type: 'warning' },
  priced: { label: '已定价待同步', type: 'primary' },
  synced: { label: '已同步OMS', type: 'success' },
}

const canSetPrice = computed(() => app.hasPerm('pricing.set'))
const canSyncOms = computed(() => app.hasPerm('pricing.sync_oms'))
const canReclaim = computed(() => app.hasPerm('inventory_query.adjust'))

interface HoldingRow {
  id: string
  sku: string
  customerSku?: string
  productName: string
  spec?: string
  customerCode: string
  supplierName?: string
  availableQty: number
  lockedQty?: number
  sellableQty?: number
  finalPrice?: number | null
  purchaseOrderCount?: number
  lastPurchaseAt?: string | null
}

const holdingsLoading = ref(false)
const holdingRows = ref<HoldingRow[]>([])
const holdingsTotal = ref(0)
const holdingsPage = ref(1)
const holdingsPageSize = ref(20)
const holdingsCustomerCode = ref('')
const holdingsProductCode = ref('')
const catalogPurchaseVisible = ref(false)
const catalogPurchaseLoading = ref(false)
const catalogPurchaseSku = ref('')
const catalogPurchaseCustomer = ref('')
const catalogPurchaseRows = ref<any[]>([])
const reclaimDialogVisible = ref(false)
const reclaimSubmitting = ref(false)
const reclaimForm = ref({
  customerCode: '',
  sku: '',
  productName: '',
  maxQty: 0,
  quantity: 1,
  remark: '',
})

async function loadHoldings() {
  holdingsLoading.value = true
  try {
    const p: Record<string, unknown> = {
      page: holdingsPage.value,
      pageSize: holdingsPageSize.value,
      dataSource: 'catalog_holdings',
    }
    const customerKw = holdingsCustomerCode.value.trim()
    if (customerKw) {
      p.customerKeyword = customerKw
      p.supplierKeyword = customerKw
    }
    if (holdingsProductCode.value.trim()) p.productCode = holdingsProductCode.value.trim()
    const res = await inventoryApi.query(p)
    holdingRows.value = res.items || []
    holdingsTotal.value = res.total ?? 0
  } catch (e: any) {
    holdingRows.value = []
    holdingsTotal.value = 0
    ElMessage.error(e?.message || '加载货盘持有失败')
  } finally {
    holdingsLoading.value = false
  }
}

function searchHoldings() {
  holdingsPage.value = 1
  loadHoldings()
}

function resetHoldingsFilters() {
  holdingsCustomerCode.value = ''
  holdingsProductCode.value = ''
  holdingsPage.value = 1
  loadHoldings()
}

function isReclaimableRow(row: HoldingRow) {
  return Boolean(row.customerCode && row.customerCode !== 'TKL')
}

async function openCatalogPurchases(row: HoldingRow) {
  catalogPurchaseSku.value = row.sku
  catalogPurchaseCustomer.value = row.customerCode || ''
  catalogPurchaseVisible.value = true
  catalogPurchaseLoading.value = true
  catalogPurchaseRows.value = []
  try {
    const res = await inventoryApi.catalogPurchases({
      sku: row.sku,
      customerCode: row.customerCode || undefined,
      page: 1,
      pageSize: 100,
    })
    catalogPurchaseRows.value = res.items || []
  } catch (e: any) {
    ElMessage.error(e?.message || '加载失败')
  } finally {
    catalogPurchaseLoading.value = false
  }
}

function openReclaim(row: HoldingRow) {
  const maxQty = Number(row.availableQty ?? row.sellableQty ?? 0)
  reclaimForm.value = {
    customerCode: row.customerCode || '',
    sku: row.sku,
    productName: row.productName || '',
    maxQty,
    quantity: maxQty > 0 ? maxQty : 1,
    remark: '',
  }
  reclaimDialogVisible.value = true
}

async function submitReclaim() {
  const f = reclaimForm.value
  if (!f.customerCode.trim()) return ElMessage.warning('请填写客户代码')
  if (!f.sku.trim()) return ElMessage.warning('缺少 SKU')
  if (!f.quantity || f.quantity <= 0) return ElMessage.warning('收回数量须大于 0')
  if (f.maxQty > 0 && f.quantity > f.maxQty) {
    return ElMessage.warning(`最多可收回 ${f.maxQty} 件`)
  }
  reclaimSubmitting.value = true
  try {
    const res = await inventoryApi.reclaimCatalogHolding({
      customerCode: f.customerCode.trim(),
      sku: f.sku.trim(),
      quantity: f.quantity,
      remark: f.remark.trim() || undefined,
    })
    ElMessage.success(res.message || '货盘持有已收回')
    reclaimDialogVisible.value = false
    loadHoldings()
    load()
  } catch (e: any) {
    ElMessage.error(e?.message || '收回失败')
  } finally {
    reclaimSubmitting.value = false
  }
}

watch(section, (v) => {
  if (v === 'holdings') loadHoldings()
})

watch([holdingsPage, holdingsPageSize], () => {
  if (section.value === 'holdings') loadHoldings()
})

const stats = computed(() => {
  const s = { waiting_freight: 0, pending_pricing: 0, priced: 0, synced: 0 }
  items.value.forEach(p => { s[p.pricingStatus as keyof typeof s]++ })
  return s
})

function needMyAction(p: any): boolean {
  if (canSetPrice.value && p.pricingStatus === 'pending_pricing') return true
  if (canSyncOms.value && p.pricingStatus === 'priced') return true
  return false
}
function rowClassName({ row }: { row: PriceItem }) {
  return needMyAction(row) ? 'row-todo' : ''
}
const myTodoCount = computed(() => items.value.filter(p => needMyAction(p)).length)

const filtered = computed(() => {
  return items.value.filter(p => {
    if (['waiting_freight', 'pending_pricing', 'priced', 'synced'].includes(tab.value) && p.pricingStatus !== tab.value) return false
    if (tab.value === 'todo' && !needMyAction(p)) return false
    if (searchQ.value && !p.name.toLowerCase().includes(searchQ.value.toLowerCase()) && !p.sku.toLowerCase().includes(searchQ.value.toLowerCase())) return false
    return true
  })
})

const { page, pageSize, total, pagedItems, resetPage } = useTablePagination(filtered)
watch([tab, searchQ], resetPage)

async function openPricing(id: number) {
  try {
    const detail = await pricingApi.detail(id)
    editing.value = mapPricing(detail) as PriceItem
  } catch {
    const p = items.value.find(x => x.id === id)
    if (p) editing.value = JSON.parse(JSON.stringify(p))
  }
  if (editing.value) {
    ensureFeeDefaults(editing.value)
    if (editing.value.visibleStockQty == null && editing.value.pricingStatus === 'pending_pricing') {
      editing.value.visibleStockQty = editing.value.inboundQty || editing.value.purchaseQty || 0
    }
  }
  pricingVisible.value = true
}

const pricingVisible = ref(false)
const editing = ref<PriceItem | null>(null)

function pricingStepActive(status: string) {
  const map: Record<string, number> = {
    waiting_freight: 1,
    pending_pricing: 2,
    priced: 3,
    synced: 4,
  }
  return map[status] ?? 0
}

const fixedCostsRmb = computed(() => {
  if (!editing.value) return 0
  const e = editing.value
  const rate = Number(e.exchangeRate) || 2.5
  return Number(e.cost) + Number(e.seaFreight) + Number(e.overseasDeliveryFee)
    + zarToRmb(Number(e.platformCommission), rate) + zarToRmb(Number(e.platformDeliveryFee), rate)
})
const estCommissionRmb = computed(() => {
  if (!editing.value) return 0
  return zarToRmb(Number(editing.value.platformCommission), editing.value.exchangeRate)
})
const estDeliveryRmb = computed(() => {
  if (!editing.value) return 0
  return zarToRmb(Number(editing.value.platformDeliveryFee), editing.value.exchangeRate)
})
const marketPriceRmb = computed(() => {
  if (!editing.value?.marketPrice) return 0
  return zarToRmb(editing.value.marketPrice, editing.value.exchangeRate)
})
const estProfit = computed(() => {
  if (!editing.value) return 0
  return calcProfit(editing.value.finalPrice, editing.value)
})
const estProfitRate = computed(() => {
  if (!editing.value?.finalPrice) return 0
  return (estProfit.value / editing.value.finalPrice) * 100
})

function suggestPriceByRate() {
  if (!editing.value) return
  const rate = Number(editing.value.targetProfitRate)
  if (!rate || rate <= 0 || rate >= 100) { ElMessage.warning('请先填写有效的目标利润率(0-100)'); return }
  const denom = 1 - rate / 100
  if (denom <= 0) { ElMessage.warning('目标利润率过高，无法算出售价'); return }
  editing.value.finalPrice = Math.ceil(fixedCostsRmb.value / denom)
  ElMessage.success(`已按目标利润率 ${rate}% 算出建议售价 ¥${editing.value.finalPrice}`)
}

async function confirmPrice() {
  if (!editing.value) return
  if (!editing.value.marketPrice) { ElMessage.warning('产品开发阶段未填写市场参考价，请先在选品申请中补充'); return }
  if (!editing.value.finalPrice) { ElMessage.warning('请填写最终售价'); return }
  if (!editing.value.pricingLogic) { ElMessage.warning('请填写定价逻辑'); return }
  if (estProfit.value < 0) {
    try {
      await ElMessageBox.confirm(
        `预估利润 ¥${estProfit.value.toFixed(2)} 为负，确认继续定价吗？`,
        '亏损预警', { type: 'warning', confirmButtonText: '仍然确认', cancelButtonText: '返回修改' }
      )
    } catch { return }
  }
  const ok = await withAction(async () => {
    await pricingApi.confirm(editing.value!.id, {
      marketPrice: editing.value!.marketPrice,
      pricingLogic: editing.value!.pricingLogic,
      targetProfitRate: editing.value!.targetProfitRate,
      finalPrice: editing.value!.finalPrice,
      visibleStockQty: editing.value!.visibleStockQty,
      overseasDeliveryFee: editing.value!.overseasDeliveryFee,
      platformCommission: editing.value!.platformCommission,
      platformDeliveryFee: editing.value!.platformDeliveryFee,
    })
  }, '定价已确认，等待陪跑同步至 OMS')
  if (ok) {
    pricingVisible.value = false
    load()
  }
}

async function syncToOms() {
  if (!editing.value) return
  const ok = await withAction(async () => {
    await pricingApi.syncOms(editing.value!.id)
  }, '售价已同步至 OMS')
  if (ok) {
    pricingVisible.value = false
    load()
  }
}

async function syncRow(id: number) {
  const p = items.value.find(x => x.id === id)
  const ok = await withAction(async () => {
    await pricingApi.syncOms(id)
  }, `${p?.sku || ''} 售价已同步至 OMS`)
  if (ok) load()
}

function trendOf(records: PriceRecord[], idx: number): 'down' | 'up' | 'flat' {
  if (idx === 0) return 'flat'
  const cur = records[idx].price, prev = records[idx - 1].price
  return cur < prev ? 'down' : cur > prev ? 'up' : 'flat'
}

const repriceVisible = ref(false)
const repricing = ref<PriceItem | null>(null)
const repriceForm = ref({
  marketPrice: 0,
  price: 0,
  note: '',
  overseasDeliveryFee: 0,
  platformCommission: 0,
  platformDeliveryFee: 0,
})

function openReprice(id: number) {
  const p = items.value.find(x => x.id === id)
  if (!p) return
  repricing.value = JSON.parse(JSON.stringify(p))
  ensureFeeDefaults(repricing.value!)
  repriceForm.value = {
    marketPrice: p.marketPrice,
    price: p.finalPrice,
    note: '',
    overseasDeliveryFee: p.overseasDeliveryFee ?? 0,
    platformCommission: p.platformCommission ?? 0,
    platformDeliveryFee: p.platformDeliveryFee ?? 0,
  }
  repriceVisible.value = true
}
const repriceCtx = computed(() => {
  if (!repricing.value) return null
  return {
    cost: repricing.value.cost,
    seaFreight: repricing.value.seaFreight,
    overseasDeliveryFee: repriceForm.value.overseasDeliveryFee,
    platformCommission: repriceForm.value.platformCommission,
    platformDeliveryFee: repriceForm.value.platformDeliveryFee,
    exchangeRate: repricing.value.exchangeRate,
  }
})
const repriceProfit = computed(() => {
  if (!repriceCtx.value) return 0
  return calcProfit(repriceForm.value.price, repriceCtx.value)
})
const repriceProfitRate = computed(() => repriceForm.value.price ? (repriceProfit.value / repriceForm.value.price) * 100 : 0)
const repriceCommissionRmb = computed(() => {
  if (!repricing.value) return 0
  return zarToRmb(repriceForm.value.platformCommission, repricing.value.exchangeRate)
})
const repriceDeliveryRmb = computed(() => {
  if (!repricing.value) return 0
  return zarToRmb(repriceForm.value.platformDeliveryFee, repricing.value.exchangeRate)
})
const repriceMarketRmb = computed(() => {
  if (!repricing.value) return 0
  return zarToRmb(repriceForm.value.marketPrice, repricing.value.exchangeRate)
})
const lastPrice = computed(() => {
  if (!repricing.value || !repricing.value.priceRecords.length) return repricing.value?.finalPrice || 0
  return repricing.value.priceRecords[repricing.value.priceRecords.length - 1].price
})
const priceDelta = computed(() => repriceForm.value.price - lastPrice.value)

async function submitReprice() {
  if (!repricing.value) return
  if (!repriceForm.value.price) { ElMessage.warning('请填写新售价'); return }
  if (repriceProfit.value < 0) {
    try {
      await ElMessageBox.confirm(
        `预估利润 ¥${repriceProfit.value.toFixed(2)} 为负，确认继续调价吗？`,
        '亏损预警', { type: 'warning', confirmButtonText: '仍然调价', cancelButtonText: '返回修改' }
      )
    } catch { return }
  }
  const ok = await withAction(async () => {
    await pricingApi.reprice(repricing.value!.id, {
      marketPrice: repriceForm.value.marketPrice,
      price: repriceForm.value.price,
      note: repriceForm.value.note,
      overseasDeliveryFee: repriceForm.value.overseasDeliveryFee,
      platformCommission: repriceForm.value.platformCommission,
      platformDeliveryFee: repriceForm.value.platformDeliveryFee,
    })
  }, '新售价已调整并同步至 OMS')
  if (ok) {
    repriceVisible.value = false
    load()
  }
}
</script>

<template>
  <el-card>
    <template #header>
      <div class="page-header">
        <div class="page-header-left">
          <span class="page-title">货盘库存</span>
          <el-radio-group v-model="section" size="small" class="section-switch">
            <el-radio-button value="pool">货盘池</el-radio-button>
            <el-radio-button value="holdings">货盘持有</el-radio-button>
          </el-radio-group>
        </div>
        <div v-if="section === 'pool'" class="header-actions">
          <el-tag size="small" type="info">当前角色：{{ app.currentRole }}</el-tag>
          <el-badge :value="myTodoCount" :hidden="myTodoCount === 0" type="danger">
            <el-button size="small" :type="tab === 'todo' ? 'primary' : 'default'" @click="tab = 'todo'">我的待办</el-button>
          </el-badge>
          <el-input v-model="searchQ" placeholder="搜索商品名称 / SKU" clearable style="width:180px" size="small" />
        </div>
        <div v-else class="header-actions">
          <el-input v-model="holdingsCustomerCode" placeholder="客户代码" clearable style="width:120px" size="small" @keyup.enter="searchHoldings" />
          <el-input v-model="holdingsProductCode" placeholder="SKU / 品名" clearable style="width:160px" size="small" @keyup.enter="searchHoldings" />
          <el-button type="primary" size="small" @click="searchHoldings">查询</el-button>
          <el-button size="small" @click="resetHoldingsFilters">重置</el-button>
        </div>
      </div>
    </template>

    <template v-if="section === 'pool'">
    <el-alert type="info" :closable="false" show-icon style="margin-bottom:14px">
      {{ PIPELINE_PRICING_ALERT }}
    </el-alert>

    <div class="stat-bar">
      <div class="stat-item" :class="{ active: tab === 'waiting_freight' }" @click="tab = 'waiting_freight'">
        <div class="stat-num">{{ stats.waiting_freight }}</div><div class="stat-label">待发运</div>
      </div>
      <div class="stat-item" :class="{ active: tab === 'pending_pricing' }" @click="tab = 'pending_pricing'">
        <div class="stat-num" style="color:#c4782b">{{ stats.pending_pricing }}</div><div class="stat-label">待定价</div>
      </div>
      <div class="stat-item" :class="{ active: tab === 'priced' }" @click="tab = 'priced'">
        <div class="stat-num" style="color:#2563eb">{{ stats.priced }}</div><div class="stat-label">已定价待同步</div>
      </div>
      <div class="stat-item" :class="{ active: tab === 'synced' }" @click="tab = 'synced'">
        <div class="stat-num" style="color:#1f9d92">{{ stats.synced }}</div><div class="stat-label">已同步OMS</div>
      </div>
    </div>

    <el-tabs v-model="tab" type="card">
      <el-tab-pane label="全部" name="all" />
      <el-tab-pane label="我的待办" name="todo" />
      <el-tab-pane label="待发运" name="waiting_freight" />
      <el-tab-pane label="待定价" name="pending_pricing" />
      <el-tab-pane label="已定价待同步" name="priced" />
      <el-tab-pane label="已同步OMS" name="synced" />
    </el-tabs>

    <el-table v-loading="loading" :data="pagedItems" stripe border size="small" :row-class-name="rowClassName">
      <el-table-column prop="sku" label="SKU" width="100">
        <template #default="{ row }"><span style="font-family:var(--font-mono);font-size:12px">{{ row.sku }}</span></template>
      </el-table-column>
      <el-table-column prop="name" label="商品名" min-width="130" />
      <el-table-column prop="purchaseQty" label="采购数量" width="90" align="right">
        <template #default="{ row }">{{ row.purchaseQty.toLocaleString() }}</template>
      </el-table-column>
      <el-table-column label="采购成本" width="88" align="right">
        <template #default="{ row }">¥ {{ row.cost }}</template>
      </el-table-column>
      <el-table-column prop="inboundQty" label="本批入库" width="88" align="right">
        <template #default="{ row }">{{ row.inboundQty ? row.inboundQty.toLocaleString() : '—' }}</template>
      </el-table-column>
      <el-table-column label="海运费/件" width="92" align="right">
        <template #default="{ row }">
          <span v-if="row.seaFreight > 0">¥ {{ row.seaFreight }}</span>
          <span v-else style="color:#b0a89c;font-size:11px">—</span>
        </template>
      </el-table-column>
      <el-table-column label="可见库存" width="88" align="right">
        <template #default="{ row }">
          <span v-if="row.visibleStockQty != null">{{ row.visibleStockQty.toLocaleString() }}</span>
          <span v-else style="color:#b0a89c">—</span>
        </template>
      </el-table-column>
      <el-table-column label="已售" width="72" align="right">
        <template #default="{ row }">
          <span :style="{ color: row.soldQty > 0 ? '#2563eb' : '#b0a89c' }">{{ row.soldQty?.toLocaleString?.() ?? 0 }}</span>
        </template>
      </el-table-column>
      <el-table-column label="剩余" width="72" align="right">
        <template #default="{ row }">
          <span :style="{ fontWeight: row.remainingStockQty === 0 && row.visibleStockQty != null ? 600 : 400, color: row.remainingStockQty === 0 ? '#c95e60' : '#1f9d92' }">
            {{ row.remainingStockQty?.toLocaleString?.() ?? '—' }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="仓内可用" width="88" align="right">
        <template #default="{ row }">{{ row.warehouseAvailableQty?.toLocaleString?.() ?? 0 }}</template>
      </el-table-column>
      <el-table-column label="市场参考价" width="96" align="right">
        <template #default="{ row }"><span v-if="row.marketPrice">R {{ row.marketPrice }}</span><span v-else style="color:#b0a89c">—</span></template>
      </el-table-column>
      <el-table-column label="最终售价" width="92" align="right">
        <template #default="{ row }"><span v-if="row.finalPrice" style="font-weight:600;color:#1f9d92">¥ {{ row.finalPrice }}</span><span v-else style="color:#b0a89c">—</span></template>
      </el-table-column>
      <el-table-column label="定价状态" width="116">
        <template #default="{ row }">
          <el-tag :type="(pricingStatusMap[row.pricingStatus]?.type as any) || 'info'" size="small">{{ pricingStatusMap[row.pricingStatus]?.label }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="OMS货盘" width="120">
        <template #default="{ row }">
          <div class="oms-flags">
            <el-tag v-if="row.orderableOnOms" type="success" size="small">可下单</el-tag>
            <el-tag v-else-if="row.visibleOnOms" type="warning" size="small">可见</el-tag>
            <span v-else class="text-muted">未上架</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openPricing(row.id)">{{ needMyAction(row) ? '去处理' : '查看详情' }}</el-button>
          <el-button v-if="row.pricingStatus === 'priced' && canSyncOms" link type="success" size="small" @click="syncRow(row.id)">同步OMS</el-button>
          <el-button v-if="row.pricingStatus === 'synced' && canSyncOms" link type="warning" size="small" @click="openReprice(row.id)">调价</el-button>
        </template>
      </el-table-column>
    </el-table>
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
    </template>

    <template v-else>
      <el-alert type="info" :closable="false" show-icon style="margin-bottom:14px">
        客户从 OMS 货盘申购后的持有库存；申购后可发货，ERP 可收回并回流货盘池。
      </el-alert>
      <el-table v-loading="holdingsLoading" :data="holdingRows" stripe border size="small">
        <el-table-column prop="sku" label="SKU" width="120">
          <template #default="{ row }"><span class="mono">{{ row.sku }}</span></template>
        </el-table-column>
        <el-table-column label="客户 SKU" width="100" show-overflow-tooltip>
          <template #default="{ row }"><span class="mono">{{ row.customerSku || '—' }}</span></template>
        </el-table-column>
        <el-table-column prop="productName" label="商品名" min-width="140" show-overflow-tooltip />
        <el-table-column label="客户" min-width="120">
          <template #default="{ row }">
            <div class="mono">{{ row.customerCode }}</div>
            <div v-if="row.supplierName" class="cust-name">{{ row.supplierName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="持有量" width="80" align="right">
          <template #default="{ row }"><strong>{{ row.availableQty ?? 0 }}</strong></template>
        </el-table-column>
        <el-table-column label="锁定" width="72" align="right">
          <template #default="{ row }">{{ row.lockedQty ?? 0 }}</template>
        </el-table-column>
        <el-table-column label="购买笔数" width="88" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openCatalogPurchases(row)">
              {{ row.purchaseOrderCount ?? 0 }}
            </el-button>
          </template>
        </el-table-column>
        <el-table-column label="最近购买" width="150">
          <template #default="{ row }">{{ row.lastPurchaseAt ? fmtTime(row.lastPurchaseAt) : '—' }}</template>
        </el-table-column>
        <el-table-column label="售价" width="80" align="right">
          <template #default="{ row }">{{ row.finalPrice != null ? row.finalPrice : '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openCatalogPurchases(row)">购买明细</el-button>
            <el-button v-if="canReclaim && isReclaimableRow(row)" link type="danger" size="small" @click="openReclaim(row)">收回持有</el-button>
          </template>
        </el-table-column>
      </el-table>
      <ListPagination v-model:page="holdingsPage" v-model:page-size="holdingsPageSize" :total="holdingsTotal" />
    </template>
  </el-card>

  <el-dialog v-model="pricingVisible" :title="'货盘库存 · ' + (editing?.name || '')" width="760px" top="6vh" class="erp-detail">
    <template v-if="editing">
      <DetailSheet :kicker="editing.sku" :title="editing.name">
        <template #metrics>
          <div class="erp-detail__metric">
            <label>采购成本</label>
            <strong>¥ {{ editing.cost }}</strong>
          </div>
          <div class="erp-detail__metric">
            <label>海运费 / 件</label>
            <strong>¥ {{ editing.seaFreight }}</strong>
          </div>
          <div class="erp-detail__metric">
            <label>可见库存</label>
            <strong>{{ editing.visibleStockQty != null ? editing.visibleStockQty.toLocaleString() : '—' }}</strong>
          </div>
          <div class="erp-detail__metric is-accent">
            <label>剩余库存</label>
            <strong>{{ editing.remainingStockQty?.toLocaleString?.() ?? '—' }}</strong>
          </div>
        </template>
      </DetailSheet>
      <el-steps
        :active="pricingStepActive(editing.pricingStatus)"
        finish-status="success" align-center style="margin-bottom:20px"
      >
        <el-step title="成本同步" description="采购审核通过" />
        <el-step title="入库同步" description="发运自动分摊海运" />
        <el-step title="定价" description="主管/陪跑填价" />
        <el-step title="同步OMS" description="陪跑同步上架" />
      </el-steps>

      <el-divider content-position="left">关联单据 · 成本与国内费用（来自采购单）· 海运费（来自入库单）</el-divider>
      <el-descriptions :column="3" border size="small">
        <el-descriptions-item label="采购单">{{ editing.poNo || '—' }}</el-descriptions-item>
        <el-descriptions-item label="入库单">{{ editing.inboundNo || '—' }}</el-descriptions-item>
        <el-descriptions-item label="采购数量">{{ editing.purchaseQty.toLocaleString() }} <span class="form-tip">（采购审核时按实际采购单写入）</span></el-descriptions-item>
        <el-descriptions-item label="采购成本">¥ {{ editing.cost }} <span class="form-tip">（实际单价）</span></el-descriptions-item>
        <el-descriptions-item label="海运费/件">¥ {{ editing.seaFreight }}</el-descriptions-item>
        <el-descriptions-item label="国内费用/件">¥ {{ editing.domesticFee }} <span class="form-tip">（采购单国内运费分摊）</span></el-descriptions-item>
        <el-descriptions-item label="汇率(¥→R)">{{ editing.exchangeRate }}</el-descriptions-item>
        <el-descriptions-item label="本批入库">{{ editing.inboundQty ? editing.inboundQty.toLocaleString() : '—' }} <span class="form-tip">（入库发运时自动同步）</span></el-descriptions-item>
        <el-descriptions-item label="对客户可见库存">
          <span v-if="editing.visibleStockQty != null">{{ editing.visibleStockQty.toLocaleString() }}</span>
          <span v-else style="color:#b0a89c">—</span>
        </el-descriptions-item>
        <el-descriptions-item label="已售 / 剩余">
          <span style="font-weight:600">{{ editing.soldQty?.toLocaleString?.() ?? 0 }}</span>
          <span class="text-muted" style="margin:0 6px">/</span>
          <span :class="editing.remainingStockQty === 0 ? 'erp-money is-neg' : 'erp-money'">
            {{ editing.remainingStockQty?.toLocaleString?.() ?? '—' }}
          </span>
          <span class="form-tip">OMS 客户购买后自动累计已售，剩余 = 可见库存 − 已售</span>
        </el-descriptions-item>
        <el-descriptions-item label="仓内可用">{{ editing.warehouseAvailableQty?.toLocaleString?.() ?? 0 }} <span class="form-tip">（海外仓实际上架数量）</span></el-descriptions-item>
        <el-descriptions-item label="同步时间">{{ editing.freightCallbackTime || '—' }}</el-descriptions-item>
      </el-descriptions>

      <el-divider content-position="left">定价（开发主管 / 陪跑填写）</el-divider>
      <el-form label-width="150px">
        <el-form-item label="市场参考价(R)">
          <span v-if="editing.marketPrice" style="font-weight:600;font-size:15px">R {{ editing.marketPrice.toFixed(2) }}</span>
          <span v-else class="text-warn">产品开发阶段未填写</span>
          <span v-if="editing.marketPrice" class="form-tip">≈ ¥ {{ marketPriceRmb.toFixed(2) }}</span>
          <span class="form-tip">Takealot 竞品在售价（兰特），来自产品开发自动带入</span>
        </el-form-item>
        <el-form-item label="定价逻辑">
          <el-input v-model="editing.pricingLogic" :disabled="!canSetPrice" placeholder="例如：对标市场价 -5% / 成本加成 60%" />
        </el-form-item>
        <el-form-item label="目标利润率(%)">
          <el-input-number v-model="editing.targetProfitRate" :min="0" :max="100" :precision="1" :disabled="!canSetPrice" style="width:180px" />
          <el-button v-if="canSetPrice" link type="primary" size="small" style="margin-left:10px" @click="suggestPriceByRate">按利润率算价</el-button>
        </el-form-item>
        <el-form-item label="海外仓派送费/件(¥)">
          <el-input-number v-model="editing.overseasDeliveryFee" :min="0" :precision="2" :disabled="!canSetPrice" style="width:180px" />
        </el-form-item>
        <el-form-item label="平台佣金/件(R)">
          <el-input-number v-model="editing.platformCommission" :min="0" :precision="2" :disabled="!canSetPrice" style="width:180px" />
          <span class="form-tip">≈ ¥ {{ estCommissionRmb.toFixed(2) }}/件</span>
        </el-form-item>
        <el-form-item label="平台派送费/件(R)">
          <el-input-number v-model="editing.platformDeliveryFee" :min="0" :precision="2" :disabled="!canSetPrice" style="width:180px" />
          <span class="form-tip">≈ ¥ {{ estDeliveryRmb.toFixed(2) }}/件</span>
        </el-form-item>
        <el-form-item v-if="editing.finalPrice" label="预估利润(¥)">
          <span :class="estProfit >= 0 ? 'erp-money' : 'erp-money is-neg'">
            ¥ {{ estProfit.toFixed(2) }}（利润率 {{ estProfitRate.toFixed(1) }}%）
          </span>
          <el-tag v-if="estProfit < 0" type="danger" size="small" style="margin-left:8px">亏损</el-tag>
          <div class="profit-breakdown">
            售价 ¥{{ editing.finalPrice.toFixed(2) }} − 成本 ¥{{ editing.cost }} − 海运 ¥{{ editing.seaFreight }}
            − 海外仓 ¥{{ editing.overseasDeliveryFee }} − 佣金 ¥{{ estCommissionRmb.toFixed(2) }} − 平台派送 ¥{{ estDeliveryRmb.toFixed(2) }}
          </div>
        </el-form-item>
        <el-form-item v-if="editing.pricingStatus === 'pending_pricing'" label="对客户可见库存">
          <el-input-number
            v-model="editing.visibleStockQty"
            :min="0"
            :max="Math.max(editing.inboundQty || editing.purchaseQty || 99999, editing.warehouseAvailableQty || 0)"
            :disabled="!canSetPrice"
            style="width:180px"
          />
          <span class="form-tip">OMS 展示的可售库存（可与实际上架量不同；补货规则后续完善）</span>
        </el-form-item>
        <el-form-item label="最终售价(¥)">
          <el-input-number v-model="editing.finalPrice" :min="0" :precision="2" :disabled="!canSetPrice" style="width:180px" />
        </el-form-item>
      </el-form>

      <template v-if="editing.pricingStatus === 'synced' || editing.visibleOnOms">
        <el-divider content-position="left">OMS 货盘</el-divider>
        <el-descriptions :column="2" border size="small" style="margin-bottom:12px">
          <el-descriptions-item label="对客户可见">
            <el-tag :type="editing.visibleOnOms ? 'success' : 'info'" size="small">{{ editing.visibleOnOms ? '是' : '否' }}</el-tag>
            <span v-if="editing.visibleOnOmsAt" class="desc-time">{{ editing.visibleOnOmsAt }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="允许下单">
            <el-tag :type="editing.orderableOnOms ? 'success' : 'warning'" size="small">{{ editing.orderableOnOms ? '是' : '否（待海外仓库存）' }}</el-tag>
            <span v-if="editing.orderableOnOmsAt" class="desc-time">{{ editing.orderableOnOmsAt }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="OMS 展示库存">
            <span style="font-weight:600;color:#1f9d92">{{ editing.remainingStockQty?.toLocaleString?.() ?? '—' }}</span>
            <span class="form-tip">剩余库存同步至 OMS 展示层（`GET /pricing/oms/catalog`）</span>
          </el-descriptions-item>
          <el-descriptions-item label="客户购买">
            <span class="form-tip">OMS 下单自动扣客户余额，扣款后库存转入客户账号</span>
          </el-descriptions-item>
        </el-descriptions>
        <el-alert v-if="editing.pricingStatus === 'synced'" type="success" :closable="false" show-icon>
          已同步至 OMS · 最近同步：{{ editing.omsSyncTime }} · OMS 展示剩余 {{ editing.remainingStockQty?.toLocaleString?.() ?? 0 }} 件
        </el-alert>
      </template>

      <template v-if="editing.priceRecords.length">
        <el-divider content-position="left">价格变化趋势（陪跑持续调价）</el-divider>
        <el-table :data="editing.priceRecords" size="small" border>
          <el-table-column prop="date" label="日期" width="80" />
          <el-table-column label="市场价(R)" width="100" align="right"><template #default="{ row }">R {{ row.marketPrice }}</template></el-table-column>
          <el-table-column label="售价" width="120" align="right">
            <template #default="{ row, $index }">
              <span style="font-weight:600">¥ {{ row.price }}</span>
              <span v-if="trendOf(editing!.priceRecords, $index) === 'down'" style="color:#1f9d92;margin-left:4px">↓</span>
              <span v-else-if="trendOf(editing!.priceRecords, $index) === 'up'" style="color:#c95e60;margin-left:4px">↑</span>
            </template>
          </el-table-column>
          <el-table-column prop="operator" label="操作人" width="80" />
          <el-table-column prop="note" label="调价原因" min-width="140" />
        </el-table>
      </template>

      <el-divider content-position="left">操作记录</el-divider>
      <el-timeline v-if="editing.history.length" style="padding-left:4px">
        <el-timeline-item v-for="(h, i) in editing.history" :key="i" :timestamp="h.time" placement="top">
          <span style="font-weight:600">{{ h.role }}</span><span style="color:#8b95a8"> · {{ h.action }}</span>
          <div style="font-size:12px;color:#5c6578;margin-top:2px">{{ h.detail }}</div>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-else description="暂无操作记录" :image-size="60" />
    </template>

    <template #footer>
      <el-button @click="pricingVisible = false">关闭</el-button>
      <el-button
        v-if="editing && editing.pricingStatus === 'pending_pricing' && canSetPrice"
        type="primary" @click="confirmPrice"
      >确认定价</el-button>
      <el-button
        v-if="editing && editing.pricingStatus === 'priced' && canSyncOms"
        type="success" @click="syncToOms"
      >同步至 OMS</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="repriceVisible" :title="'调价并同步 · ' + (repricing?.name || '')" width="600px">
    <template v-if="repricing">
      <el-alert type="info" :closable="false" show-icon style="margin-bottom:16px">
        当前售价 ¥{{ lastPrice }}。市场走低时可下调售价保持竞争力，调价后自动同步 OMS。
      </el-alert>
      <el-form label-width="140px">
        <el-form-item label="市场参考价(R)">
          <span style="font-weight:600">R {{ repriceForm.marketPrice.toFixed(2) }}</span>
          <span class="form-tip">≈ ¥ {{ repriceMarketRmb.toFixed(2) }} · 来自产品开发</span>
        </el-form-item>
        <el-form-item label="海外仓派送费(¥)">
          <el-input-number v-model="repriceForm.overseasDeliveryFee" :min="0" :precision="2" style="width:180px" />
        </el-form-item>
        <el-form-item label="平台佣金/件(R)">
          <el-input-number v-model="repriceForm.platformCommission" :min="0" :precision="2" style="width:180px" />
          <span class="form-tip">≈ ¥ {{ repriceCommissionRmb.toFixed(2) }}</span>
        </el-form-item>
        <el-form-item label="平台派送费/件(R)">
          <el-input-number v-model="repriceForm.platformDeliveryFee" :min="0" :precision="2" style="width:180px" />
          <span class="form-tip">≈ ¥ {{ repriceDeliveryRmb.toFixed(2) }}</span>
        </el-form-item>
        <el-form-item v-if="repriceForm.price" label="预估利润(¥)">
          <span :style="{ color: repriceProfit >= 0 ? '#1f9d92' : '#c95e60', fontWeight: 600 }">
            ¥ {{ repriceProfit.toFixed(2) }}（利润率 {{ repriceProfitRate.toFixed(1) }}%）
          </span>
          <el-tag v-if="repriceProfit < 0" type="danger" size="small" style="margin-left:8px">亏损</el-tag>
        </el-form-item>
        <el-form-item label="新售价(¥)">
          <el-input-number v-model="repriceForm.price" :min="0" :precision="2" style="width:180px" />
          <span v-if="priceDelta < 0" style="color:#1f9d92;margin-left:10px;font-size:12px">↓ 较上版降 ¥{{ Math.abs(priceDelta).toFixed(2) }}</span>
          <span v-else-if="priceDelta > 0" style="color:#c95e60;margin-left:10px;font-size:12px">↑ 较上版涨 ¥{{ priceDelta.toFixed(2) }}</span>
        </el-form-item>
        <el-form-item label="调价原因">
          <el-input v-model="repriceForm.note" type="textarea" :rows="2" placeholder="例如：竞品降价跟进 / 清库存促销" />
        </el-form-item>
      </el-form>
    </template>
    <template #footer>
      <el-button @click="repriceVisible = false">取消</el-button>
      <el-button type="primary" @click="submitReprice">调价并同步 OMS</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="catalogPurchaseVisible"
    :title="`货盘购买明细 · ${catalogPurchaseSku}${catalogPurchaseCustomer ? ' · ' + catalogPurchaseCustomer : ''}`"
    width="820px"
    destroy-on-close
  >
    <el-table v-loading="catalogPurchaseLoading" :data="catalogPurchaseRows" border size="small" max-height="420">
      <el-table-column prop="orderNo" label="订单号" width="140">
        <template #default="{ row }"><span class="mono">{{ row.orderNo }}</span></template>
      </el-table-column>
      <el-table-column prop="customerCode" label="客户代码" width="100" />
      <el-table-column prop="customerName" label="客户名称" min-width="120" show-overflow-tooltip />
      <el-table-column prop="quantity" label="购买数量" width="80" align="right" />
      <el-table-column label="单价" width="72" align="right">
        <template #default="{ row }">{{ row.unitPrice != null ? row.unitPrice : '—' }}</template>
      </el-table-column>
      <el-table-column label="合计" width="80" align="right">
        <template #default="{ row }">{{ row.totalAmount != null ? row.totalAmount : '—' }}</template>
      </el-table-column>
      <el-table-column label="购买时间" width="150">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!catalogPurchaseLoading && !catalogPurchaseRows.length" description="暂无购买记录" :image-size="64" />
  </el-dialog>

  <el-dialog v-model="reclaimDialogVisible" title="收回货盘持有" width="480px" destroy-on-close>
    <p class="reclaim-tip">
      客户申购后可使用该库存发货；收回后库存回流 ERP 货盘池，并同步扣减 OMS 客户发货权限。
    </p>
    <el-form label-width="90px" size="small">
      <el-form-item label="客户代码" required>
        <el-input v-model="reclaimForm.customerCode" disabled />
      </el-form-item>
      <el-form-item label="SKU">
        <span class="mono">{{ reclaimForm.sku }}</span>
      </el-form-item>
      <el-form-item label="品名">
        <span>{{ reclaimForm.productName || '—' }}</span>
      </el-form-item>
      <el-form-item label="可收回">
        <span>{{ reclaimForm.maxQty.toLocaleString() }} 件</span>
      </el-form-item>
      <el-form-item label="收回数量" required>
        <el-input-number v-model="reclaimForm.quantity" :min="1" :max="Math.max(reclaimForm.maxQty, 1)" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="reclaimForm.remark" type="textarea" :rows="2" placeholder="如：违规占用、订单取消等" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="reclaimDialogVisible = false">取消</el-button>
      <el-button type="danger" :loading="reclaimSubmitting" @click="submitReclaim">确认收回</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.page-header-left { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.page-title { font-weight:600; font-size:15px; }
.section-switch { margin-left:4px; }
.header-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.mono { font-family:var(--font-mono); font-size:12px; }
.cust-name { font-size:11px; color:#718096; margin-top:2px; }
.reclaim-tip { font-size:12px; color:#64748b; margin:0 0 14px; line-height:1.5; }
.form-tip { font-size:11px; color:#718096; margin-left:10px; display:block; margin-top:2px; }
.profit-breakdown { font-size:11px; color:#94a3b8; margin-top:6px; line-height:1.5; }

.stat-bar { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:14px; }
.oms-flags { display:flex; flex-direction:column; gap:4px; }
.text-muted { color:#718096; font-size:11px; }
.desc-time { margin-left:8px; font-size:11px; color:#94a3b8; }
.stat-item {
  border:1px solid rgba(99,102,241,0.16); border-radius:14px; padding:12px 16px;
  background:linear-gradient(145deg, rgba(18,17,48,0.86), rgba(10,9,25,0.72));
  box-shadow:0 12px 32px rgba(0,0,0,0.14);
  cursor:pointer; transition:all 0.15s;
}
.stat-item:hover { border-color:rgba(99,102,241,0.34); background:linear-gradient(145deg, rgba(30,27,75,0.76), rgba(10,9,25,0.76)); }
.stat-item.active { border-color:rgba(129,140,248,0.55); box-shadow:0 0 0 2px rgba(99,102,241,0.18); }
.stat-num { font-size:24px; font-weight:700; font-family:var(--font-mono); color:#f8fafc; line-height:1.1; font-variant-numeric:tabular-nums; }
.stat-label { font-size:12px; color:#718096; margin-top:4px; }

:deep(.row-todo) { background:rgba(245,158,11,0.08) !important; }
:deep(.row-todo:hover > td) { background:rgba(245,158,11,0.14) !important; }
</style>
