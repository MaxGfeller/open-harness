<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import { useOpenHarness, useSubagentStatus, useSessionStatus } from "@openharness/vue";
import type { OHUIMessage } from "@openharness/core";
import StatusBar from "./StatusBar.vue";
import MessageBubble from "./MessageBubble.vue";

const chat = useOpenHarness({ endpoint: "/api/chat" });
const subagent = useSubagentStatus();
const session = useSessionStatus();

const input = ref("");
const scrollRef = ref<HTMLDivElement | null>(null);

const isStreaming = ref(false);
watch(
  () => chat.status,
  (status) => {
    isStreaming.value = status === "streaming" || status === "submitted";
  },
);

// Auto-scroll on new content
watch(
  () => chat.messages,
  async () => {
    await nextTick();
    scrollRef.value?.scrollTo({
      top: scrollRef.value.scrollHeight,
      behavior: "smooth",
    });
  },
  { deep: true },
);

function handleSubmit() {
  const text = input.value.trim();
  if (!text || isStreaming.value) return;
  input.value = "";
  chat.sendMessage({ text });
}
</script>

<template>
  <div :style="{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }">
    <StatusBar
      :subagent="subagent"
      :session="session"
      :is-streaming="isStreaming"
    />

    <!-- Messages -->
    <div
      ref="scrollRef"
      :style="{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        paddingBottom: '1rem',
      }"
    >
      <p
        v-if="chat.messages.length === 0"
        :style="{ color: '#888', textAlign: 'center', marginTop: '4rem' }"
      >
        Send a message to get started.
      </p>
      <MessageBubble
        v-for="msg in (chat.messages as OHUIMessage[])"
        :key="msg.id"
        :message="msg"
      />
    </div>

    <!-- Input -->
    <form
      :style="{
        flex: '0 0 auto',
        display: 'flex',
        gap: '0.5rem',
        borderTop: '1px solid #eee',
        paddingTop: '0.75rem',
      }"
      @submit.prevent="handleSubmit"
    >
      <input
        v-model="input"
        type="text"
        placeholder="Type a message..."
        :style="{
          flex: 1,
          padding: '0.5rem 0.75rem',
          border: '1px solid #ccc',
          borderRadius: '6px',
          fontSize: '0.95rem',
          outline: 'none',
        }"
      />
      <button
        v-if="isStreaming"
        type="button"
        :style="{
          padding: '0.5rem 1rem',
          borderRadius: '6px',
          border: '1px solid #e55',
          background: '#fee',
          color: '#c33',
          cursor: 'pointer',
          fontSize: '0.95rem',
        }"
        @click="chat.stop()"
      >
        Stop
      </button>
      <button
        v-else
        type="submit"
        :disabled="!input.trim()"
        :style="{
          padding: '0.5rem 1rem',
          borderRadius: '6px',
          border: 'none',
          background: input.trim() ? '#333' : '#ccc',
          color: '#fff',
          cursor: input.trim() ? 'pointer' : 'default',
          fontSize: '0.95rem',
        }"
      >
        Send
      </button>
    </form>
  </div>
</template>
