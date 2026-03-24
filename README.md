# OpenHarness

Claude Code, Codex, OpenCode et al. are amazing general purpose agent harnesses that go far beyond just software development.

And while Anthropic offers the Claude Agent SDK, OpenAI now offers the Codex App Server, and OpenCode has a client to connect to an OpenCode instance, these harnesses are very "heavy" to use programmatically.

OpenHarness is an open source project based on Vercel's AI SDK that aims to provide the building blocks to build very capable, general-purpose agents in code. It is inspired by all of the aforementioned coding agents.

## Packages

OpenHarness is a pnpm monorepo with three packages and three example apps:

| Package | Description |
| --- | --- |
| [`@openharness/core`](packages/core) | Agent, Session, Conversation, middleware, tools, UI stream integration |
| [`@openharness/react`](packages/react) | React hooks and provider for AI SDK 5 chat UIs |
| [`@openharness/vue`](packages/vue) | Vue 3 composables and provider for AI SDK 5 chat UIs |
| [`examples/cli`](examples/cli) | Interactive terminal agent with tool approval and subagent display |
| [`examples/nextjs-demo`](examples/nextjs-demo) | Next.js chat app using `@openharness/react` |
| [`examples/nuxt-demo`](examples/nuxt-demo) | Nuxt 4 chat app using `@openharness/vue` |

## Getting Started

```bash
pnpm install
pnpm build
```

Both examples require an `OPENAI_API_KEY`. Create a `.env` file in the repo root:

```bash
echo "OPENAI_API_KEY=sk-..." > .env
```

### Run the CLI example

An interactive terminal agent with tool approval prompts, subagent display, and compaction.

```bash
pnpm --filter cli-demo start
```

### Run the Next.js example

A chat app with streaming, tool visualization, subagent status, and an `announce` tool for agent narration.

```bash
cp examples/nextjs-demo/.env.example examples/nextjs-demo/.env
# Edit .env and add your OPENAI_API_KEY
pnpm --filter nextjs-demo dev
```

Then open http://localhost:3000.

### Run the Nuxt example

The same chat experience built with Vue 3 and Nuxt 4.

```bash
pnpm --filter nuxt-demo dev
```

Then open http://localhost:3000.

## Agents

The `Agent` class is the core primitive. An agent wraps a language model, a set of tools, and a multi-step execution loop into a stateless executor that you can `run()` with a message history and new input.

```typescript
import { Agent, fsTools, bash } from "@openharness/core";
import { openai } from "@ai-sdk/openai";

const agent = new Agent({
  name: "dev",
  model: openai("gpt-5.2"),
  systemPrompt: "You are a helpful coding assistant.",
  tools: { ...fsTools, bash },
  maxSteps: 20,
});
```

### Running an agent

`agent.run()` is an async generator that takes a message history and new input, and yields a stream of typed events as the agent works. The agent is **stateless** — it doesn't accumulate messages internally. You pass the conversation history in and get the updated history back in the `done` event.

```typescript
import type { ModelMessage } from "ai";

let messages: ModelMessage[] = [];

for await (const event of agent.run(messages, "Refactor the auth module to use JWTs")) {
  switch (event.type) {
    case "text.delta":
      process.stdout.write(event.text);
      break;
    case "tool.start":
      console.log(`Calling ${event.toolName}...`);
      break;
    case "tool.done":
      console.log(`${event.toolName} finished`);
      break;
    case "done":
      messages = event.messages; // capture updated history for next turn
      console.log(`Result: ${event.result}, tokens: ${event.totalUsage.totalTokens}`);
      break;
  }
}
```

This makes it easy to build multi-turn interactions — just pass the messages from the previous `done` event into the next `run()` call. It also means you have full control over the conversation history: you can inspect it, modify it, or share it between agents.

### Events

The full set of events emitted by `run()`:

| Event | Description |
| --- | --- |
| `text.delta` | Streamed text chunk from the model |
| `text.done` | Full text for the current step is complete |
| `reasoning.delta` | Streamed reasoning/thinking chunk (if the model supports it) |
| `reasoning.done` | Full reasoning text for the step is complete |
| `tool.start` | A tool call has been initiated |
| `tool.done` | A tool call completed successfully |
| `tool.error` | A tool call failed |
| `step.start` | A new agentic step is starting |
| `step.done` | A step completed (includes token usage and finish reason) |
| `error` | An error occurred during execution |
| `done` | The agent has finished. `result` is one of `"complete"`, `"stopped"`, `"max_steps"`, or `"error"` |

### Configuration

| Option | Default | Description |
| --- | --- | --- |
| `name` | (required) | Agent name, used in logging and subagent selection |
| `model` | (required) | Any Vercel AI SDK `LanguageModel` |
| `systemPrompt` | — | System prompt prepended to every request |
| `tools` | — | AI SDK `ToolSet` — the tools the agent can call |
| `maxSteps` | `100` | Maximum agentic steps before stopping |
| `temperature` | — | Sampling temperature |
| `maxTokens` | — | Max output tokens per step |
| `instructions` | `true` | Whether to load `AGENTS.md` / `CLAUDE.md` from the project directory |
| `approve` | — | Callback for tool call approval (see [Permissions](#permissions)) |
| `subagents` | — | Child agents available via the `task` tool (see [Subagents](#subagents)) |
| `maxSubagentDepth` | `1` | Maximum nesting depth for subagents. `1` = direct subagents only, `2` = sub-subagents, etc. |
| `subagentBackground` | — | Enable background subagent execution with lifecycle tools (see [Background subagents](#background-subagents)) |
| `mcpServers` | — | MCP servers to connect to (see [MCP Servers](#mcp-servers)) |
| `skills` | — | Skills configuration (see [Skills](#skills)) |

## Sessions

While Agent is a stateless executor, `Session` adds the statefulness and resilience you need for interactive, multi-turn conversations. It owns the message history and handles compaction, retry, persistence, and lifecycle hooks automatically.

```typescript
import { Session } from "@openharness/core";

const session = new Session({
  agent,
  contextWindow: 200_000,
});

for await (const event of session.send("Refactor the auth module")) {
  switch (event.type) {
    case "text.delta":
      process.stdout.write(event.text);
      break;
    case "compaction.done":
      console.log(`Compacted: ${event.tokensBefore} → ${event.tokensAfter} tokens`);
      break;
    case "retry":
      console.log(`Retrying in ${event.delayMs}ms...`);
      break;
    case "turn.done":
      console.log(`Turn ${event.turnNumber} complete`);
      break;
  }
}
```

`session.send()` yields all the same `AgentEvent` types as `agent.run()`, plus additional session lifecycle events.

### Session configuration

| Option | Default | Description |
| --- | --- | --- |
| `agent` | (required) | The `Agent` to use for execution |
| `contextWindow` | — | Model context window size in tokens. Required for auto-compaction |
| `reservedTokens` | `min(20_000, agent.maxTokens ?? 20_000)` | Tokens reserved for output |
| `autoCompact` | `true` when `contextWindow` is set | Enable auto-compaction |
| `shouldCompact` | — | Custom overflow detection function |
| `compactionStrategy` | `DefaultCompactionStrategy()` | Custom compaction strategy |
| `retry` | — | Retry config for transient API errors |
| `hooks` | — | Lifecycle hooks (see [Hooks](#hooks)) |
| `sessionStore` | — | Pluggable persistence backend |
| `sessionId` | auto-generated UUID | Session identifier |

### Session events

In addition to all `AgentEvent` types, `session.send()` yields:

| Event | Description |
| --- | --- |
| `turn.start` | A new turn is starting |
| `turn.done` | Turn completed (includes token usage) |
| `compaction.start` | Compaction triggered (includes reason and token count) |
| `compaction.pruned` | Tool results pruned (phase 1) |
| `compaction.summary` | Conversation summarized (phase 2) |
| `compaction.done` | Compaction finished (includes before/after token counts) |
| `retry` | Retrying after a transient error (includes attempt count and delay) |

### Compaction

When a conversation approaches the context window limit, the session automatically compacts the message history. The default strategy works in two phases:

1. **Pruning** — replaces tool result content in older messages with `"[pruned]"`, preserving the most recent ~40K tokens of context. No LLM call needed.
2. **Summarization** — when pruning isn't enough, calls the model to generate a structured summary and replaces the entire history with it.

You can customize compaction at multiple levels:

```typescript
import { DefaultCompactionStrategy } from "@openharness/core";

// Tune the default strategy
const session = new Session({
  agent,
  contextWindow: 128_000,
  compactionStrategy: new DefaultCompactionStrategy({
    protectedTokens: 60_000,    // protect more recent context
    summaryModel: cheapModel,   // use a cheaper model for summarization
  }),
});

// Or replace the strategy entirely
const session = new Session({
  agent,
  contextWindow: 128_000,
  compactionStrategy: {
    async compact(context) {
      // your own compaction logic
      return { messages: [...], messagesRemoved: 0, tokensPruned: 0 };
    },
  },
});

// Or go fully manual
const session = new Session({ agent, autoCompact: false });
// ...later:
for await (const event of session.compact()) { ... }
```

### Retry

Transient API errors (429, 500, 502, 503, 504, 529, rate limits, timeouts) are retried automatically with exponential backoff and jitter. Retries only happen **before** any content has been streamed to the consumer — once the model starts producing output, the session commits to that attempt.

```typescript
const session = new Session({
  agent,
  retry: {
    maxRetries: 5,
    initialDelayMs: 2000,
    maxDelayMs: 60_000,
    isRetryable: (error) => error.message.includes("overloaded"),
  },
});
```

### Hooks

Hooks let you intercept and customize the session lifecycle:

```typescript
const session = new Session({
  agent,
  hooks: {
    // Modify messages before each LLM call
    onBeforeSend: (messages) => {
      return messages.filter(m => !isStale(m));
    },
    // Post-processing after each turn
    onAfterResponse: ({ turnNumber, messages, usage }) => {
      console.log(`Turn ${turnNumber}: ${usage.totalTokens} tokens`);
    },
    // Custom compaction prompt
    onCompaction: (context) => {
      return "Summarize with emphasis on code changes and file paths.";
    },
    // Custom error handling (return true to suppress)
    onError: (error, attempt) => {
      logger.warn(`Attempt ${attempt} failed: ${error.message}`);
    },
  },
});
```

### Persistence

Plug in any storage backend by implementing the `SessionStore` interface:

```typescript
const session = new Session({
  agent,
  sessionId: "user-123-conversation-1",
  sessionStore: {
    async load(id) { return db.get(id); },
    async save(id, messages) { await db.set(id, messages); },
    async delete(id) { await db.del(id); },
  },
});

// Restore a previous session
await session.load();

// Messages are auto-saved after each turn, or save manually:
await session.save();
```

### Direct state access

The session's message history is directly readable and writable:

```typescript
// Read current state
console.log(session.messages.length, session.turns, session.totalUsage);

// Inject or modify messages
session.messages.push({ role: "user", content: "Remember: always use TypeScript." });
```

## Middleware & Conversation

Session bundles compaction, retry, persistence, turn tracking, and hooks into a single class. If you want more control — composing only the behaviors you need, or writing custom middleware — use the functional `Runner`/`Middleware`/`Conversation` API instead.

### Runners and middleware

A `Runner` is just an async generator function with the same shape as `agent.run()`. A `Middleware` transforms one Runner into another. You compose them with `apply()`:

```typescript
import {
  Agent, Conversation, toRunner, apply,
  withTurnTracking, withCompaction, withRetry, withPersistence, withHooks,
} from "@openharness/core";

const agent = new Agent({
  name: "dev",
  model: openai("gpt-5.2"),
  tools: { ...fsTools, bash },
});

// Compose only the middleware you need
const runner = apply(
  toRunner(agent),
  withTurnTracking(),
  withCompaction({ contextWindow: 200_000, model: agent.model }),
  withRetry({ maxRetries: 5 }),
  withPersistence({ store: myStore, sessionId: "abc" }),
);

const chat = new Conversation({ runner });

for await (const event of chat.send("Fix the bug in auth.ts")) {
  if (event.type === "text.delta") process.stdout.write(event.text);
}
// chat.messages is automatically updated from the done event
```

Middleware listed first in `apply()` wraps outermost. The ordering above means: turn tracking brackets everything, compaction runs once before retries, retry wraps only the agent call, and persistence saves after a successful response.

### Available middleware

| Middleware | Description |
| --- | --- |
| `withTurnTracking()` | Emits `turn.start`/`turn.done` events. Maintains a turn counter across calls. |
| `withCompaction(config)` | Auto-compacts history when approaching the context window limit. Tracks `lastInputTokens` from `step.done` events. |
| `withRetry(config?)` | Retries on transient API errors (429, 500, etc.) with exponential backoff. Only retries before content has been streamed. |
| `withPersistence(config)` | Auto-saves messages to a `SessionStore` on every `done` event. |
| `withHooks(hooks)` | Applies `SessionHooks` (`onBeforeSend`, `onAfterResponse`, `onError`) around the inner runner. |

### Conversation

`Conversation` is a thin stateful wrapper over a composed Runner. It manages `messages` (updating from `done` events) and provides the same `toUIMessageStream()` and `toResponse()` methods as Session for AI SDK 5 integration:

```typescript
const chat = new Conversation({ runner, sessionId: "abc", store: myStore });

// Optionally load previous messages
await chat.load();

// Send messages — chat.messages is updated automatically
for await (const event of chat.send("hello")) { ... }

// Manual save (separate from withPersistence auto-save)
await chat.save();

// Next.js route handler
return chat.toResponse(input);
```

### Stream combinators

For lightweight event stream transforms, four curried combinators are available:

```typescript
import { tap, filter, map, takeUntil } from "@openharness/core";

// Log every event
const logged = tap(e => console.log(e.type));
for await (const event of logged(agent.run([], "hello"))) { ... }

// Drop reasoning events (done events are never filtered)
const noReasoning = filter(e => e.type !== "reasoning.delta");

// Transform text events
const uppercased = map(e =>
  e.type === "text.delta" ? { ...e, text: e.text.toUpperCase() } : e
);

// Stop after first text completion
const firstText = takeUntil(e => e.type === "text.done");
```

### Writing custom middleware

A middleware is a function that takes a Runner and returns a Runner. Here's a simple logging middleware:

```typescript
import type { Middleware } from "@openharness/core";

const withLogging: Middleware = (runner) =>
  async function* (history, input, options) {
    console.log(`Sending: ${typeof input === "string" ? input : "[messages]"}`);
    for await (const event of runner(history, input, options)) {
      if (event.type === "done") console.log(`Done: ${event.result}`);
      yield event;
    }
  };

const runner = apply(toRunner(agent), withLogging, withRetry());
```

### Composing with `pipe`

For reusable middleware stacks, use `pipe()` to create a combined middleware:

```typescript
import { pipe } from "@openharness/core";

const production = pipe(
  withTurnTracking(),
  withCompaction({ contextWindow: 200_000, model }),
  withRetry({ maxRetries: 5 }),
);

// Apply the same stack to multiple runners
const runner1 = production(toRunner(agent1));
const runner2 = production(toRunner(agent2));
```

## Tools

Tools use the Vercel AI SDK `tool()` helper with Zod schemas. OpenHarness ships a set of built-in tools that you can use as-is, compose, or replace entirely.

### Filesystem tools

| Tool | Description |
| --- | --- |
| `readFile` | Read file contents (supports line offset/limit) |
| `writeFile` | Write content to a file (creates parent dirs) |
| `editFile` | Find-and-replace within a file |
| `listFiles` | List files/directories (optionally recursive) |
| `grep` | Regex search across files (skips `node_modules`, `.git`) |
| `deleteFile` | Delete a file or directory |

All are exported individually and also grouped as `fsTools`. Available from the main entry point (`@openharness/core`) or the sub-path (`@openharness/core/tools/fs`).

### Bash tool

Runs arbitrary shell commands via `bash -c`. Configurable timeout (default 30s, max 5min) and automatic output truncation. Available from the main entry point (`@openharness/core`) or the sub-path (`@openharness/core/tools/bash`).

### Custom tools

Any AI SDK-compatible tool works. Just define it with `tool()` from the `ai` package:

```typescript
import { tool } from "ai";
import { z } from "zod";

const myTool = tool({
  description: "Do something useful",
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ query }) => {
    return { result: `You asked: ${query}` };
  },
});

const agent = new Agent({
  name: "my-agent",
  model: openai("gpt-5.2"),
  tools: { myTool },
});
```

## Permissions

By default, all tool calls are allowed. To gate tool execution — for example, prompting a user for confirmation — pass an `approve` callback:

```typescript
const agent = new Agent({
  name: "safe-agent",
  model: openai("gpt-5.2"),
  tools: { ...fsTools, bash },
  approve: async ({ toolName, toolCallId, input }) => {
    // Return true to allow, false to deny
    const answer = await askUser(`Allow ${toolName}?`);
    return answer === "yes";
  },
});
```

When a tool call is denied, a `ToolDeniedError` is thrown and surfaced to the model as a tool error, so it can adjust its approach.

The callback receives a `ToolCallInfo` object:

```typescript
interface ToolCallInfo {
  toolName: string;
  toolCallId: string;
  input: unknown;
}
```

The callback can be async — you can prompt a user in a terminal, show a modal in a web UI, or call an external approval service.

## Subagents

Agents can delegate work to other agents. When you pass a `subagents` array, a `task` tool is automatically generated that lets the parent agent spawn child agents by name.

```typescript
const explore = new Agent({
  name: "explore",
  description: "Read-only codebase exploration. Use for searching and reading files.",
  model: openai("gpt-5.2"),
  tools: { readFile, listFiles, grep },
  maxSteps: 30,
});

const agent = new Agent({
  name: "dev",
  model: openai("gpt-5.2"),
  tools: { ...fsTools, bash },
  subagents: [explore],
});
```

The parent model sees a `task` tool with a description listing the available subagents and their descriptions. It can call `task` with an `agent` name and a `prompt`, and the subagent runs to completion autonomously.

Key behaviors:

- **Fresh instance per task** — each `task` call creates a new agent with no shared conversation state
- **No approval** — subagents run autonomously without prompting for permission
- **Configurable nesting** — by default subagents cannot themselves have subagents (`maxSubagentDepth: 1`). Set a higher depth to enable nested delegation (see [Nested subagents](#nested-subagents))
- **Abort propagation** — the parent's abort signal is forwarded to the child
- **Concurrent execution** — the model can call `task` multiple times in one response to run subagents in parallel

### Nested subagents

By default, subagents cannot delegate further. Set `maxSubagentDepth` to allow nesting:

```typescript
const search = new Agent({
  name: "search",
  description: "Focused file search",
  model: openai("gpt-5.2"),
  tools: { grep, listFiles },
});

const explore = new Agent({
  name: "explore",
  description: "Read-only codebase exploration",
  model: openai("gpt-5.2"),
  tools: { readFile, listFiles, grep },
  subagents: [search], // explore can delegate to search
});

const agent = new Agent({
  name: "dev",
  model: openai("gpt-5.2"),
  tools: { ...fsTools, bash },
  subagents: [explore],
  maxSubagentDepth: 2, // allow explore → search nesting
});
```

The depth decrements at each level: the root agent has depth 2, its child `explore` gets depth 1 (can use `search`), and `search` gets depth 0 (no further delegation).

### Live subagent events

To observe what subagents are doing in real time, pass an `onSubagentEvent` callback:

```typescript
const agent = new Agent({
  name: "dev",
  model: openai("gpt-5.2"),
  tools: { ...fsTools, bash },
  subagents: [explore],
  onSubagentEvent: (path, event) => {
    // path is the ancestry chain, e.g. ["explore"] or ["explore", "search"]
    if (event.type === "tool.done") {
      console.log(`[${path.join(" > ")}] ${event.toolName} completed`);
    }
  },
});
```

The `path` parameter is a `string[]` representing the full ancestry from outermost to innermost agent. For a direct subagent it's `["explore"]`; for a nested sub-subagent it's `["explore", "search"]`. Events from nested subagents automatically bubble up through the chain.

The callback receives the same `AgentEvent` types as the parent's `run()` generator.

### Background subagents

By default, all subagent calls are synchronous — the parent blocks until the child finishes. Enable `subagentBackground` to let the parent spawn agents in the background, do other work, and collect results later. This works like JavaScript's `Promise` combinators (`Promise.all`, `Promise.any`, `Promise.race`, `Promise.allSettled`).

```typescript
const agent = new Agent({
  name: "dev",
  model: openai("gpt-5.2"),
  tools: { ...fsTools, bash },
  subagents: [explore, researcher, coder],
  subagentBackground: true, // enable with defaults
});
```

When enabled, three things happen:

1. The `task` tool gains an optional `background` parameter. When `true`, the agent is spawned in the background and the tool returns immediately with an agent ID.
2. An `agent_await` tool is registered for waiting on background agents using different strategies.
3. `agent_status` and `agent_cancel` tools are registered for checking on and cancelling background agents.

The model orchestrates everything naturally through tool calls:

```
// Model spawns two background agents and one foreground agent in one step:
task({ agent: "researcher", prompt: "Find deprecated APIs", background: true })   → "bg-1"
task({ agent: "researcher", prompt: "Check test coverage", background: true })    → "bg-2"
task({ agent: "coder", prompt: "Refactor config parser", background: false })     → (blocks)

// Next step — model has the coder result, now collects background results:
agent_await({ ids: ["bg-1", "bg-2"], mode: "all" })  → both results
```

#### Await modes

The `agent_await` tool supports four modes, matching JavaScript's `Promise` combinators:

| Mode | Behavior |
| --- | --- |
| `all` | Wait for all agents to succeed. Fails fast if any agent fails. |
| `allSettled` | Wait for all agents to finish. Returns results and errors. |
| `any` | Wait for the first agent to succeed. Only fails if all agents fail. |
| `race` | Wait for the first agent to settle (succeed or fail). |

#### Configuration

Pass `true` for sensible defaults, or an object for fine-grained control:

```typescript
const agent = new Agent({
  name: "dev",
  model: openai("gpt-5.2"),
  tools: { ...fsTools, bash },
  subagents: [explore, researcher],
  subagentBackground: {
    maxConcurrent: 3,           // max simultaneous background agents (default: Infinity)
    timeout: 120_000,           // auto-cancel after 2 minutes (default: none)
    autoCancel: true,           // cancel background agents on agent.close() (default: true)
    tools: {
      status: true,             // register agent_status tool (default: true)
      cancel: true,             // register agent_cancel tool (default: true)
      await: ["all", "race"],   // which await modes to expose (default: all four)
    },
  },
});
```

| Option | Default | Description |
| --- | --- | --- |
| `maxConcurrent` | `Infinity` | Maximum number of background agents running simultaneously |
| `timeout` | — | Auto-cancel background agents after this many milliseconds |
| `autoCancel` | `true` | Cancel all running background agents when `agent.close()` is called |
| `tools.status` | `true` | Register the `agent_status` tool |
| `tools.cancel` | `true` | Register the `agent_cancel` tool |
| `tools.await` | all four modes | Which await modes to expose. `true` = all, `false` = disable, or an array of specific modes |

#### Lifecycle tools

When `subagentBackground` is enabled, these tools are auto-registered alongside the `task` tool:

| Tool | Description |
| --- | --- |
| `agent_status` | Non-blocking status check. Returns the agent's current status (`running`, `done`, `failed`, `cancelled`) and result if available. |
| `agent_cancel` | Cancel a running background agent via its ID. |
| `agent_await` | Block until background agents complete, using one of the four await modes. |

#### Cleanup

Background agents respect the parent's abort signal — if the parent is aborted, all background children are cancelled. When `autoCancel` is `true` (the default), calling `agent.close()` cancels any still-running background agents.

## AGENTS.md

OpenHarness supports the [AGENTS.md](https://agents.md) spec. On first run, the agent walks up from the current directory to the filesystem root looking for `AGENTS.md` or `CLAUDE.md`. The first file found is loaded and prepended to the system prompt.

This is enabled by default. Set `instructions: false` to disable it.

## MCP Servers

Agents can connect to [Model Context Protocol](https://modelcontextprotocol.io) servers. Tools from MCP servers are merged into the agent's toolset alongside any static tools.

```typescript
const agent = new Agent({
  name: "dev",
  model: openai("gpt-5.2"),
  tools: { ...fsTools, bash },
  mcpServers: {
    github: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN },
    },
    weather: {
      type: "http",
      url: "https://weather-mcp.example.com/mcp",
      headers: { Authorization: "Bearer ..." },
    },
  },
});

// MCP connections are established lazily on first run()
for await (const event of agent.run([], "What PRs are open?")) { ... }

// Clean up MCP connections when done
await agent.close();
```

Three transport types are supported:

| Transport | Use case |
| --- | --- |
| `stdio` | Local servers — spawns a child process, communicates over stdin/stdout |
| `http` | Remote servers via Streamable HTTP (recommended for production) |
| `sse` | Remote servers via Server-Sent Events (legacy) |

When multiple MCP servers are configured, tools are namespaced as `serverName_toolName` to avoid collisions. With a single server, tool names are used as-is.

## Skills

Skills are reusable instruction packages — markdown documents that get loaded into the LLM conversation on demand. They provide domain-specific knowledge, workflows, and reference material without executing arbitrary code. Think of them as context-injecting tools: the model calls a `skill` tool, and the skill's markdown content is returned as structured output.

### Skill file format

Each skill is a directory containing a `SKILL.md` file with YAML frontmatter:

```
my-skill/
├── SKILL.md              # Required — skill definition
├── references/           # Optional — auxiliary files the model can read
│   └── api.md
└── scripts/
    └── setup.sh
```

```yaml
---
name: my-skill
description: A short description of what this skill does
---

# My Skill

Full markdown content here. This is the prompt that gets injected
into the conversation when the skill is loaded.
```

Skill names must be lowercase alphanumeric with single hyphens (`^[a-z0-9]+(-[a-z0-9]+)*$`).

### Configuration

Point the agent at one or more directories containing skill folders:

```typescript
const agent = new Agent({
  name: "dev",
  model: openai("gpt-5.2"),
  tools: { ...fsTools, bash },
  skills: {
    paths: ["./skills", "~/.my-app/skills"],
  },
});
```

Paths can be absolute, relative (resolved from cwd), or use `~/` for the home directory. When multiple paths contain a skill with the same name, later paths take precedence.

### How it works

When `skills` is configured, a `skill` tool is automatically added to the agent's toolset (similar to how the `task` tool is auto-generated for subagents). The tool's description includes an XML listing of all available skills, so the model knows what it can invoke.

Skills are discovered lazily on the first `run()` call and cached for the agent's lifetime — the same pattern as MCP server connections.

When the model calls the `skill` tool:

1. The skill's markdown body is returned as structured XML output
2. Auxiliary files in the skill directory (up to 10) are listed so the model can read them with other tools
3. The base directory path is included so relative references resolve correctly

Since the skill tool is a regular tool, it emits the standard `tool.start` and `tool.done` events. It also goes through the `approve` callback if one is configured.

### Standalone usage

The discovery and tool creation functions are exported separately for full control:

```typescript
import { discoverSkills, createSkillTool } from "@openharness/core";

const skills = await discoverSkills({ paths: ["./skills"] });
console.log(skills.map(s => s.name)); // inspect discovered skills

// Create the tool manually and pass it in
const agent = new Agent({
  name: "dev",
  model: openai("gpt-5.2"),
  tools: { ...fsTools, bash, skill: createSkillTool(skills) },
});
```

## AI SDK 5 UI Integration

OpenHarness integrates with AI SDK 5's data stream protocol, so you can stream agent sessions directly to `useChat`-based React UIs.

### Server: `toResponse()`

Both `Session` and `Conversation` have two methods for streaming to the client:

- `toUIMessageStream(input)` — returns a `ReadableStream<UIMessageChunk>` that maps session events to AI SDK 5 typed chunks
- `toResponse(input)` — wraps the stream in an HTTP `Response` with SSE headers, ready to return from any route handler

```typescript
// app/api/chat/route.ts (Next.js)
import {
  Agent, Conversation, toRunner, apply,
  withTurnTracking, withCompaction, withRetry, withPersistence,
  extractUserInput, type SessionStore,
} from "@openharness/core";

const store: SessionStore = {
  async load(id) { return db.get(id); },
  async save(id, messages) { await db.set(id, messages); },
};

const conversations = new Map<string, Conversation>();

function getOrCreateConversation(id?: string): Conversation {
  const convId = id ?? crypto.randomUUID();
  let conv = conversations.get(convId);
  if (!conv) {
    const runner = apply(
      toRunner(agent),
      withTurnTracking(),
      withCompaction({ contextWindow: 128_000, model: agent.model }),
      withRetry(),
      withPersistence({ store, sessionId: convId }),
    );
    conv = new Conversation({ runner, sessionId: convId, store });
    conversations.set(convId, conv);
  }
  return conv;
}

export async function POST(req: Request) {
  const { id, messages } = await req.json();
  const conv = getOrCreateConversation(id);
  const input = await extractUserInput(messages);
  return conv.toResponse(input);
}
```

The stream emits all standard AI SDK 5 chunk types (`text-delta`, `reasoning-delta`, `tool-input-available`, `tool-output-available`, `start`, `finish`, etc.) plus custom OpenHarness data parts for subagent activity, compaction, retry, and turn lifecycle:

| Data part | Description |
| --- | --- |
| `data-oh:subagent.start` | A subagent task was spawned |
| `data-oh:subagent.done` | A subagent task completed |
| `data-oh:subagent.error` | A subagent task failed |
| `data-oh:compaction.start` | Compaction started |
| `data-oh:compaction.done` | Compaction finished |
| `data-oh:retry` | Retrying after transient error |
| `data-oh:turn.start` | Turn started |
| `data-oh:turn.done` | Turn finished |
| `data-oh:session.compacting` | Session is compacting |

### Client: `@openharness/react`

The React package provides hooks that wire into AI SDK 5's `useChat` and track OpenHarness-specific state:

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
  const { messages, sendMessage, status, stop } = useOpenHarness({
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
      <button onClick={() => sendMessage({ text: "Hello" })}>Send</button>
    </div>
  );
}
```

**`useOpenHarness(config)`** — creates a chat session connected to your API endpoint. Returns the same interface as AI SDK 5's `useChat` (`messages`, `sendMessage`, `status`, `stop`, etc.), typed with `OHUIMessage`.

**`useSubagentStatus()`** — derives reactive state from `data-oh:subagent.*` events:
- `activeSubagents` — currently running subagents
- `recentSubagents` — all subagents seen in this session
- `hasActiveSubagents` — boolean shorthand

**`useSessionStatus()`** — tracks turn index, compaction state, and retry info from `data-oh:*` events.

**`OpenHarnessProvider`** — context provider that holds subagent, session, and sandbox state. Wrap your app (or chat component) with this.

### Client: `@openharness/vue`

The Vue package provides the same functionality as composables for Vue 3 and Nuxt:

```vue
<script setup lang="ts">
import {
  OpenHarnessProvider,
  useOpenHarness,
  useSubagentStatus,
  useSessionStatus,
} from "@openharness/vue";
</script>

<template>
  <OpenHarnessProvider>
    <Chat />
  </OpenHarnessProvider>
</template>
```

```vue
<script setup lang="ts">
import { ref } from "vue";
import { useOpenHarness, useSubagentStatus, useSessionStatus } from "@openharness/vue";

const chat = useOpenHarness({ endpoint: "/api/chat" });
const subagent = useSubagentStatus();
const session = useSessionStatus();
const input = ref("");

function send() {
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
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
    <form @submit.prevent="send">
      <input v-model="input" placeholder="Type a message..." />
      <button type="submit">Send</button>
    </form>
  </div>
</template>
```

**`useOpenHarness(config)`** — creates a chat session connected to your API endpoint. Returns an AI SDK 5 `Chat` instance with reactive properties (`messages`, `status`, `sendMessage`, `stop`, etc.), typed with `OHUIMessage`.

**`useSubagentStatus()`** — returns a computed ref deriving reactive state from `data-oh:subagent.*` events.

**`useSessionStatus()`** — returns a computed ref tracking turn index, compaction state, and retry info.

**`OpenHarnessProvider`** — renderless wrapper component that provides shared subagent, session, and sandbox state via Vue's `provide`/`inject`.

### Custom data part types

If you're building custom UI components that consume the stream directly, the core package exports typed data part types and guards:

```typescript
import {
  type OHDataPart,
  isSubagentEvent,
  isCompactionEvent,
} from "@openharness/core";
```

## Examples

| Example | Description | Run |
| --- | --- | --- |
| [`examples/cli`](examples/cli) | Interactive terminal agent with tool approval, subagent display, and composed middleware | `pnpm --filter cli-demo start` |
| [`examples/nextjs-demo`](examples/nextjs-demo) | Next.js chat app with streaming, `@openharness/react`, composed middleware, and `announce` tool | `pnpm --filter nextjs-demo dev` |
| [`examples/nuxt-demo`](examples/nuxt-demo) | Nuxt 4 chat app with streaming, `@openharness/vue`, composed middleware, and `announce` tool | `pnpm --filter nuxt-demo dev` |

See [Getting Started](#getting-started) for setup instructions.
