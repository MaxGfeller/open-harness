# OpenHarness

Claude Code, Codex, OpenCode et al. are amazing general purpose agent harnesses that go far beyond just software development.

And while Anthropic offers the Claude Agent SDK, OpenAI now offers the Codex App Server, and OpenCode has a client to connect to an OpenCode instance, these harnesses are very "heavy" to use programmatically.

OpenHarness is an open source project based on Vercel's AI SDK that aims to provide the building blocks to build very capable, general-purpose agents in code. It is inspired by all of the aforementioned coding agents.

## Agents

The `Agent` class is the core primitive. An agent wraps a language model, a set of tools, and a multi-step execution loop into a single object that you can `run()` with a prompt.

```typescript
import { Agent } from "open-harness";
import { openai } from "@ai-sdk/openai";
import { fsTools } from "open-harness/tools/fs";
import { bash } from "open-harness/tools/bash";

const agent = new Agent({
  name: "dev",
  model: openai("gpt-5.2"),
  systemPrompt: "You are a helpful coding assistant.",
  tools: { ...fsTools, bash },
  maxSteps: 20,
});
```

### Running an agent

`agent.run()` is an async generator that yields a stream of typed events as the agent works. You iterate over these events to build any UI you want — a CLI, a web app, a log file, or nothing at all.

```typescript
for await (const event of agent.run("Refactor the auth module to use JWTs")) {
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
      console.log(`Result: ${event.result}, tokens: ${event.totalUsage.totalTokens}`);
      break;
  }
}
```

The agent maintains conversation history across `run()` calls, so you can use it in a loop for multi-turn interactions.

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

## Tools

Tools use the Vercel AI SDK `tool()` helper with Zod schemas. OpenHarness ships a set of built-in tools that you can use as-is, compose, or replace entirely.

### Filesystem tools (`open-harness/tools/fs`)

| Tool | Description |
| --- | --- |
| `readFile` | Read file contents (supports line offset/limit) |
| `writeFile` | Write content to a file (creates parent dirs) |
| `editFile` | Find-and-replace within a file |
| `listFiles` | List files/directories (optionally recursive) |
| `grep` | Regex search across files (skips `node_modules`, `.git`) |
| `deleteFile` | Delete a file or directory |

All are exported individually and also grouped as `fsTools`.

### Bash tool (`open-harness/tools/bash`)

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
for await (const event of agent.run("What PRs are open?")) { ... }

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

`src/cli.ts` is a fully working agent CLI that ties everything together — tool approval prompts, ora spinners, streamed output, and live subagent display. It's a good reference for how to wire up all the primitives into an interactive application.

```bash
pnpm cli
```

Requires a `.env` file with your `OPENAI_API_KEY`. The CLI sets up a main agent with filesystem and bash tools, plus an `explore` subagent for read-only codebase navigation.
