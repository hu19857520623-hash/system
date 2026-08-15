<script setup lang="ts">
import { computed } from 'vue'

export type TrendPoint = {
  date: string
  receipts: number
  receivedQty: number
  damagedQty: number
}

const props = withDefaults(
  defineProps<{
    series: TrendPoint[]
    loading?: boolean
  }>(),
  { loading: false, series: () => [] },
)

const LEGEND = [
  { key: 'receipts' as const, label: '收货单', color: 'var(--bw-ink)' },
  { key: 'receivedQty' as const, label: '实收件数', color: 'var(--bw-mid)' },
  { key: 'damagedQty' as const, label: '残次件数', color: 'var(--bw-faint)' },
]

const width = 640
const height = 220
const pad = { top: 18, right: 16, bottom: 34, left: 36 }

const plotW = width - pad.left - pad.right
const plotH = height - pad.top - pad.bottom

const maxValue = computed(() => {
  const values = props.series.flatMap((p) => [p.receipts, p.receivedQty, p.damagedQty])
  return Math.max(1, ...values, 0)
})

function yAt(value: number) {
  return pad.top + plotH - (value / maxValue.value) * plotH
}

function xAt(index: number) {
  const count = Math.max(props.series.length - 1, 1)
  return pad.left + (index / count) * plotW
}

function linePath(key: keyof TrendPoint) {
  if (!props.series.length) return ''
  return props.series
    .map((point, index) => {
      const value = Number(point[key]) || 0
      const cmd = index === 0 ? 'M' : 'L'
      return `${cmd}${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`
    })
    .join(' ')
}
</script>

<template>
  <section class="trend-panel" aria-label="近 7 日中转仓收货趋势">
    <div class="trend-head">
      <div>
        <h4>近 7 日中转仓收货</h4>
        <p>收货单数、实收件数与残次件数按日汇总</p>
      </div>
      <ul class="trend-legend">
        <li v-for="item in LEGEND" :key="item.key">
          <span class="dot" :style="{ background: item.color }"></span>
          {{ item.label }}
        </li>
      </ul>
    </div>

    <div v-if="loading" class="trend-loading">加载趋势数据…</div>
    <div v-else-if="!series.length" class="trend-empty">暂无中转仓收货数据</div>
    <svg
      v-else
      class="trend-chart"
      :viewBox="`0 0 ${width} ${height}`"
      role="img"
      aria-label="中转仓收货趋势折线图"
    >
      <g class="grid">
        <line
          v-for="n in 4"
          :key="n"
          :x1="pad.left"
          :x2="width - pad.right"
          :y1="pad.top + ((n - 1) / 3) * plotH"
          :y2="pad.top + ((n - 1) / 3) * plotH"
        />
      </g>
      <g v-for="item in LEGEND" :key="item.key">
        <path
          :d="linePath(item.key)"
          :stroke="item.color"
          fill="none"
          stroke-width="2.2"
          stroke-linecap="round"
        />
        <circle
          v-for="(point, index) in series"
          :key="`${item.key}-${index}`"
          :cx="xAt(index)"
          :cy="yAt(Number(point[item.key]) || 0)"
          r="3.5"
          :fill="item.color"
        />
      </g>
      <g class="axis-labels">
        <text
          v-for="(point, index) in series"
          :key="point.date"
          :x="xAt(index)"
          :y="height - 10"
          text-anchor="middle"
        >
          {{ point.date }}
        </text>
      </g>
    </svg>
  </section>
</template>

<style scoped>
.trend-panel {
  padding: 20px 22px 18px;
  border: 1px solid var(--bw-border);
  border-radius: 16px;
  background: var(--bw-card);
  box-shadow: var(--bw-shadow);
}
.trend-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
.trend-head h4 {
  color: var(--bw-ink);
  font-size: 15px;
  font-weight: 650;
}
.trend-head p {
  margin-top: 4px;
  color: var(--bw-muted);
  font-size: 12px;
}
.trend-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  list-style: none;
  margin: 0;
  padding: 0;
  color: var(--bw-muted);
  font-size: 11px;
}
.trend-legend li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.trend-chart {
  width: 100%;
  height: auto;
  display: block;
}
.grid line {
  stroke: var(--bw-border);
  stroke-width: 1;
}
.axis-labels text {
  fill: var(--bw-muted);
  font-size: 11px;
}
.trend-loading,
.trend-empty {
  min-height: 180px;
  display: grid;
  place-items: center;
  color: var(--bw-muted);
  font-size: 13px;
}
@media (max-width: 720px) {
  .trend-head {
    flex-direction: column;
  }
}
</style>
