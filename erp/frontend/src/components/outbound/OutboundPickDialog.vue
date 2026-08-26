<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { outboundApi } from '@/api/client.js'
import { withAction } from '@/composables/useListLoader.ts'

export type PickLine = {
  key: string
  itemId: number
  sku: string
  totalQty: number
  qty: number
  available: number
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
}>()

const pickSource = ref<'pda' | 'pick_list'>('pda')
const pickLines = ref<PickLine[]>([])
const pickLoading = ref(false)
const pickSubmitting = ref(false)

watch(
  () => props.modelValue,
  (visible) => {
    if (visible && props.order) void loadPickLines(props.order)
  },
)

async function loadPickLines(row: NonNullable<typeof props.order>) {
  if (row.status !== 'picking' || !row.pickerId) {
    ElMessage.warning('请先分配拣货员后再完成拣货')
    emit('update:modelValue', false)
    return
  }
  pickSource.value = 'pda'
  pickLines.value = []
  pickLoading.value = true
  try {
    const data = await outboundApi.pickSuggestions(row.id)
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
    ElMessage.error(err?.message || '加载拣货库位失败')
    emit('update:modelValue', false)
  } finally {
    pickLoading.value = false
  }
}

async function submitPick() {
  if (!props.order || !props.canPick) return
  if (pickLines.value.some((l) => !l.locationCode)) {
    ElMessage.warning('存在未分配库位的 SKU，请先完成上架')
    return
  }
  const grouped = new Map<number, { id: number; allocations: { locationCode: string; qty: number }[] }>()
  for (const line of pickLines.value) {
    const item = grouped.get(line.itemId) || { id: line.itemId, allocations: [] }
    item.allocations.push({ locationCode: line.locationCode, qty: line.qty })
    grouped.set(line.itemId, item)
  }
  pickSubmitting.value = true
  try {
    await withAction(async () => {
      await outboundApi.pick(props.order!.id, {
        pickSource: pickSource.value,
        items: [...grouped.values()],
      })
      emit('update:modelValue', false)
      emit('success')
    }, `${props.order.outboundNo} 已完成拣货`)
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
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="pick-hint">系统已按库位拆分任务，必须全部拣完；短拣请标记库存短缺异常。</div>
    <el-form label-width="80px" style="margin-bottom:12px">
      <el-form-item label="拣货来源">
        <el-radio-group v-model="pickSource" size="small">
          <el-radio-button value="pda">PDA</el-radio-button>
          <el-radio-button value="pick_list">拣货单</el-radio-button>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <el-table v-loading="pickLoading" :data="pickLines" row-key="key" size="small" border>
      <el-table-column prop="sku" label="SKU" width="120" />
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
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="pickSubmitting" @click="submitPick">完成拣货</el-button>
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
