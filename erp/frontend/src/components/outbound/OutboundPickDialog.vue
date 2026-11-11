<script setup lang="ts">
import { userFacingError } from '@erp/shared/user-facing-error'

import { displaySkuText, formatSku } from '@erp/shared/sku-display'
import { ref, watch, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { outboundApi } from '@/api/client.js'
import { useAppStore } from '@/stores/app'
import { getAccessToken } from '@/auth/tokenStore'
import { readPickAttempts, savePickAttempt, operatePickAttempt, withPickLock, type PickAttempt } from '@/utils/outboundPicking'

export type PickLine = {
  key: string
  itemId: number
  sku: string
  totalQty: number
  qty: number
  available: number | string
  locationCode: string
}

const props = defineProps<{
  modelValue: boolean
  order: { id: number; outboundNo?: string; status?: string; pickerId?: number | null } | null
  canPick: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  success: []
  pending: []
}>()

const pickSource = ref<'pda' | 'pick_list'>('pick_list')
const pickLines = ref<PickLine[]>([])
const pickLoading = ref(false)
const pickSubmitting = ref(false)
const app = useAppStore(), pending = ref<PickAttempt | null>(null), error = ref(''), storageError = ref('')
let generation = 0, mounted = true
onBeforeUnmount(() => { mounted = false;generation++ })
function readPending() {
  try {
    pending.value = readPickAttempts(localStorage, Number(app.authenticatedUser?.id)).find(r => r.outboundId === props.order?.id) || null
    storageError.value = ''
  } catch (e) { pending.value = null;storageError.value = userFacingError(e) }
}
function showOriginal() {
  if (!pending.value) return
  pickSource.value = pending.value.payload.pickSource
  pickLines.value = pending.value.payload.items.flatMap(item => item.allocations.map((line, index) => ({
    key: `${item.id}-${index}`, itemId: item.id, sku: pending.value?.labels?.[String(item.id)] || `明细 ${item.id}`,
    totalQty: item.allocations.reduce((sum, a) => sum + a.qty, 0), qty: line.qty, available: '—', locationCode: line.locationCode,
  })))
}

watch(
  () => [props.modelValue, props.order?.id, app.profileRevision],
  () => {
    generation++;pickLoading.value = false;error.value = '';pickLines.value = []
    if (!props.modelValue || !props.order) return
    readPending()
    if (storageError.value) return
    if (pending.value) showOriginal()
    else void loadPickLines(props.order, generation)
  },
)

async function loadPickLines(row: NonNullable<typeof props.order>, version: number) {
  if (row.status !== 'picking' || !row.pickerId) {
    ElMessage.warning('请先分配拣货员后再完成拣货')
    emit('update:modelValue', false)
    return
  }
  pickSource.value = 'pick_list'
  pickLines.value = []
  pickLoading.value = true
  try {
    const data = await outboundApi.pickSuggestions(row.id)
    if (!mounted || version !== generation) return
    const uncovered = (data.items || []).filter((item: any) => Number(item.uncovered) > 0)
    if (uncovered.length) {
      const detail = uncovered.map((item: any) => `${item.sku} 缺 ${item.uncovered}`).join('、')
      throw new Error(`库位库存不足：${detail}；请标记库存短缺异常`)
    }
    pickLines.value = (data.items || []).flatMap((item: any) =>
      (item.suggestions || []).map((allocation: any) => ({
        key: `${item.id}-${allocation.locationCode}`,
        itemId: item.id,
        sku: item.sku,
        totalQty: item.qty,
        qty: allocation.pickQty,
        available: allocation.available,
        locationCode: allocation.locationCode || '',
      })),
    )
    if (!pickLines.value.length || pickLines.value.some((line) => !line.locationCode)) {
      throw new Error('部分 SKU 暂无可用库位，请确认已上架')
    }
  } catch (err: any) {
    if (mounted && version === generation) error.value = userFacingError(displaySkuText(err?.message || '加载拣货库位失败'))
  } finally {
    if (mounted && version === generation) pickLoading.value = false
  }
}

async function run(mode: 'retry' | 'check' | 'cancel') {
  if (!props.order || !props.canPick || pickSubmitting.value || pickLoading.value || storageError.value) return
  const actor = Number(app.authenticatedUser?.id), version = generation, order = { ...props.order }
  let token: string | null
  try { token = getAccessToken() } catch { error.value = '无法读取登录信息，请恢复浏览器存储并使用原账号核对';return }
  const expectedRequest = pending.value?.payload.clientRequestId
  const guard = () => {
    if (!mounted || !props.modelValue || version !== generation || actor !== Number(app.authenticatedUser?.id)
      || !token || token !== getAccessToken() || !props.canPick) throw new Error('账号、岗位或页面已变化，请返回原账号核对已保留的拣货请求')
  }
  pickSubmitting.value = true;error.value = ''
  try {
    await withPickLock(actor, async () => {
      guard();readPending()
      if (storageError.value) throw new Error(storageError.value)
      if (expectedRequest && pending.value?.payload.clientRequestId !== expectedRequest) throw new Error('原请求已由其它页面核对，请返回列表重新读取')
      if (!pending.value) {
        if (mode !== 'retry') throw new Error('原请求已变化，请返回列表重新读取')
        if (order.status !== 'picking' || !pickLines.value.length || pickLines.value.some(l => !l.locationCode)) throw new Error('请重新加载原单库位后再完成拣货')
        const grouped = new Map<number, { id: number; allocations: { locationCode: string; qty: number }[] }>()
        for (const line of pickLines.value) {
          const item = grouped.get(line.itemId) || { id: line.itemId, allocations: [] }
          item.allocations.push({ locationCode: line.locationCode, qty: line.qty });grouped.set(line.itemId, item)
        }
        const attempt: PickAttempt = { outboundId: order.id, outboundNo: order.outboundNo || '',
          order: { ...order, outboundNo: order.outboundNo || '' }, labels: Object.fromEntries(pickLines.value.map(l => [String(l.itemId), l.sku])),
          payload: { clientRequestId: crypto.randomUUID(), pickSource: pickSource.value, items: [...grouped.values()] } }
        savePickAttempt(localStorage, actor, attempt);readPending()
      }
      const attempt = pending.value!
      const result = await operatePickAttempt(outboundApi, localStorage, actor, attempt, mode, guard)
      guard();readPending();emit('pending')
      if (result.outcome === 'unknown') { error.value = '尚未查到原请求的完成记录。可核对并重试原明细，或取消原请求；请勿另建拣货操作。';return }
      ElMessage.success(result.outcome === 'confirmed' ? '原拣货已完成，请查看原单最新状态' : '原拣货请求已取消，不再接受迟到提交；本次未回滚已完成的作业')
      emit('success');emit('update:modelValue', false)
    })
  } catch (e) {
    if (mounted && version === generation) {
      error.value = userFacingError(e);readPending()
      if (expectedRequest && !pending.value) pickLines.value = []
      emit('pending')
    }
  } finally {
    pickSubmitting.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="`完成拣货 · ${order?.outboundNo || ''}`"
    width="640px"
    :close-on-click-modal="false"
    :close-on-press-escape="!pickSubmitting"
    :show-close="!pickSubmitting"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-alert v-if="error || storageError" :title="error || storageError" type="error" :closable="false" />
    <el-alert v-if="pending" title="原拣货明细已保存。请先查询原结果，重试将使用原数量和库位；取消只终止这次原请求。" type="warning" :closable="false" />
    <div class="pick-hint">
      在 ERP 网页按库位确认拣货（无独立 PDA 扫描端）。系统已拆分库位任务，须全部拣完；短拣请标记库存短缺异常。
    </div>
    <el-table v-loading="pickLoading" :data="pickLines" row-key="key" size="small" border>
      <el-table-column prop="sku" label="SKU" width="120" :formatter="formatSku" />
      <el-table-column label="总应拣" width="75" align="right">
        <template #default="{ row }">{{ row.totalQty }}</template>
      </el-table-column>
      <el-table-column label="本库位应拣" width="100" align="right">
        <template #default="{ row }">{{ row.qty }}</template>
      </el-table-column>
      <el-table-column label="拣货库位" min-width="140">
        <template #default="{ row }">
          <span v-if="row.locationCode" class="mono">{{ row.locationCode }}</span>
          <span v-else class="loc-empty">待上架</span>
        </template>
      </el-table-column>
      <el-table-column prop="available" label="库位库存" width="90" align="right" />
    </el-table>
    <template #footer>
      <el-button :disabled="pickSubmitting" @click="emit('update:modelValue', false)">{{ pending ? '返回并保留原请求' : '返回' }}</el-button>
      <el-button v-if="pending" :disabled="pickSubmitting || !canPick || !!storageError" @click="run('check')">查询原结果</el-button>
      <el-button v-if="pending" :disabled="pickSubmitting || !canPick || !!storageError" @click="run('cancel')">取消原请求</el-button>
      <el-button v-if="error && !pending && !storageError" :disabled="pickSubmitting" @click="order && loadPickLines(order, generation)">重新加载库位</el-button>
      <el-button type="primary" :loading="pickSubmitting" :disabled="!canPick || pickLoading || !!storageError || !pickLines.length" @click="run('retry')">{{ pending ? '核对并重试原拣货' : '完成拣货' }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.pick-hint {
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.mono { font-family: ui-monospace, monospace; }
.loc-empty { color: var(--el-color-warning); }
</style>
