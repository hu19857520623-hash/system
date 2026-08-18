<script setup lang="ts">
defineProps<{
  kicker?: string
  title?: string
  subtitle?: string
}>()
</script>

<template>
  <div class="erp-detail">
    <header v-if="kicker || title || subtitle || $slots.status || $slots.header" class="erp-detail__mast">
      <slot name="header">
        <div class="erp-detail__identity">
          <p v-if="kicker" class="erp-detail__kicker">{{ kicker }}</p>
          <h2 v-if="title" class="erp-detail__title">{{ title }}</h2>
          <p v-if="subtitle" class="erp-detail__subtitle">{{ subtitle }}</p>
        </div>
        <div v-if="$slots.status" class="erp-detail__aside">
          <slot name="status" />
        </div>
      </slot>
    </header>
    <div v-if="$slots.metrics" class="erp-detail__metrics">
      <slot name="metrics" />
    </div>
    <slot />
  </div>
</template>
