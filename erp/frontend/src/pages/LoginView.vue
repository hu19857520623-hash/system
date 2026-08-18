<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { User, Lock } from '@element-plus/icons-vue'
import { useAppStore } from '@/stores/app'
import { authApi } from '@/api/client.js'
import ThemeToggle from '@/components/ThemeToggle.vue'

const router = useRouter()
const route = useRoute()
const app = useAppStore()

const username = ref('')
const password = ref('')
const remember = ref(true)
const loading = ref(false)
const backendOnline = ref<boolean | null>(null)

onMounted(async () => {
  const saved = localStorage.getItem('login_username')
  if (saved) username.value = saved
  try {
    await authApi.health()
    backendOnline.value = true
  } catch {
    backendOnline.value = false
  }
})

async function handleSubmit() {
  const u = username.value.trim()
  const p = password.value
  if (!u) {
    ElMessage.warning('请输入登录名')
    return
  }
  if (!p) {
    ElMessage.warning('请输入密码')
    return
  }

  loading.value = true
  try {
    await app.login(u, p)
    if (remember.value) localStorage.setItem('login_username', u)
    else localStorage.removeItem('login_username')
    const redirect = (route.query.redirect as string) || '/dashboard'
    router.replace(redirect)
    ElMessage.success(`欢迎回来，${app.currentAccount.name}`)
  } catch (e: any) {
    ElMessage.error(e.message || '登录失败，请检查账号密码')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-theme-toggle">
      <ThemeToggle compact />
    </div>
    <aside class="login-brand">
      <div class="brand-inner">
        <div class="brand-mark">
          <div class="brand-icon">TK</div>
          <div>
            <h1>Takealot ERP</h1>
            <p>南非海外仓 · 经营系统</p>
          </div>
        </div>

        <div class="brand-copy">
          <h2>从选品到结算<br />一条链路管全局</h2>
          <p class="brand-desc">
            产品开发、采购入库、货盘定价、库存同步与客户结算，统一在一个工作台完成。
          </p>
        </div>

        <ul class="brand-features">
          <li>
            <span class="feat-dot"></span>
            <span>选品核定计划量 → 采购实际成本同步 → 中转仓收货发运</span>
          </li>
          <li>
            <span class="feat-dot"></span>
            <span>海运费回传 → 货盘定价 → OMS 同步</span>
          </li>
          <li>
            <span class="feat-dot"></span>
            <span>多角色权限 · JHB 仓运营视图</span>
          </li>
        </ul>

        <div class="brand-footer">
          <span>Takealot · JHB 仓</span>
          <span class="sep">·</span>
          <span>ERP v0.1</span>
        </div>
      </div>
    </aside>

    <main class="login-main">
      <div class="login-card">
        <div class="login-card-head">
          <h3>登录系统</h3>
          <p>使用您的账号密码进入工作台</p>
        </div>

        <el-alert
          v-if="backendOnline === false"
          type="error"
          :closable="false"
          show-icon
          title="ERP 后端未启动（127.0.0.1:3000）"
          description="请运行仓库根目录 dev-local.ps1，或单独启动 erp/backend。"
          style="margin-bottom: 16px"
        />

        <el-form label-position="top" @submit.prevent="handleSubmit">
          <el-form-item label="登录名">
            <el-input
              v-model="username"
              placeholder="如 admin、zhaomin"
              size="large"
              :prefix-icon="User"
              autocomplete="username"
              @keyup.enter="handleSubmit"
            />
          </el-form-item>
          <el-form-item label="密码">
            <el-input
              v-model="password"
              type="password"
              placeholder="请输入密码"
              size="large"
              show-password
              :prefix-icon="Lock"
              autocomplete="current-password"
              @keyup.enter="handleSubmit"
            />
          </el-form-item>

          <div class="login-options">
            <el-checkbox v-model="remember">记住登录名</el-checkbox>
          </div>

          <el-button
            type="primary"
            size="large"
            class="login-btn"
            :loading="loading"
            @click="handleSubmit"
          >
            登录
          </el-button>
        </el-form>

        <div class="login-hint">
          <span class="hint-label">演示账号</span>
          <div class="hint-accounts">
            <span>admin</span>
            <span>zhaomin</span>
            <span>liuyang</span>
            <span>sunhao</span>
          </div>
          <span class="hint-pwd">密码请向管理员获取</span>
        </div>
      </div>
    </main>
  </div>
</template>

<style lang="scss" scoped>
@use '@/styles/variables' as *;

.login-theme-toggle {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 5;
}
.login-page {
  position: relative;
  display: flex;
  overflow: hidden;
  min-height: 100vh;
  width: 100%;
  background:
    radial-gradient(circle at 8% 12%, var(--mesh-1), transparent 30%),
    radial-gradient(circle at 92% 85%, var(--mesh-2), transparent 27%),
    var(--canvas);
}
.login-page::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(rgba(99, 102, 241, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(99, 102, 241, 0.035) 1px, transparent 1px);
  background-size: 58px 58px;
  mask-image: linear-gradient(90deg, black, transparent 75%);
}
.login-brand {
  width: 48%;
  min-width: 320px;
  max-width: 700px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  background: linear-gradient(145deg, #0a0919, #0f0e2a);
  border-right: 1px solid rgba(99, 102, 241, 0.18);
  box-shadow: 18px 0 70px rgba(0, 0, 0, 0.28);
}
.login-brand::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse 80% 60% at 20% 8%, rgba(99, 102, 241, 0.2), transparent 55%),
    radial-gradient(ellipse 70% 52% at 88% 90%, rgba(6, 182, 212, 0.1), transparent 52%);
}
.brand-inner {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 44px 46px 32px;
}
.brand-mark { display: flex; align-items: center; gap: 12px; }
.brand-icon {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  color: white;
  background: linear-gradient(145deg, #6366f1, #8b5cf6);
  box-shadow: 0 8px 24px rgba(99, 102, 241, 0.3);
  font-family: $font-display;
  font-weight: 800;
  font-size: 14px;
}
.brand-mark h1 {
  color: #f8fafc;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.015em;
  font-family: $font-display;
}
.brand-mark p { color: #718096; font-size: 12px; margin-top: 2px; }
.brand-copy { margin-top: clamp(52px, 10vh, 94px); }
.brand-copy h2 {
  max-width: 460px;
  color: #f8fafc;
  font-family: $font-display;
  font-size: clamp(30px, 4vw, 44px);
  font-weight: 700;
  line-height: 1.18;
  letter-spacing: -0.045em;
  background: linear-gradient(100deg, #f8fafc 10%, #a5b4fc 56%, #67e8f9);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.brand-desc { margin-top: 16px; max-width: 430px; color: #94a3b8; font-size: 14px; line-height: 1.65; }
.brand-features {
  list-style: none;
  margin-top: 36px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  li {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    color: #a5b4c8;
    font-size: 13px;
    line-height: 1.5;
  }
}
.feat-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #06b6d4;
  margin-top: 7px;
  flex-shrink: 0;
  box-shadow: 0 0 12px rgba(6, 182, 212, 0.65);
}
.brand-footer {
  margin-top: auto;
  padding-top: 24px;
  font-size: 11px;
  color: #526079;
  display: flex;
  align-items: center;
  gap: 6px;
  .sep { opacity: 0.5; }
}
.login-main {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  background: transparent;
}
.login-card {
  width: 100%;
  max-width: 430px;
  padding: 36px;
  background: linear-gradient(145deg, #121130, #0a0919);
  border: 1px solid rgba(99, 102, 241, 0.22);
  border-radius: 20px;
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.025);
  &:hover {
    border-color: rgba(99, 102, 241, 0.34);
    box-shadow: 0 32px 90px rgba(0, 0, 0, 0.4), 0 0 48px rgba(99, 102, 241, 0.06);
  }
}
.login-card-head {
  margin-bottom: 28px;
  h3 { color: #f1f5f9; font-size: 24px; font-weight: 600; letter-spacing: -0.01em; }
  p { margin-top: 6px; color: #718096; font-size: 13px; }
}
.login-options {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.login-btn { width: 100%; height: 42px; font-size: 14px; font-weight: 600; letter-spacing: 0.02em; }
.login-hint {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid rgba(99, 102, 241, 0.14);
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}
.hint-label {
  font-size: 11px;
  font-weight: 600;
  color: #718096;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.hint-accounts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  span {
    font-family: $font-mono;
    font-size: 11px;
    color: #a5b4fc;
    background: rgba(99, 102, 241, 0.09);
    border: 1px solid rgba(99, 102, 241, 0.18);
    border-radius: 8px;
    padding: 3px 8px;
  }
}
.hint-pwd { font-size: 11px; color: #58657b; }
:deep(.el-form-item__label) { font-size: 13px; color: #a5b4c8; font-weight: 500; padding-bottom: 4px; }
:deep(.el-input__wrapper) {
  background: #080818 !important;
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.22) inset !important;
  border-radius: 11px;
  padding: 4px 12px;
}
:deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.55) inset !important;
}
:deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px #6366f1 inset, 0 0 0 3px rgba(99, 102, 241, 0.16) !important;
}
:deep(.el-input__inner),
:deep(.el-input__wrapper input) {
  color: #e2e8f0 !important;
  background: transparent !important;
  -webkit-text-fill-color: #e2e8f0;
  caret-color: #e2e8f0;
}
:deep(.el-input__inner::placeholder),
:deep(.el-input__wrapper input::placeholder) {
  color: #64748b !important;
  -webkit-text-fill-color: #64748b;
}
:deep(.el-input__prefix),
:deep(.el-input__suffix),
:deep(.el-input__password) {
  color: #94a3b8 !important;
}
:deep(.el-input__inner:-webkit-autofill),
:deep(.el-input__inner:-webkit-autofill:hover),
:deep(.el-input__inner:-webkit-autofill:focus),
:deep(.el-input__wrapper input:-webkit-autofill),
:deep(.el-input__wrapper input:-webkit-autofill:hover),
:deep(.el-input__wrapper input:-webkit-autofill:focus) {
  -webkit-text-fill-color: #e2e8f0 !important;
  caret-color: #e2e8f0;
  transition: background-color 99999s ease-out;
  box-shadow: 0 0 0 1000px rgba(8, 8, 24, 0.96) inset !important;
}
:deep(.el-checkbox__label) { color: #94a3b8; }
:deep(.el-button--primary) {
  --el-button-bg-color: #6366f1;
  --el-button-border-color: #6366f1;
  --el-button-hover-bg-color: #4f46e5;
  --el-button-hover-border-color: #818cf8;
  box-shadow: 0 10px 26px rgba(99, 102, 241, 0.28);
}
@media (max-width: 840px) {
  .login-page { flex-direction: column; }
  .login-brand { width: 100%; max-width: none; min-height: auto; }
  .brand-inner { padding: 28px 24px 24px; }
  .brand-copy { margin-top: 30px; }
  .brand-copy h2 { font-size: 27px; }
  .brand-features { display: none; }
  .login-main { padding: 28px 18px 36px; }
}
</style>