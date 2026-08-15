<script setup lang="ts">
import { useThemeStore } from '@/stores/theme'

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const themeStore = useThemeStore()
</script>

<template>
  <button
    type="button"
    class="theme-toggle"
    :class="{ 'is-compact': compact }"
    :aria-label="themeStore.nextLabel"
    :title="themeStore.nextLabel"
    @click="themeStore.toggleTheme()"
  >
    <svg
      v-if="themeStore.isDark"
      class="theme-toggle-icon sun"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
    <svg
      v-else
      class="theme-toggle-icon moon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z" />
    </svg>
    <span v-if="!compact" class="theme-toggle-label">{{ themeStore.nextLabel }}</span>
  </button>
</template>

<style scoped>
.theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  min-width: 44px;
  padding: 8px 12px;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 12px;
  cursor: pointer;
  transition: color 0.18s ease, background 0.18s ease, border-color 0.18s ease;
  font-size: 13px;
  font-weight: 500;
}
.theme-toggle:hover {
  color: var(--text);
  background: var(--hover-bg);
  border-color: var(--border-subtle);
}
.theme-toggle.is-compact {
  min-width: 38px;
  min-height: 38px;
  padding: 7px 10px;
  border-radius: 11px;
  background: var(--control-bg);
  border-color: var(--border);
}
.theme-toggle.is-compact:hover {
  border-color: var(--border-strong);
  background: var(--hover-bg);
}
.theme-toggle-icon.sun { color: #f59e0b; }
.theme-toggle-icon.moon { color: var(--primary); }
.theme-toggle-label { white-space: nowrap; }
</style>
