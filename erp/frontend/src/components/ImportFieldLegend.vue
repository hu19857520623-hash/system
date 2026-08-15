<script setup lang="ts">
import type { ImportFieldDef } from '@/constants/importTemplates.ts'

defineProps<{
  title?: string
  fields: ImportFieldDef[]
  compact?: boolean
}>()
</script>

<template>
  <div class="import-field-legend" :class="{ compact }">
    <div v-if="title" class="legend-title">{{ title }}</div>
    <ul class="legend-list">
      <li v-for="f in fields" :key="f.key" class="legend-item">
        <span v-if="f.required" class="req" aria-hidden="true">*</span>
        <span class="label" :class="{ 'is-required': f.required }">{{ f.label }}</span>
        <span v-if="f.required" class="tag tag-req">必填</span>
        <span v-else class="tag tag-opt">选填</span>
        <span v-if="f.hint" class="hint">{{ f.hint }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.import-field-legend {
  margin: 8px 0 10px;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--el-fill-color-lighter, #f5f7fa);
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  font-size: 12px;
  line-height: 1.5;
}
.import-field-legend.compact {
  margin: 0 0 10px;
  padding: 8px 10px;
}
.legend-title {
  font-weight: 600;
  color: var(--el-text-color-primary, #303133);
  margin-bottom: 6px;
}
.legend-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
}
.legend-item {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  color: var(--el-text-color-regular, #606266);
}
.req {
  color: #f56c6c;
  font-weight: 700;
  line-height: 1;
}
.label.is-required {
  font-weight: 500;
}
.tag {
  font-size: 11px;
  padding: 0 5px;
  border-radius: 3px;
  line-height: 18px;
}
.tag-req {
  color: #f56c6c;
  background: rgba(245, 108, 108, 0.1);
}
.tag-opt {
  color: var(--el-text-color-secondary, #909399);
  background: rgba(144, 147, 153, 0.12);
}
.hint {
  color: var(--el-text-color-secondary, #909399);
}
.hint::before {
  content: '· ';
}
</style>
