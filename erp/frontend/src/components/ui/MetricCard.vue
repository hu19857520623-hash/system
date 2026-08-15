<script setup lang="ts">
withDefaults(
  defineProps<{
    value: string
    label: string
    tone?: string
    index?: number
  }>(),
  { tone: '', index: 0 },
)
</script>

<template>
  <article class="metric-card" :class="tone" :style="{ '--delay': `${index * 60}ms` }">
    <div class="metric-topline">
      <span class="metric-label">{{ label }}</span>
      <span class="metric-status" aria-hidden="true"></span>
    </div>
    <strong class="metric-value">{{ value }}</strong>
    <div class="metric-foot">
      <span>实时业务数据</span>
      <svg viewBox="0 0 84 22" aria-hidden="true">
        <path d="M1 17C11 17 12 9 22 11s11 7 21 3 11-11 21-8 10 8 19 2" />
      </svg>
    </div>
  </article>
</template>

<style scoped>
.metric-card {
  min-height: 142px;
  padding: 20px;
  position: relative;
  overflow: hidden;
  border: 1px solid var(--bw-border);
  border-radius: 16px;
  background: var(--bw-card);
  box-shadow: var(--bw-shadow);
  animation: metric-in 0.42s var(--delay) both;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}
.metric-card:hover {
  transform: translateY(-2px);
  border-color: var(--bw-border-strong);
  box-shadow: var(--bw-shadow-hover);
}
.metric-card::after {
  content: '';
  position: absolute;
  width: 88px;
  height: 88px;
  right: -42px;
  bottom: -46px;
  border: 1px solid var(--bw-border);
  border-radius: 50%;
  opacity: 0.55;
}
.metric-topline,
.metric-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.metric-label {
  color: var(--bw-muted);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.metric-status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--bw-ink);
}
.metric-value {
  display: block;
  margin-top: 15px;
  color: var(--bw-ink);
  font: 700 32px/1.1 var(--font-mono);
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
}
.metric-foot {
  margin-top: 15px;
  color: var(--bw-muted);
  font-size: 10px;
}
.metric-foot svg {
  width: 74px;
  height: 20px;
  overflow: visible;
}
.metric-foot path {
  fill: none;
  stroke: var(--bw-ink);
  stroke-width: 1.5;
  opacity: 0.35;
}
.metric-card.warn {
  background: var(--bw-card-warn);
  border-color: var(--bw-border-strong);
}
.metric-card.warn .metric-status {
  background: var(--bw-ink);
  outline: 2px solid var(--bw-muted);
  outline-offset: 2px;
}
.metric-card.warn .metric-foot path {
  stroke: var(--bw-ink);
  opacity: 0.55;
}
@keyframes metric-in {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .metric-card {
    animation: none;
  }
}
</style>
