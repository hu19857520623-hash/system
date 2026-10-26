<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { internalRedirect } from '@/auth/internalRedirect'
import { createAccessRetry } from '@/auth/accessRetry'
import { getAccessToken } from '@/auth/tokenStore'

const route = useRoute(), router = useRouter(), app = useAppStore()
const recovery = createAccessRetry(router, app, getAccessToken)
const { checking, feedback, retry: retryAccess } = recovery
const unverified = computed(() => route.query.reason === 'permission-read-failed')
const targetPath = computed(() => internalRedirect(route.query.redirect))
const targetTitle = computed(() => String(router.resolve(targetPath.value).meta.title || '此功能'))
onBeforeUnmount(recovery.stop)
async function returnHome() {
  try {
    await router.replace(app.isAuthenticated ? '/dashboard' : { path: '/login', query: { redirect: targetPath.value } })
  } catch { /* PageErrorBoundary handles navigation failures. */ }
}
</script>

<template>
  <section class="access-denied" role="status">
    <h1>{{ unverified ? '暂时无法核对页面权限' : '当前账号无权访问此页面' }}</h1>
    <p v-if="unverified">「{{ targetTitle }}」的权限信息暂时无法读取，尚未确认是否有访问权限。请检查网络后重新核对，或{{ app.isAuthenticated ? '返回工作台' : '返回登录' }}。</p>
    <p v-else>「{{ targetTitle }}」需要相应岗位权限。可从左侧菜单进入当前账号有权限的功能。</p>
    <el-alert v-if="feedback" :title="feedback" type="warning" :closable="false" />
    <div class="actions">
      <el-button type="primary" @click="returnHome">{{ app.isAuthenticated ? '返回工作台' : '返回登录' }}</el-button>
      <el-button :loading="checking" @click="retryAccess">重新核对权限</el-button>
    </div>
  </section>
</template>

<style scoped>
.access-denied { padding: 40px; }
.access-denied p { margin: 16px 0; }
.actions { margin-top: 16px; display: flex; gap: 12px; flex-wrap: wrap; }
</style>
