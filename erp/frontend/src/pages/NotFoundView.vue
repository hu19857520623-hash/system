<script setup lang="ts">
import { useRouter } from 'vue-router'
const router = useRouter()
</script>

<template>
  <section class="not-found" role="status">
    <h1>未找到该页面</h1>
    <p>页面地址可能已变更，请返回工作台后从菜单重新进入。</p>
    <el-button type="primary" @click="router.push('/dashboard')">返回工作台</el-button>
  </section>
</template>

<style scoped>
.not-found { padding: 40px; }
.not-found p { margin: 16px 0; }
</style>
