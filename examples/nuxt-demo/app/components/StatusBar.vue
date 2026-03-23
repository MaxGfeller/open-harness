<script setup lang="ts">
import type { ComputedRef } from "vue";
import type { UseSubagentStatusResult, SessionState } from "@openharness/vue";

defineProps<{
  subagent: ComputedRef<UseSubagentStatusResult>;
  session: ComputedRef<SessionState>;
  isStreaming: boolean;
}>();
</script>

<template>
  <div
    v-if="isStreaming || subagent.hasActiveSubagents || session.isCompacting || session.isRetrying"
    :style="{
      display: 'flex',
      flexWrap: 'wrap',
      gap: '0.5rem',
      marginBottom: '0.75rem',
      fontSize: '0.8rem',
    }"
  >
    <span v-if="isStreaming" class="pill" :style="{ '--pill-color': '#3b82f6' } as any">
      <span class="pill-dot" />
      Streaming...
    </span>

    <span
      v-for="a in subagent.activeSubagents"
      :key="a.name"
      class="pill"
      :style="{ '--pill-color': '#8b5cf6' } as any"
    >
      <span class="pill-dot" />
      {{ a.name }}: {{ a.task }}
    </span>

    <span
      v-if="session.isCompacting"
      class="pill"
      :style="{ '--pill-color': '#f59e0b' } as any"
    >
      <span class="pill-dot" />
      Compacting history...
    </span>

    <span
      v-if="session.isRetrying"
      class="pill"
      :style="{ '--pill-color': '#ef4444' } as any"
    >
      <span class="pill-dot" />
      Retrying (attempt {{ session.retryAttempt }})
      <template v-if="session.retryReason">: {{ session.retryReason }}</template>
    </span>
  </div>
</template>

<style scoped>
.pill {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--pill-color) 8%, transparent);
  color: var(--pill-color);
  font-weight: 500;
}

.pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--pill-color);
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
