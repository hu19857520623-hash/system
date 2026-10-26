<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { liveAccess } from '@/router'
import { ACCOUNT_ROUTES } from '@/router/routeAccess'

const route = useRoute(), router = useRouter()
const { checking, error, notice } = liveAccess
const blocked = computed(() => !!error.value && !ACCOUNT_ROUTES.has(String(route.name || '')))
let stop: (() => void) | undefined
onMounted(() => { stop = liveAccess.start() })
onBeforeUnmount(() => stop?.())
async function returnHome() {
  liveAccess.clearFeedback()
  try { await router.replace('/dashboard') } catch { /* PageErrorBoundary handles page-load recovery. */ }
}
</script>

<template>
  <div>
    <el-alert v-if="error && route.name !== 'Login' && route.name !== 'AccessDenied'" class="access-notice" :title="error" type="warning" :closable="false">
      <el-button size="small" :loading="checking" @click="liveAccess.refreshCurrent">重新核对权限</el-button>
      <el-button size="small" @click="returnHome">返回工作台</el-button>
    </el-alert>
    <el-alert v-else-if="notice && route.name !== 'Login'" class="access-notice" :title="notice" type="info" @close="liveAccess.clearFeedback" />
    <div :inert="blocked || undefined"><slot /></div>
  </div>
</template>

<style scoped>
.access-notice { position: relative; z-index: 20; }
</style>
