<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import { userFacingError } from '@erp/shared/user-facing-error'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'

defineOptions({ name: 'FinanceBooksView' })

const CostLedgerView = defineAsyncComponent(() => import('@/pages/CostLedgerView.vue'))
const SupplierSeaFreightBillView = defineAsyncComponent(() => import('@/pages/SupplierSeaFreightBillView.vue'))
const OperatingLedgerView = defineAsyncComponent(() => import('@/pages/OperatingLedgerView.vue'))
const ProfitAnalysisView = defineAsyncComponent(() => import('@/pages/ProfitAnalysisView.vue'))

const route = useRoute()
const router = useRouter()
const app = useAppStore()

const tabs = [
  { key: 'freight', label: '海运账单', perm: 'receivable_payable.view' as const, view: SupplierSeaFreightBillView },
  { key: 'purchase', label: '采购货款', perm: 'cost.view' as const, view: CostLedgerView },
  { key: 'operating', label: '经营收支', perm: 'operating_ledger.view' as const, view: OperatingLedgerView },
  { key: 'analysis', label: '利润/采购分析', perm: ['profit_analysis.view', 'reports.view'] as const, view: ProfitAnalysisView },
]

function canSeeTab(perm: string | readonly string[]) {
  if (app.authenticatedUser?.roleCode === 'admin') return true
  const perms = Array.isArray(perm) ? [...perm] : [perm]
  return perms.some((p) => app.hasPerm(p))
}

const visibleTabs = computed(() => tabs.filter((tab) => canSeeTab(tab.perm)))

const activeTab = computed(() => {
  const key = String(route.params.tab || '')
  if (visibleTabs.value.some((tab) => tab.key === key)) return key
  return visibleTabs.value[0]?.key || 'freight'
})

const activeView = computed(() => visibleTabs.value.find((tab) => tab.key === activeTab.value)?.view || CostLedgerView)

const switching = ref(false)
const switchError = ref('')

async function switchTab(key: string | number) {
  const tab = visibleTabs.value.find((item) => item.key === String(key))
  if (!tab) return false
  if (route.params.tab === tab.key) return true
  if (switching.value) return false
  switching.value = true
  switchError.value = ''
  try {
    await router.push(`/finance-books/${tab.key}`)
    const arrived = route.params.tab === tab.key
    if (!arrived) switchError.value = '页面未能切换，请重新点击页签；如提示权限失效，请先重新核对权限。'
    return arrived
  } catch (error) {
    switchError.value = `页面切换失败。${userFacingError(error)}`
    return false
  } finally { switching.value = false }
}
// Permission refreshes recreate visibleTabs during route guards. Do not redirect
// from a watcher: it cancels the user's in-flight navigation from /finance-books.
// activeTab already provides a permitted fallback for missing/invalid route keys.
</script>

<template>
  <div class="finance-books-page">
    <el-card class="head-card">
      <div class="page-head">
        <div>
          <h2>账本分析</h2>
          <p>采购货款、海运账单、经营收支与利润分析放在同一入口，按权限显示页签</p>
        </div>
      </div>
      <el-tabs :model-value="activeTab" :before-leave="switchTab" :aria-busy="switching">
        <el-tab-pane v-for="tab in visibleTabs" :key="tab.key" :name="tab.key" :label="tab.label" />
      </el-tabs>
    </el-card>
    <el-alert v-if="switchError" :title="switchError" type="error" :closable="false" show-icon />

    <el-empty v-if="!visibleTabs.length" description="当前账号没有账本分析权限" />
    <KeepAlive v-else>
      <component :is="activeView" embedded />
    </KeepAlive>
  </div>
</template>

<style scoped>
.finance-books-page { display: flex; flex-direction: column; gap: 12px; }
.head-card :deep(.el-card__body) { padding-bottom: 0; }
.page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 4px; }
.page-head h2 { margin: 0; font-size: 18px; font-weight: 650; }
.page-head p { margin: 6px 0 0; color: var(--text-muted); font-size: 12px; }
.finance-books-page :deep(.is-embedded.el-card) {
  --el-card-border-color: transparent;
  background: transparent;
}
.finance-books-page :deep(.is-embedded .el-card__body) { padding-top: 4px; }
</style>
