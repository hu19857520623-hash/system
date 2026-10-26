<script setup lang="ts">
import { RouterView } from 'vue-router'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import PageErrorBoundary from './components/ui/PageErrorBoundary.vue'
import LiveAccessGate from './components/ui/LiveAccessGate.vue'
</script>

<template>
  <el-config-provider :locale="zhCn">
    <PageErrorBoundary><LiveAccessGate><RouterView /></LiveAccessGate></PageErrorBoundary>
  </el-config-provider>
</template>
