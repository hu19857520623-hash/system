<script setup lang="ts">
import { onBeforeUnmount, onErrorCaptured } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { createPageRecovery, reloadRecoveryPage } from '@/router/pageRecovery'

const route = useRoute()
const router = useRouter()
const { failed, targetTitle, feedback, returning, capture, reload, returnHome, dispose } = createPageRecovery(router, reloadRecoveryPage)
onBeforeUnmount(dispose)
onErrorCaptured(error => {
  console.error('页面显示失败', error)
  capture(route.fullPath)
  return false
})
</script>

<template>
  <section v-if="failed" class="page-error" role="alert">
    <h1>页面暂时无法显示</h1>
    <p>「{{ targetTitle }}」未能打开。重新加载会继续打开原目标页面；如仍失败，可返回工作台或联系管理员。</p>
    <el-alert v-if="feedback" :title="feedback" type="warning" :closable="false" />
    <el-button type="primary" :disabled="returning" @click="reload">重新加载</el-button>
    <el-button :loading="returning" @click="returnHome">返回工作台</el-button>
  </section>
  <slot v-else />
</template>

<style scoped>
.page-error { margin: 48px auto; padding: 24px; max-width: 560px; }
.page-error p { margin: 16px 0; line-height: 1.7; }
</style>
