<script setup lang="ts">
import { useAppStore } from '@/stores/app'
import { useRoute, useRouter } from 'vue-router'
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { erpAlert } from '@/utils/messageBox'
import { useNotifications } from '@/composables/useNotifications'
import ThemeToggle from '@/components/ThemeToggle.vue'

const app = useAppStore()
const emit = defineEmits<{ toggleSidebar: [] }>()
const route = useRoute()
const router = useRouter()
const { visibleItems, badgeCount, loading, loadNotifications } = useNotifications()

const notifyOpen = ref(false)
const userMenuOpen = ref(false)

const section = computed(() => (route.meta?.section as string) || 'ERP')
const title = computed(() => (route.meta?.title as string) || '工作台')

const userInitial = computed(() => app.currentAccount.name.charAt(0) || '?')
const userLogin = computed(() => app.authenticatedUser?.username || app.currentAccount.login)

function handleLogout() {
  app.logout()
  userMenuOpen.value = false
  router.push('/login')
}

function closeAll() {
  notifyOpen.value = false
  userMenuOpen.value = false
}

async function toggleNotify() {
  notifyOpen.value = !notifyOpen.value
  userMenuOpen.value = false
  if (notifyOpen.value) await loadNotifications()
}

function toggleUserMenu() {
  userMenuOpen.value = !userMenuOpen.value
  notifyOpen.value = false
}

function goNotify(item: { route: string }) {
  router.push(item.route)
  closeAll()
}

function openHelp() {
  erpAlert(
    '获客：线索池领取 → 待跟进写跟进 → 成交管理上传资料并转 ERP。仓储：到仓扫描 → 入库收货 → 上架 → 出库。财务：客户充值、结算与海运账单。',
    '操作指引',
    { confirmButtonText: '知道了' },
  )
}

const topbarRef = ref<HTMLElement | null>(null)
function handleClickOutside(e: MouseEvent) {
  if (topbarRef.value && !topbarRef.value.contains(e.target as Node)) {
    closeAll()
  }
}

let refreshTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  loadNotifications()
  refreshTimer = setInterval(loadNotifications, 60_000)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
  if (refreshTimer) clearInterval(refreshTimer)
})
</script>

<template>
  <header class="topbar" ref="topbarRef">
    <button class="topbar-btn mobile-menu-btn" type="button" aria-label="打开导航菜单" @click="emit('toggleSidebar')">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M4 6h16M4 12h16M4 18h16"/>
      </svg>
    </button>
    <div class="breadcrumb">
      <span>ERP</span>
      <span>/</span>
      <span>{{ section }}</span>
      <span>/</span>
      <strong>{{ title }}</strong>
    </div>
    <div class="topbar-spacer"></div>
    <span class="topbar-ctx-tag">Takealot · JHB 仓</span>
    <ThemeToggle compact />

    <!-- Notifications -->
    <div class="topbar-dropdown-wrap">
      <button
        class="topbar-btn notify-btn"
        :class="{ 'has-unread': badgeCount }"
        aria-label="消息通知"
        @click.stop="toggleNotify"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <span v-if="badgeCount" class="notify-dot">{{ badgeCount }}</span>
      </button>
      <Transition name="dropdown">
        <div v-if="notifyOpen" class="topbar-dropdown-panel notify-panel" @click.stop>
          <div class="topbar-dropdown-head notify-head">
            <span>消息通知</span>
            <span v-if="badgeCount" class="notify-head-count">{{ badgeCount }} 条待办</span>
          </div>

          <div v-if="loading && !visibleItems.length" class="notify-empty">加载中…</div>
          <div v-else-if="!visibleItems.length" class="notify-empty">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            <p>暂无待办消息</p>
          </div>

          <div v-else class="notify-list">
            <button
              v-for="item in visibleItems"
              :key="item.key"
              type="button"
              class="notify-item"
              @click="goNotify(item)"
            >
              <span class="notify-item-dot" :class="`tone-${item.tone}`"></span>
              <span class="notify-item-body">
                <span class="notify-item-title">{{ item.title }}</span>
                <span class="notify-item-desc">点击查看并处理</span>
              </span>
              <span class="notify-item-badge" :class="item.tone === 'err' ? 'badge-err' : ''">{{ item.count }} 条</span>
            </button>
          </div>

          <div class="notify-footer">
            <button type="button" class="notify-footer-btn" @click="router.push('/dashboard'); closeAll()">前往工作台</button>
          </div>
        </div>
      </Transition>
    </div>

    <!-- User menu -->
    <div class="topbar-dropdown-wrap">
      <button
        class="user-trigger"
        :class="{ 'is-open': userMenuOpen }"
        @click.stop="toggleUserMenu"
      >
        <span class="user-trigger-avatar">{{ userInitial }}</span>
        <span class="user-trigger-info">
          <span class="user-trigger-name">{{ app.currentAccount.name }}</span>
          <span class="user-trigger-role">{{ app.currentAccount.role }}</span>
        </span>
        <svg class="user-trigger-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <Transition name="dropdown">
        <div v-if="userMenuOpen" class="topbar-dropdown-panel user-menu-panel" @click.stop>
          <div class="user-menu-profile">
            <div class="user-menu-avatar">{{ userInitial }}</div>
            <div class="user-menu-meta">
              <div class="user-menu-name">{{ app.currentAccount.name }}</div>
              <div class="user-menu-login">@{{ userLogin }}</div>
              <span class="user-menu-role">{{ app.currentAccount.role }}</span>
            </div>
          </div>

          <div class="user-menu-actions">
            <button type="button" class="user-menu-item" @click="router.push('/settings/profile'); closeAll()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
              <span>个人设置</span>
            </button>
            <button
              v-if="app.canViewScreen('permissions')"
              type="button"
              class="user-menu-item"
              @click="router.push('/permissions'); closeAll()"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <span>权限管理</span>
            </button>
            <div class="user-menu-divider"></div>
            <button type="button" class="user-menu-item user-menu-item--danger" @click="handleLogout">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
              <span>退出登录</span>
            </button>
          </div>
        </div>
      </Transition>
    </div>

    <button class="topbar-btn" @click="openHelp">帮助</button>
  </header>
</template>

<style scoped>
.topbar-dropdown-wrap { position: relative; }
.topbar-dropdown-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 200;
  min-width: 220px;
  padding: 6px 0;
  color: var(--text-secondary);
  background: var(--panel-gradient);
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  box-shadow: var(--shadow-panel);
  backdrop-filter: blur(22px);
}
.notify-panel { min-width: 300px; padding: 0; overflow: hidden; }
.notify-btn.has-unread { border-color: rgba(245, 158, 11, 0.35); }
.notify-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px 10px;
  border-bottom: 1px solid rgba(99, 102, 241, 0.14);
}
.notify-head-count { font-size: 11px; font-weight: 500; color: #fbbf24; }
.notify-list { max-height: 320px; overflow-y: auto; padding: 4px 0; }
.notify-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease;
}
.notify-item:hover { background: rgba(99, 102, 241, 0.1); }
.notify-item-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.notify-item-dot.tone-warn { background: #f59e0b; }
.notify-item-dot.tone-err { background: #ef4444; }
.notify-item-dot.tone-info { background: #06b6d4; }
.notify-item-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.notify-item-title { font-size: 13px; font-weight: 500; color: var(--text); }
.notify-item-desc { font-size: 11px; color: var(--text-muted); }
.notify-item-badge { flex-shrink: 0; font-size: 11px; font-weight: 600; color: #fbbf24; }
.notify-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 16px;
  color: #718096;
  font-size: 13px;
}
.notify-empty svg { opacity: 0.45; }
.notify-empty p { margin: 0; }
.notify-footer { padding: 8px 10px 10px; border-top: 1px solid rgba(99, 102, 241, 0.14); }
.notify-footer-btn {
  width: 100%;
  padding: 8px 12px;
  border: none;
  border-radius: 8px;
  background: rgba(99, 102, 241, 0.1);
  font-size: 12px;
  color: #a5b4fc;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.notify-footer-btn:hover { color: white; background: rgba(99, 102, 241, 0.18); }
.topbar-dropdown-head {
  padding: 10px 14px 8px;
  font-size: 12px;
  font-weight: 600;
  color: #f1f5f9;
}
.badge-err { color: #f87171; }
.user-trigger {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px 4px 4px;
  color: var(--text-secondary);
  background: var(--control-bg);
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.user-trigger:hover,
.user-trigger.is-open {
  border-color: rgba(99, 102, 241, 0.46);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.16);
}
.user-trigger-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(145deg, #6366f1, #8b5cf6);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
  box-shadow: 0 6px 20px rgba(99, 102, 241, 0.28);
}
.user-trigger-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.25;
  min-width: 0;
}
.user-trigger-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  max-width: 88px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-trigger-role { font-size: 11px; color: var(--text-muted); }
.user-trigger-chevron { color: var(--text-muted); flex-shrink: 0; transition: transform 0.2s ease; }
.user-trigger.is-open .user-trigger-chevron { transform: rotate(180deg); }
.user-menu-panel { min-width: 260px; padding: 0; overflow: hidden; }
.user-menu-profile {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.14), rgba(6, 182, 212, 0.05));
  border-bottom: 1px solid var(--border);
}
.user-menu-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: linear-gradient(145deg, #6366f1, #8b5cf6);
  color: #fff;
  font-size: 18px;
  font-weight: 600;
  box-shadow: 0 6px 20px rgba(99, 102, 241, 0.28);
  flex-shrink: 0;
}
.user-menu-meta { min-width: 0; }
.user-menu-name { font-size: 15px; font-weight: 600; color: var(--text); line-height: 1.3; }
.user-menu-login { margin-top: 2px; font-size: 11px; color: var(--text-muted); }
.user-menu-role {
  display: inline-block;
  margin-top: 6px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--primary-bright);
  background: var(--hover-bg);
  border: 1px solid var(--border);
  border-radius: 999px;
}
.user-menu-actions { padding: 6px; }
.user-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease, color 0.15s ease;
}
.user-menu-item svg { flex-shrink: 0; color: var(--text-muted); transition: color 0.15s ease; }
.user-menu-item:hover { background: var(--hover-bg); color: var(--text); }
.user-menu-item:hover svg { color: var(--cyan); }
.user-menu-divider { height: 1px; margin: 4px 8px; background: var(--border); }
.user-menu-item--danger { color: #fca5a5; }
.user-menu-item--danger svg { color: #f87171; }
.user-menu-item--danger:hover { background: rgba(239, 68, 68, 0.1); color: #fecaca; }
.user-menu-item--danger:hover svg { color: #fecaca; }
.dropdown-enter-active,
.dropdown-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.dropdown-enter-from,
.dropdown-leave-to { opacity: 0; transform: translateY(-6px); }
@media (max-width: 768px) {
  .user-trigger-info,
  .user-trigger-chevron { display: none; }
  .user-trigger { padding: 4px; border-radius: 10px; }
  .notify-panel { min-width: 260px; }
}
@media (prefers-reduced-motion: reduce) {
  .dropdown-enter-active,
  .dropdown-leave-active { transition: none; }
}
</style>