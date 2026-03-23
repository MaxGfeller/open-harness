<script setup lang="ts">
import { OpenHarnessProvider } from "@openharness/vue";
import ChatView from "~/components/ChatView.vue";
</script>

<template>
  <OpenHarnessProvider>
    <main
      :style="{
        maxWidth: '720px',
        margin: '0 auto',
        padding: '2rem 1rem',
        boxSizing: 'border-box',
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
      }"
    >
      <h1 :style="{ fontSize: '1.25rem', marginBottom: '1rem', flex: '0 0 auto' }">
        OpenHarness Demo (Nuxt)
      </h1>
      <ChatView />
    </main>
  </OpenHarnessProvider>
</template>

<style>
body {
  margin: 0;
  font-family: system-ui, sans-serif;
}
</style>
