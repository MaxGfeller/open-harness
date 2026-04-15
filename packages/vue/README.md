# @openharness/vue

Vue 3 composables and provider for [OpenHarness](https://github.com/MaxGfeller/open-harness) AI SDK 5 chat UIs.

## Install

```bash
npm install @openharness/vue
```

Peer dependencies: `@openharness/core`, `@ai-sdk/vue`, `vue`

## Quick start

```vue
<script setup lang="ts">
import { OpenHarnessProvider, useOpenHarness, useSubagentStatus, useSessionStatus } from '@openharness/vue';
</script>

<template>
  <OpenHarnessProvider>
    <Chat />
  </OpenHarnessProvider>
</template>
```

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { useOpenHarness, useSubagentStatus, useSessionStatus } from '@openharness/vue';

const chat = useOpenHarness({ endpoint: '/api/chat' });
const subagent = useSubagentStatus();
const session = useSessionStatus();
const input = ref('');

function handleSubmit() {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  chat.sendMessage({ text });
}
</script>

<template>
  <div>
    <div v-for="msg in chat.messages" :key="msg.id">
      <template v-for="(part, i) in msg.parts" :key="i">
        <span v-if="part.type === 'text'">{{ part.text }}</span>
      </template>
    </div>
    <p v-if="subagent.hasActiveSubagents">Subagents working...</p>
    <form @submit.prevent="handleSubmit">
      <input v-model="input" placeholder="Type a message..." />
      <button type="submit">Send</button>
    </form>
  </div>
</template>
```

## API

### `<OpenHarnessProvider>`

Renderless component that provides shared subagent, session, and sandbox state to all child composables. Wrap your app or chat component with this.

### `useOpenHarness(config)`

Creates a chat session connected to your API endpoint. Returns an AI SDK 5 `Chat` instance with reactive properties (`messages`, `status`, `error`, `sendMessage`, `stop`, etc.), typed with `OHUIMessage`.

### `useSubagentStatus()`

Returns a computed ref deriving reactive state from `data-oh:subagent.*` stream events:

- `activeSubagents` -- currently running subagents
- `recentSubagents` -- all subagents seen in this session
- `hasActiveSubagents` -- boolean shorthand

### `useSessionStatus()`

Returns a computed ref tracking turn index, compaction state, and retry info from `data-oh:*` stream events.

### `useSandboxStatus()`

Returns a computed ref tracking sandbox-related state from stream events.

### `createOHTransport(options)`

Low-level transport factory for custom integrations. Creates the SSE connection with OpenHarness data part handling.

## Documentation

See the [full documentation](https://github.com/MaxGfeller/open-harness#readme) for server setup, middleware composition, and the complete streaming protocol.

## License

MIT
