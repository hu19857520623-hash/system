<script setup lang="ts">
import { computed } from 'vue'
import { DEAL_SERVICES, findDealService } from '@erp/shared/deal-services'
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const groups = [...new Set(DEAL_SERVICES.map(service => service.group))]
const selected = computed(() => findDealService(props.modelValue))
</script>

<template>
  <div class="deal-service-select">
    <el-select :model-value="modelValue" @update:model-value="value => emit('update:modelValue', value)"
      filterable placeholder="搜索服务代码或名称" style="width:100%" popper-class="deal-service-options">
      <el-option-group v-for="group in groups" :key="group" :label="group">
        <el-option v-for="service in DEAL_SERVICES.filter(item => item.group === group)" :key="service.code"
          :value="service.code" :label="`${service.code}｜${service.name}`" />
      </el-option-group>
    </el-select>
    <div v-if="selected" class="selected-service">{{ selected.code }}｜{{ selected.name }}</div>
  </div>
</template>

<style scoped>
.deal-service-select { width:100%; min-width:0; }
.selected-service { margin-top:6px; line-height:1.6; overflow-wrap:anywhere; color:var(--el-text-color-secondary); }
</style>
<style>
.deal-service-options { max-width:calc(100vw - 32px); }
.deal-service-options .el-select-dropdown__item { white-space:normal; height:auto; min-height:34px; line-height:1.6; padding-top:7px; padding-bottom:7px; overflow-wrap:anywhere; }
</style>
