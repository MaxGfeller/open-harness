# OpenHarness

[![npm version](https://img.shields.io/npm/v/%40openharness%2Fcore?label=core%20version)](https://www.npmjs.com/package/%40openharness/core)
[![bundle size](https://img.shields.io/bundlephobia/minzip/%40openharness%2Fcore?label=core%20min%2Bgzip)](https://bundlephobia.com/package/%40openharness%2Fcore@latest)
[![dependencies](https://img.shields.io/librariesio/release/npm/%40openharness%2Fcore?label=core%20dependencies)](https://libraries.io/npm/%40openharness%2Fcore)
[![monthly downloads](https://img.shields.io/npm/dm/%40openharness%2Fcore?label=core%20downloads)](https://www.npmjs.com/package/%40openharness/core)
[![license](https://img.shields.io/github/license/MaxGfeller/open-harness)](./LICENSE)

Build capable, general-purpose AI agents in code. Based on [Vercel's AI SDK](https://sdk.vercel.ai), inspired by Claude Code, Codex, and similar agent harnesses.

**[Documentation](https://docs.open-harness.dev)**

## Packages

| Package | Description |
| --- | --- |
| [`@openharness/core`](packages/core) | Agent, Session, Conversation, middleware, tools, UI stream integration |
| [`@openharness/provider-chatgpt`](packages/provider-chatgpt) | Experimental ChatGPT/Codex OAuth model provider for ChatGPT subscription-backed local harnesses |
| [`@openharness/provider-vfs`](packages/provider-vfs) | Virtual filesystem provider for sandboxed, in-memory, or SQLite-backed file access |
| [`@openharness/react`](packages/react) | React hooks and provider for AI SDK 5 chat UIs |
| [`@openharness/vue`](packages/vue) | Vue 3 composables and provider for AI SDK 5 chat UIs |

## Quick Start

```bash
npm install @openharness/core @ai-sdk/openai
```

```typescript
import { Agent, createFsTools, createBashTool, NodeFsProvider, NodeShellProvider } from "@openharness/core";
import { openai } from "@ai-sdk/openai";

const agent = new Agent({
  name: "dev",
  model: openai("gpt-5.4"),
  tools: {
    ...createFsTools(new NodeFsProvider()),
    ...createBashTool(new NodeShellProvider()),
  },
  maxSteps: 20,
});

for await (const event of agent.run([], "Refactor the auth module")) {
  if (event.type === "text.delta") process.stdout.write(event.text);
}
```

## Tool-Loop Configuration

`Agent` forwards selected [AI SDK `streamText`](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text) tool-loop options from its constructor: `toolChoice`, `stopWhen`, `prepareStep`, `activeTools`, and `providerOptions`.

```typescript
import { hasToolCall } from "ai";

const agent = new Agent({
  name: "research",
  model: openai("gpt-5.4"),
  tools,
  toolChoice: "required",
  activeTools: ["lookup", "submitResult"],
  stopWhen: hasToolCall("submitResult"),
  prepareStep: ({ steps }) =>
    steps.length > 2 ? { activeTools: ["submitResult"] } : undefined,
  providerOptions: {
    someProvider: { someOption: true },
  },
  maxSteps: 20,
});
```

Custom `stopWhen` conditions are always composed with OpenHarness's `stepCountIs(maxSteps)` safety condition, so `maxSteps` remains a hard limit. A `tool-calls` finish before that limit is reported as `stopped`; reaching the safety limit is reported as `max_steps`.

`prepareStep` can override AI SDK configuration for an individual step, such as active tools, but it cannot determine semantic application state or replace application-level completion policies on its own.

Tool names are inferred from statically supplied `tools`. MCP, skills, subagents, and background-agent tools are merged at runtime, so TypeScript cannot infer their names when static tools are also present. Widen the agent to `Agent<ToolSet>` (with `ToolSet` imported from `ai`) when constructor configuration must refer to runtime-discovered tools.

## Multi-Turn with Sessions

```typescript
import { Session } from "@openharness/core";

const session = new Session({ agent, contextWindow: 128_000 });

for await (const event of session.send("List all TypeScript files")) {
  if (event.type === "text.delta") process.stdout.write(event.text);
}

// Session remembers the conversation, handles compaction and retry
for await (const event of session.send("Now refactor the largest one")) {
  if (event.type === "text.delta") process.stdout.write(event.text);
}
```

## Composable Middleware

```typescript
import { Conversation, toRunner, apply, withTurnTracking, withCompaction, withRetry } from "@openharness/core";

const runner = apply(
  toRunner(agent),
  withTurnTracking(),
  withCompaction({ contextWindow: 200_000, model: agent.model }),
  withRetry({ maxRetries: 5 }),
);

const chat = new Conversation({ runner });
for await (const event of chat.send("Fix the bug")) { /* ... */ }
```

## Subagents

Built-in subagents stay stateless by default, but you can now opt into:

- Dynamic subagent catalogs resolved at run time
- Resumable subagent sessions built on top of `Session`
- Background runs with separate run IDs and session IDs

## Examples

| Example | Run |
| --- | --- |
| [CLI agent](examples/cli) — terminal agent with tool approval and subagents | `pnpm --filter cli-demo start` or `pnpm --filter cli-demo start -- --chatgpt` |
| [Next.js chat](examples/nextjs-demo) — streaming chat with `@openharness/react` | `pnpm --filter nextjs-demo dev` |
| [Nuxt chat](examples/nuxt-demo) — streaming chat with `@openharness/vue` | `pnpm --filter nuxt-demo dev` |

By default the examples use `OPENAI_API_KEY`. The CLI agent can instead use ChatGPT/Codex OAuth with `--chatgpt`.

To run them:

```bash
git clone https://github.com/MaxGfeller/open-harness.git
cd open-harness
echo "OPENAI_API_KEY=sk-..." > .env
pnpm install && pnpm build
```

## Learn More

See the full documentation at **[docs.open-harness.dev](https://docs.open-harness.dev)** for:

- [Agents](https://docs.open-harness.dev/core/agents) — stateless executors, events, configuration
- [Sessions](https://docs.open-harness.dev/core/sessions) — compaction, retry, persistence, hooks
- [Middleware](https://docs.open-harness.dev/core/middleware) — composable middleware and the Conversation API
- [Tools](https://docs.open-harness.dev/tools/built-in-tools) — filesystem, bash, custom tools, permissions
- [Subagents](https://docs.open-harness.dev/advanced/subagents) — nested delegation, dynamic catalogs, resumable sessions, and background execution
- [MCP Servers](https://docs.open-harness.dev/advanced/mcp-servers) — Model Context Protocol integration
- [Skills](https://docs.open-harness.dev/advanced/skills) — on-demand instruction packages
- [UI Integration](https://docs.open-harness.dev/ui-integration/server-streaming) — React and Vue streaming

## License

MIT — see [LICENSE](./LICENSE) for details.
