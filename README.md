# OpenHarness

Build capable, general-purpose AI agents in code. Based on [Vercel's AI SDK](https://sdk.vercel.ai), inspired by Claude Code, Codex, and similar agent harnesses.

**[Documentation](https://docs.open-harness.dev)**

## Packages

| Package | Description |
| --- | --- |
| [`@openharness/core`](packages/core) | Agent, Session, Conversation, middleware, tools, UI stream integration |
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

## Examples

| Example | Run |
| --- | --- |
| [CLI agent](examples/cli) — terminal agent with tool approval and subagents | `pnpm --filter cli-demo start` |
| [Next.js chat](examples/nextjs-demo) — streaming chat with `@openharness/react` | `pnpm --filter nextjs-demo dev` |
| [Nuxt chat](examples/nuxt-demo) — streaming chat with `@openharness/vue` | `pnpm --filter nuxt-demo dev` |

All examples require an `OPENAI_API_KEY`. To run them:

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
- [Subagents](https://docs.open-harness.dev/advanced/subagents) — nested delegation and background execution
- [MCP Servers](https://docs.open-harness.dev/advanced/mcp-servers) — Model Context Protocol integration
- [Skills](https://docs.open-harness.dev/advanced/skills) — on-demand instruction packages
- [UI Integration](https://docs.open-harness.dev/ui-integration/server-streaming) — React and Vue streaming

## License

MIT — see [LICENSE](./LICENSE) for details.
