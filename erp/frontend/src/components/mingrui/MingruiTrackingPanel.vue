<script setup lang="ts">
import { computed } from 'vue'
import { Location, Document, Van, Ship, Position, Refresh, CircleCheck, Tickets } from '@element-plus/icons-vue'
import {
  buildMilestones,
  buildTimelineEntries,
  pickTrackingId,
  type MingruiTrackingNode,
} from '@/features/mingrui/trackingTimeline'

const props = defineProps<{
  shipment: Record<string, any> | null
}>()

const STEP_ICONS = [Document, Van, Ship, Position, Refresh, CircleCheck]

const nodes = computed(() => {
  const list = props.shipment?.trackingNodes || props.shipment?.logisticsInfo?.trackingNodes || []
  return (Array.isArray(list) ? list : []) as MingruiTrackingNode[]
})

const milestones = computed(() => buildMilestones(nodes.value))

const timelineEntries = computed(() =>
  buildTimelineEntries(nodes.value, {
    jobNum: props.shipment?.mingruiOrderNo || undefined,
    trackingId: pickTrackingId(props.shipment) || undefined,
    expressTracking: props.shipment?.trackingRef || props.shipment?.blNo || undefined,
  }),
)

const activeStepIndex = computed(() => {
  let last = -1
  milestones.value.forEach((m, idx) => {
    if (m.reached) last = idx
  })
  return last
})
</script>

<template>
  <div class="mingrui-tracking">
    <div v-if="milestones.length" class="stepper-wrap">
      <div class="stepper">
        <div
          v-for="(step, idx) in milestones"
          :key="step.key"
          class="stepper-item"
          :class="{ reached: step.reached, active: idx === activeStepIndex }"
        >
          <div v-if="idx > 0" class="stepper-line" :class="{ reached: step.reached }" />
          <div class="stepper-icon">
            <el-icon :size="22">
              <component :is="STEP_ICONS[idx] || Document" />
            </el-icon>
          </div>
          <div class="stepper-label">{{ step.label }}</div>
          <div class="stepper-date">{{ step.date || '—' }}</div>
        </div>
      </div>
    </div>

    <div class="timeline-panel">
      <div class="timeline-head">
        <el-icon :size="16"><Location /></el-icon>
        <span>订单轨迹</span>
      </div>

      <div v-if="timelineEntries.length" class="timeline-body">
        <div v-for="entry in timelineEntries" :key="entry.key" class="timeline-row">
          <div class="timeline-axis">
            <span class="timeline-dot" :class="{ info: entry.key === 'order-info' }">
              <el-icon v-if="entry.key === 'order-info'" :size="14"><Tickets /></el-icon>
            </span>
            <span class="timeline-stem" />
          </div>
          <div class="timeline-content">
            <div class="timeline-title-row">
              <strong>{{ entry.title }}</strong>
              <span v-if="entry.dateLabel" class="timeline-date">{{ entry.dateLabel }}</span>
            </div>
            <p v-if="entry.description" class="timeline-desc">{{ entry.description }}</p>
          </div>
        </div>
      </div>
      <el-empty v-else description="同步物流信息后将展示订单轨迹" :image-size="56" />
    </div>
  </div>
</template>

<style scoped>
.mingrui-tracking {
  margin-top: 16px;
}

.stepper-wrap {
  overflow-x: auto;
  margin-bottom: 16px;
  padding-bottom: 4px;
}

.stepper {
  display: flex;
  align-items: flex-start;
  min-width: 640px;
  padding: 8px 4px 0;
}

.stepper-item {
  position: relative;
  flex: 1;
  min-width: 96px;
  text-align: center;
}

.stepper-line {
  position: absolute;
  top: 18px;
  right: 50%;
  left: -50%;
  height: 0;
  border-top: 2px dotted #cbd5e1;
  z-index: 0;
}

.stepper-line.reached {
  border-top-color: #22c55e;
}

.stepper-icon {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin: 0 auto 8px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #f8fafc;
  color: #64748b;
}

.stepper-item.reached .stepper-icon {
  border-color: #86efac;
  background: #ecfdf5;
  color: #16a34a;
}

.stepper-item.active .stepper-icon {
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.18);
}

.stepper-label {
  font-size: 12px;
  font-weight: 600;
  color: #334155;
  line-height: 1.35;
  padding: 0 4px;
}

.stepper-item.reached .stepper-label {
  color: #15803d;
}

.stepper-date {
  margin-top: 4px;
  font-size: 11px;
  color: #64748b;
  font-variant-numeric: tabular-nums;
}

.timeline-panel {
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 12px;
  background: var(--panel-solid, #fff);
  overflow: hidden;
}

.timeline-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border, #e2e8f0);
  font-size: 14px;
  font-weight: 600;
  color: #334155;
}

.timeline-body {
  padding: 14px 14px 8px;
}

.timeline-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 10px;
}

.timeline-row:last-child .timeline-stem {
  display: none;
}

.timeline-axis {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.timeline-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: #ecfdf5;
  color: #16a34a;
  border: 1px solid #bbf7d0;
  flex-shrink: 0;
}

.timeline-dot.info {
  background: #eff6ff;
  color: #2563eb;
  border-color: #bfdbfe;
}

.timeline-stem {
  flex: 1;
  width: 2px;
  min-height: 24px;
  margin: 4px 0;
  background: #e2e8f0;
}

.timeline-content {
  padding-bottom: 18px;
}

.timeline-title-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.timeline-title-row strong {
  font-size: 14px;
  color: #0f172a;
}

.timeline-date {
  font-size: 12px;
  color: #64748b;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.timeline-desc {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.55;
  color: #64748b;
  word-break: break-word;
}
</style>
