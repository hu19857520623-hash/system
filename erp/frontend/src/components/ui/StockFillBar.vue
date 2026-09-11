<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  available: number
  locked?: number
  total: number
  showPercent?: boolean
}>(), {
  locked: 0,
  showPercent: true,
})

const parts = computed(() => {
  const total = Math.max(0, Number(props.total) || 0)
  const available = Math.max(0, Number(props.available) || 0)
  const locked = Math.max(0, Number(props.locked) || 0)
  const safeTotal = Math.max(total, available + locked)
  const availPct = safeTotal ? (available / safeTotal) * 100 : 0
  const lockPct = safeTotal ? (locked / safeTotal) * 100 : 0
  const readyPct = total ? (available / total) * 100 : 0
  return { availPct, lockPct, readyPct, total: safeTotal }
})
</script>

<template>
  <div
    class="stock-fill"
    :title="`可发 ${Number(available || 0).toLocaleString()} · 锁定 ${Number(locked || 0).toLocaleString()} · 在库 ${Number(total || 0).toLocaleString()}`"
  >
    <div class="stock-fill__track">
      <span class="stock-fill__seg is-avail" :style="{ width: `${parts.availPct}%` }" />
      <span class="stock-fill__seg is-lock" :style="{ width: `${parts.lockPct}%` }" />
    </div>
    <span v-if="showPercent" class="stock-fill__pct">{{ parts.total ? `${parts.readyPct.toFixed(0)}%` : '—' }}</span>
  </div>
</template>

<style scoped>
.stock-fill {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 108px;
}
.stock-fill__track {
  display: flex;
  flex: 1;
  height: 7px;
  overflow: hidden;
  border-radius: 99px;
  background: #e8eef8;
}
.stock-fill__seg {
  display: block;
  height: 100%;
  flex: 0 0 auto;
}
.stock-fill__seg.is-avail { background: #0f766e; }
.stock-fill__seg.is-lock { background: #d97706; }
.stock-fill__pct {
  flex-shrink: 0;
  width: 34px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
</style>
