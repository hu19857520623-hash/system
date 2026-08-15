<script setup lang="ts">
import { PAGE_SIZE_OPTIONS } from '@/composables/useTablePagination.ts'

const page = defineModel<number>('page', { required: true })
const pageSize = defineModel<number>('pageSize', { required: true })

defineProps<{ total: number }>()
</script>

<template>
  <div class="list-pagination">
    <el-pagination
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :page-sizes="[...PAGE_SIZE_OPTIONS]"
      :total="total"
      layout="total, sizes, prev, pager, next, jumper"
      background
      size="small"
    />
  </div>
</template>

<style scoped>
.list-pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
  padding-top: 4px;
}
</style>
