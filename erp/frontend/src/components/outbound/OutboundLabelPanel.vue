<script setup lang="ts">
import { computed } from 'vue'
import {
  buildOutboundLabelSummary,
  outboundLabelActionKey,
  type OutboundLabelLine,
} from '@/features/outbound/labels'

const props = withDefaults(defineProps<{
  detail: Record<string, any> | null
  loading?: boolean
  actionLoading?: Record<string, boolean>
}>(), {
  loading: false,
  actionLoading: () => ({}),
})

const emit = defineEmits<{
  printOrder: []
  printSku: [line: OutboundLabelLine]
  printUnit: [line: OutboundLabelLine, unitIndex: number]
}>()

const summary = computed(() => buildOutboundLabelSummary(props.detail))
const orderId = computed(() => props.detail?.id ?? '')

function isActionLoading(action: 'order' | 'sku' | 'unit', sku?: string, unitIndex?: number) {
  return !!props.actionLoading[
    outboundLabelActionKey(orderId.value, action, sku, unitIndex)
  ]
}

function emitPrintSku(line: unknown) {
  emit('printSku', line as OutboundLabelLine)
}

function emitPrintUnit(line: unknown, unitIndex: number) {
  emit('printUnit', line as OutboundLabelLine, unitIndex)
}
</script>

<template>
  <section class="outbound-label-panel" aria-label="平台商品标签">
    <header class="label-panel-header">
      <div>
        <h3>平台商品标签</h3>
        <p v-if="summary.isTakealot && summary.hasLabelMetadata">
          Takealot 标签已按单件裁切，可直接打开 PDF 打印。
        </p>
      </div>
      <div
        v-if="summary.isTakealot && summary.hasLabelMetadata && summary.lines.length"
        class="order-print"
      >
        <span class="label-total">
          {{ summary.totalCroppedLabels }} / {{ summary.totalExpectedQty }} 张
        </span>
        <el-button
          type="primary"
          size="small"
          :loading="isActionLoading('order')"
          :disabled="!summary.allPrintable"
          @click="emit('printOrder')"
        >
          打印整单
        </el-button>
      </div>
    </header>

    <div v-if="loading" class="label-loading">
      <el-skeleton :rows="3" animated />
    </div>

    <el-alert
      v-else-if="!summary.isTakealot || !summary.hasLabelMetadata"
      title="无平台商品标签"
      :description="summary.isTakealot
        ? '此单没有可用的单件裁切标签；原始附件仍可从出库单操作菜单下载。'
        : '此单不是带单件标签的 Takealot 出库单；原始附件仍可从出库单操作菜单下载。'"
      type="info"
      :closable="false"
      show-icon
    />

    <el-alert
      v-else-if="!summary.lines.length"
      title="平台商品标签未就绪"
      description="出库明细尚未返回标签映射信息，请稍后刷新。"
      type="warning"
      :closable="false"
      show-icon
    />

    <el-table v-else :data="summary.lines" size="small" border class="label-table">
      <el-table-column label="内部 SKU" min-width="130">
        <template #default="{ row }">
          <span class="mono">{{ row.internalSku }}</span>
        </template>
      </el-table-column>
      <el-table-column label="应贴" width="64" align="center">
        <template #default="{ row }">{{ row.expectedQty }}</template>
      </el-table-column>
      <el-table-column label="裁切标签" width="104" align="center">
        <template #default="{ row }">
          <el-tag :type="row.countMatches ? 'success' : 'danger'" size="small">
            {{ row.croppedLabelCount }} / {{ row.expectedQty }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="准备状态" min-width="150">
        <template #default="{ row }">
          <div class="readiness-tags">
            <el-tag :type="row.mappingReady ? 'success' : 'warning'" size="small" effect="plain">
              {{ row.mappingReady ? 'SKU 已匹配' : 'SKU 待匹配' }}
            </el-tag>
            <el-tag :type="row.labelReady ? 'success' : 'warning'" size="small" effect="plain">
              {{ row.labelReady ? '标签已生成' : '标签待生成' }}
            </el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="单件标签 / 单件打印" min-width="240">
        <template #default="{ row }">
          <div v-if="row.unitIndices.length" class="unit-actions">
            <el-button
              v-for="unitIndex in row.unitIndices"
              :key="unitIndex"
              size="small"
              plain
              :loading="isActionLoading('unit', row.internalSku, unitIndex)"
              :disabled="!row.printable"
              :aria-label="`打印 ${row.internalSku} 第 ${unitIndex} 件标签`"
              @click="emitPrintUnit(row, unitIndex)"
            >
              #{{ unitIndex }}
            </el-button>
          </div>
          <span v-else class="muted">暂无单件索引</span>
        </template>
      </el-table-column>
      <el-table-column label="SKU 操作" width="118" align="center" fixed="right">
        <template #default="{ row }">
          <el-button
            type="primary"
            link
            size="small"
            :loading="isActionLoading('sku', row.internalSku)"
            :disabled="!row.printable"
            @click="emitPrintSku(row)"
          >
            打印此 SKU
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <p
      v-if="summary.isTakealot && summary.hasLabelMetadata && summary.lines.length && !summary.allPrintable"
      class="label-blocked-hint"
    >
      标签张数必须与应贴数量一致，且 SKU 匹配和标签生成完成后，打印操作才可用。
    </p>
  </section>
</template>

<style scoped>
.outbound-label-panel {
  padding: 12px;
  background: var(--el-fill-color-extra-light);
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}
.label-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 10px;
}
.label-panel-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.label-panel-header p {
  margin: 3px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.order-print {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.label-total {
  color: var(--el-text-color-secondary);
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.label-loading {
  padding: 4px 8px;
}
.label-table {
  width: 100%;
}
.mono {
  font-family: ui-monospace, monospace;
}
.readiness-tags,
.unit-actions {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}
.unit-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.label-blocked-hint {
  margin: 9px 0 0;
  color: var(--el-color-warning-dark-2);
  font-size: 12px;
}

@media (max-width: 720px) {
  .label-panel-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
