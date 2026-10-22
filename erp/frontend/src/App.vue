<script setup lang="ts">
import { RouterView } from 'vue-router'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import PageErrorBoundary from './components/ui/PageErrorBoundary.vue'
</script>

<template>
  <el-config-provider :locale="zhCn">
    <PageErrorBoundary><RouterView /></PageErrorBoundary>
  </el-config-provider>
</template>
