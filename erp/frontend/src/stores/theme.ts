import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'theme'

function readStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // ignore
  }
  return 'light'
}

function applyThemeClass(theme: ThemeMode) {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // ignore
  }
}

export const useThemeStore = defineStore('theme', () => {
  const theme = ref<ThemeMode>(readStoredTheme())

  const isDark = computed(() => theme.value === 'dark')
  const nextLabel = computed(() => (theme.value === 'dark' ? '切换亮色' : '切换深色'))

  function init() {
    theme.value = readStoredTheme()
    applyThemeClass(theme.value)
  }

  function setTheme(next: ThemeMode) {
    theme.value = next
    applyThemeClass(next)
  }

  function toggleTheme() {
    setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  return { theme, isDark, nextLabel, init, setTheme, toggleTheme }
})
