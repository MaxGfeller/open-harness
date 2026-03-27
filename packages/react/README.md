# @openharness/react

React hooks and provider for [OpenHarness](https://github.com/MaxGfeller/open-harness) AI SDK 5 chat UIs.

## Install

```bash
npm install @openharness/react
```

Peer dependencies: `@openharness/core`, `@ai-sdk/react`, `react`

## Quick start

```tsx
import {
  OpenHarnessProvider,
  useOpenHarness,
  useSubagentStatus,
  useSessionStatus,
} from "@openharness/react";

function App() {
  return (
    <OpenHarnessProvider>
      <Chat />
    </OpenHarnessProvider>
  );
}

function Chat() {
  const { messages, sendMessage, status } = useOpenHarness({
    endpoint: "/api/chat",
  });
  const { activeSubagents, hasActiveSubagents } = useSubagentStatus();
  const session = useSessionStatus();

  return (
    <div>
      {messages.map((msg) => (
        <div key={msg.id}>
          {msg.parts.map((part, i) =>
            part.type === "text" ? <span key={i}>{part.text}</span> : null
          )}
        </div>
      ))}
      {hasActiveSubagents && <p>Subagents working...</p>}
      <button onClick={() => sendMessage({ text: "Hello" })}>Send</button>
    </div>
  );
}
```

## API

### `<OpenHarnessProvider>`

Context provider that holds subagent, session, and sandbox state. Wrap your app or chat component with this.

### `useOpenHarness(config)`

Creates a chat session connected to your API endpoint. Returns the same interface as AI SDK 5's `useChat` (`messages`, `sendMessage`, `status`, `stop`, etc.), typed with `OHUIMessage`.

If you pass `messages`, the hook will also hydrate them when they arrive after the first render, which is useful for async persistence loads.

`onFinish` receives the full finish event, including `isAbort`, so persistence code can skip saving aborted assistant messages when desired.

### `useSubagentStatus()`

Derives reactive state from `data-oh:subagent.*` stream events:

- `activeSubagents` -- currently running subagents
- `recentSubagents` -- all subagents seen in this session
- `hasActiveSubagents` -- boolean shorthand

### `useSessionStatus()`

Tracks turn index, compaction state, and retry info from `data-oh:*` stream events.

### `useSandboxStatus()`

Tracks sandbox-related state from stream events.

### `createOHTransport(options)`

Low-level transport factory for custom integrations. Creates the SSE connection with OpenHarness data part handling.

## Documentation

See the [full documentation](https://github.com/MaxGfeller/open-harness#readme) for server setup, middleware composition, and the complete streaming protocol.

## License

ISC
