<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { internalRedirect } from '@/auth/internalRedirect'
import { isRouteAllowed } from '@/router/routeAccess'
import { userFacingError } from '@erp/shared/user-facing-error'

const route = useRoute(), router = useRouter(), app = useAppStore()
const checking = ref(false), feedback = ref('')
const targetPath = computed(() => internalRedirect(route.query.redirect))
const targetTitle = computed(() => String(router.resolve(targetPath.value).meta.title || '此功能'))
let sequence = 0
onBeforeUnmount(() => { ++sequence })
async function retryAccess() {
  if (checking.value) return
  const owner = app.authenticatedUser?.id, current = ++sequence, originalRoute = route.fullPath, target = targetPath.value
  checking.value = true; feedback.value = ''
  try {
    await app.refreshProfile()
    if (current !== sequence || route.fullPath !== originalRoute || owner !== app.authenticatedUser?.id) return
    if (isRouteAllowed(router.resolve(target), app)) await router.replace(target)
    else feedback.value = '已核对最新权限，当前账号仍无法访问此功能。可返回工作台，或联系管理员核对岗位权限。'
  } catch (error) {
    if (current === sequence && route.fullPath === originalRoute && owner === app.authenticatedUser?.id) feedback.value = `权限信息未能读取。${userFacingError(error)}`
  } finally { if (current === sequence) checking.value = false }
}
</script>

<template>
  <section class="access-denied" role="status">
    <h1>当前账号无权访问此页面</h1>
    <p>「{{ targetTitle }}」需要相应岗位权限。可从左侧菜单进入当前账号有权限的功能。</p>
    <el-alert v-if="feedback" :title="feedback" type="warning" :closable="false" />
    <div class="actions">
      <el-button type="primary" @click="router.replace('/dashboard')">返回工作台</el-button>
      <el-button :loading="checking" @click="retryAccess">重新核对权限</el-button>
    </div>
  </section>
</template>

<style scoped>
.access-denied { padding: 40px; }
.access-denied p { margin: 16px 0; }
.actions { margin-top: 16px; display: flex; gap: 12px; flex-wrap: wrap; }
</style>
