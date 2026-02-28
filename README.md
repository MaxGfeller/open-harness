# OpenHarness

Claude Code, Codex, OpenCode et al. are amazing general purpose agent harnesses that go far beyond just software development.

And while Anthropic offers the Claude Agent SDK, OpenAI now offers the Codex App Server, and OpenCode has a client to connect to an OpenCode instance, these harnesses are very "heavy" to use programmatically.

OpenHarness is an open source project based on Vercel's AI SDK that aims to provide the building blocks to build very capable, general-purpose agents in code. It is inspired by all of the aforementioned coding agents.

## Agents

The `Agent` class is the core primitive. An agent wraps a language model, a set of tools, and a multi-step execution loop into a stateless executor that you can `run()` with a message history and new input.

```typescript
import { Agent } from "@openharness/core";
import { openai } from "@ai-sdk/openai";
import { fsTools } from "@openharness/core/tools/fs";
import { bash } from "@openharness/core/tools/bash";

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
| `mcpServers` | — | MCP servers to connect to (see [MCP Servers](#mcp-servers)) |

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

## Tools

Tools use the Vercel AI SDK `tool()` helper with Zod schemas. OpenHarness ships a set of built-in tools that you can use as-is, compose, or replace entirely.

### Filesystem tools (`@openharness/core/tools/fs`)

| Tool | Description |
| --- | --- |
| `readFile` | Read file contents (supports line offset/limit) |
| `writeFile` | Write content to a file (creates parent dirs) |
| `editFile` | Find-and-replace within a file |
| `listFiles` | List files/directories (optionally recursive) |
| `grep` | Regex search across files (skips `node_modules`, `.git`) |
| `deleteFile` | Delete a file or directory |

All are exported individually and also grouped as `fsTools`.

### Bash tool (`@openharness/core/tools/bash`)

Runs arbitrary shell commands via `bash -c`. Configurable timeout (default 30s, max 5min) and automatic output truncation.

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
- **No nesting** — subagents cannot themselves have subagents
- **Abort propagation** — the parent's abort signal is forwarded to the child
- **Concurrent execution** — the model can call `task` multiple times in one response to run subagents in parallel

### Live subagent events

To observe what subagents are doing in real time, pass an `onSubagentEvent` callback:

```typescript
const agent = new Agent({
  name: "dev",
  model: openai("gpt-5.2"),
  tools: { ...fsTools, bash },
  subagents: [explore],
  onSubagentEvent: (agentName, event) => {
    if (event.type === "tool.done") {
      console.log(`[${agentName}] ${event.toolName} completed`);
    }
  },
});
```

The callback receives the same `AgentEvent` types as the parent's `run()` generator.

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

## Example CLI

[`example/cli.ts`](example/cli.ts) is a fully working agent CLI that ties everything together — a `Session` wrapping an `Agent` with tool approval prompts, ora spinners, streamed output, live subagent display, and a `/compact` command for manual compaction. It's a good reference for how to wire up all the primitives into an interactive application.

```bash
# requires a .env file with OPENAI_API_KEY
pnpm cli
```
