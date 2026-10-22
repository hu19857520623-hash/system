<script setup lang="ts">
import { onBeforeUnmount, onErrorCaptured, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const failed = ref(false)
const route = useRoute()
const router = useRouter()
const removeRouterError = router.onError(error => {
  console.error('页面加载失败', error)
  failed.value = true
})
onBeforeUnmount(removeRouterError)
onErrorCaptured(error => {
  console.error('页面显示失败', error)
  failed.value = true
  return false
})
watch(() => route.fullPath, () => { failed.value = false })
function reload() { window.location.reload() }
function returnHome() {
  failed.value = false
  void router.push('/dashboard')
}
</script>

<template>
  <section v-if="failed" class="page-error" role="alert">
    <h1>页面暂时无法显示</h1>
    <p>请重新加载页面；如仍无法打开，可返回工作台重新进入，或联系管理员。</p>
    <el-button type="primary" @click="reload">重新加载</el-button>
    <el-button @click="returnHome">返回工作台</el-button>
  </section>
  <slot v-else />
</template>

<style scoped>
.page-error { margin: 48px auto; padding: 24px; max-width: 560px; }
.page-error p { margin: 16px 0; line-height: 1.7; }
</style>
