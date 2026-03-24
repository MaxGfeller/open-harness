# @openharness/core

Building blocks for capable, general-purpose AI agents. Part of [OpenHarness](https://github.com/MaxGfeller/open-harness).

## Install

```bash
npm install @openharness/core
```

## What's inside

- **Agent** -- stateless multi-step executor wrapping any AI SDK `LanguageModel` with tools, subagents, MCP, and skills
- **Session** -- batteries-included stateful wrapper with compaction, retry, persistence, and hooks
- **Runner & Middleware** -- composable FP-style middleware (`withRetry`, `withCompaction`, `withTurnTracking`, `withPersistence`, `withHooks`) for pick-and-choose behavior
- **Conversation** -- lightweight stateful wrapper over a composed Runner, with `toResponse()` for AI SDK 5 streaming
- **Stream combinators** -- `tap`, `filter`, `map`, `takeUntil` for async generator transforms
- **Tools** -- filesystem tools (`readFile`, `writeFile`, `editFile`, `listFiles`, `grep`, `deleteFile`) and a `bash` tool
- **UI streaming** -- `sessionEventsToUIStream()` maps agent events to AI SDK 5 `UIMessageChunk` streams

## Quick start

### Agent (stateless)

```typescript
import { Agent, fsTools, bash } from "@openharness/core";
import { openai } from "@ai-sdk/openai";

const agent = new Agent({
  name: "dev",
  model: openai("gpt-5.2"),
  tools: { ...fsTools, bash },
});

for await (const event of agent.run([], "Fix the auth bug")) {
  if (event.type === "text.delta") process.stdout.write(event.text);
  if (event.type === "done") console.log(event.result);
}
```

### Middleware + Conversation (composable)

```typescript
import {
  Agent, Conversation, toRunner, apply,
  withTurnTracking, withCompaction, withRetry,
} from "@openharness/core";

const runner = apply(
  toRunner(agent),
  withTurnTracking(),
  withCompaction({ contextWindow: 200_000, model: agent.model }),
  withRetry(),
);

const chat = new Conversation({ runner });

for await (const event of chat.send("Refactor the config parser")) {
  if (event.type === "text.delta") process.stdout.write(event.text);
}
```

### Session (batteries-included)

```typescript
import { Session } from "@openharness/core";

const session = new Session({ agent, contextWindow: 200_000 });

for await (const event of session.send("Refactor the config parser")) {
  if (event.type === "text.delta") process.stdout.write(event.text);
}
```

### Next.js route handler

```typescript
import {
  Agent, Conversation, toRunner, apply,
  withTurnTracking, withCompaction, withRetry,
  extractUserInput,
} from "@openharness/core";

const runner = apply(
  toRunner(agent),
  withTurnTracking(),
  withCompaction({ contextWindow: 128_000, model: agent.model }),
  withRetry(),
);

const chat = new Conversation({ runner });

export async function POST(req: Request) {
  const { messages } = await req.json();
  const input = await extractUserInput(messages);
  return chat.toResponse(input);
}
```

## Documentation

See the [full documentation](https://github.com/MaxGfeller/open-harness#readme) for:

- Agent configuration, events, and lifecycle
- Subagents (foreground & background)
- Middleware reference and custom middleware
- Compaction strategies
- MCP server integration
- Skills system
- AI SDK 5 UI integration

## License

ISC
