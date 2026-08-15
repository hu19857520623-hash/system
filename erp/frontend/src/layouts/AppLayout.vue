<script setup lang="ts">
import { ref } from 'vue'
import AppSidebar from './AppSidebar.vue'
import AppTopbar from './AppTopbar.vue'

const sidebarOpen = ref(false)
</script>

<template>
  <div class="app-layout">
    <AppSidebar :open="sidebarOpen" @close="sidebarOpen = false" />
    <button
      class="mobile-sidebar-backdrop"
      :class="{ 'is-open': sidebarOpen }"
      type="button"
      aria-label="关闭导航菜单"
      @click="sidebarOpen = false"
    />
    <div class="main-area">
      <AppTopbar @toggle-sidebar="sidebarOpen = !sidebarOpen" />
      <div class="page-content">
        <RouterView />
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  min-height: 100vh;
  width: 100%;
}
</style>
