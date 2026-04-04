import { beforeEach, describe, expect, it, vi } from "vitest";

const { stepCountIsMock, streamTextMock } = vi.hoisted(() => ({
  stepCountIsMock: vi.fn(),
  streamTextMock: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: streamTextMock,
    stepCountIs: stepCountIsMock,
  };
});

import type { ModelMessage } from "ai";
import {
  Agent,
  type SubagentCatalog,
  type SubagentSessionMetadata,
  type SubagentSessionMetadataStore,
} from "../index.js";

function createModel() {
  return {
    specificationVersion: "v2",
    provider: "mock",
    modelId: "mock-model",
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  } as any;
}

function createMessageStore() {
  const messages = new Map<string, ModelMessage[]>();
  return {
    messages,
    store: {
      async load(sessionId: string) {
        return messages.get(sessionId);
      },
      async save(sessionId: string, nextMessages: ModelMessage[]) {
        messages.set(sessionId, structuredClone(nextMessages));
      },
    },
  };
}

function createMetadataStore() {
  const entries = new Map<string, SubagentSessionMetadata>();
  const store: SubagentSessionMetadataStore = {
    async load(sessionId) {
      return entries.get(sessionId);
    },
    async save(metadata) {
      entries.set(metadata.sessionId, metadata);
    },
  };
  return { entries, store };
}

function createTextStream(
  text: string,
  historyAssertion?: (messages: ModelMessage[]) => void,
) {
  return ({ messages }: { messages: ModelMessage[] }) => {
    historyAssertion?.(messages);
    const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
    return {
      fullStream: (async function* () {
        yield { type: "start-step" } as const;
        yield { type: "text-delta", text } as const;
        yield { type: "text-end" } as const;
        yield {
          type: "finish-step",
          usage,
          finishReason: "stop",
        } as const;
        yield {
          type: "finish",
          finishReason: "stop",
          totalUsage: usage,
        } as const;
      })(),
      response: Promise.resolve({
        messages: [{ role: "assistant", content: text }],
      }),
    };
  };
}

function createParentTaskStream(input: Record<string, unknown>) {
  return ({ tools }: { tools: Record<string, any> }) => {
    const outputPromise = tools.task.execute(input, {
      abortSignal: undefined,
    });
    const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
    return {
      fullStream: (async function* () {
        yield { type: "start-step" } as const;
        yield {
          type: "tool-call",
          toolCallId: "tc-1",
          toolName: "task",
          input,
        } as const;
        const output = await outputPromise;
        yield {
          type: "tool-result",
          toolCallId: "tc-1",
          toolName: "task",
          output,
        } as const;
        yield {
          type: "finish-step",
          usage,
          finishReason: "tool-calls",
        } as const;
        yield {
          type: "finish",
          finishReason: "stop",
          totalUsage: usage,
        } as const;
      })(),
      response: Promise.resolve({ messages: [] }),
    };
  };
}

async function collect(parent: Agent, input = "delegate") {
  const events = [];
  for await (const event of parent.run([], input)) {
    events.push(event);
  }
  return events;
}

function extractTaskOutput(events: any[]) {
  return events.find(
    (event) => event.type === "tool.done" && event.toolName === "task",
  )?.output as string | undefined;
}

function extractSessionId(output: string) {
  return output.match(/session_id="([^"]+)"/)?.[1];
}

describe("subagent task tool", () => {
  beforeEach(() => {
    streamTextMock.mockReset();
    stepCountIsMock.mockReset();
  });

  it("preserves stateless task behavior by default", async () => {
    const child = new Agent({
      name: "explore",
      model: createModel(),
      instructions: false,
    });
    const parent = new Agent({
      name: "dev",
      model: createModel(),
      instructions: false,
      subagents: [child],
    });

    streamTextMock
      .mockImplementationOnce(createParentTaskStream({
        agent: "explore",
        prompt: "search codebase",
      }))
      .mockImplementationOnce(
        createTextStream("done", (messages) => {
          expect(messages).toEqual([
            { role: "user", content: "search codebase" },
          ]);
        }),
      );

    const events = await collect(parent);
    expect(extractTaskOutput(events)).toBe("<task_result>\ndone\n</task_result>");
  });

  it("creates and resumes persistent subagent sessions", async () => {
    const { store } = createMessageStore();
    const { entries, store: metadata } = createMetadataStore();
    const child = new Agent({
      name: "researcher",
      model: createModel(),
      instructions: false,
    });
    const parent = new Agent({
      name: "dev",
      model: createModel(),
      instructions: false,
      subagents: [child],
      subagentSessions: {
        messages: store,
        metadata,
      },
    });

    streamTextMock
      .mockImplementationOnce(createParentTaskStream({
        agent: "researcher",
        prompt: "Remember we use Postgres.",
        session: { mode: "new" },
      }))
      .mockImplementationOnce(
        createTextStream("Stored: Postgres", (messages) => {
          expect(messages).toEqual([
            { role: "user", content: "Remember we use Postgres." },
          ]);
        }),
      );

    const firstEvents = await collect(parent);
    const firstOutput = extractTaskOutput(firstEvents)!;
    const sessionId = extractSessionId(firstOutput);
    expect(sessionId).toBeTruthy();
    expect(firstOutput).toContain("<task_result session_id=");
    expect(entries.get(sessionId!)?.agentName).toBe("researcher");

    streamTextMock
      .mockImplementationOnce(createParentTaskStream({
        agent: "researcher",
        prompt: "What database did I mention?",
        session: { mode: "resume", id: sessionId },
      }))
      .mockImplementationOnce(
        createTextStream("You said Postgres.", (messages) => {
          expect(messages).toEqual([
            { role: "user", content: "Remember we use Postgres." },
            { role: "assistant", content: "Stored: Postgres" },
            { role: "user", content: "What database did I mention?" },
          ]);
        }),
      );

    const secondEvents = await collect(parent);
    expect(extractTaskOutput(secondEvents)).toContain(
      `session_id="${sessionId}"`,
    );
  });

  it("forks an existing subagent session into a new one", async () => {
    const { store } = createMessageStore();
    const { store: metadata } = createMetadataStore();
    const child = new Agent({
      name: "researcher",
      model: createModel(),
      instructions: false,
    });
    const parent = new Agent({
      name: "dev",
      model: createModel(),
      instructions: false,
      subagents: [child],
      subagentSessions: {
        messages: store,
        metadata,
      },
    });

    streamTextMock
      .mockImplementationOnce(createParentTaskStream({
        agent: "researcher",
        prompt: "Track auth findings.",
        session: { mode: "new" },
      }))
      .mockImplementationOnce(createTextStream("Auth findings saved."));

    const firstOutput = extractTaskOutput(await collect(parent))!;
    const originalSessionId = extractSessionId(firstOutput)!;

    streamTextMock
      .mockImplementationOnce(createParentTaskStream({
        agent: "researcher",
        prompt: "Take the alternative refactor path.",
        session: { mode: "fork", id: originalSessionId },
      }))
      .mockImplementationOnce(
        createTextStream("Forked branch ready.", (messages) => {
          expect(messages).toEqual([
            { role: "user", content: "Track auth findings." },
            { role: "assistant", content: "Auth findings saved." },
            { role: "user", content: "Take the alternative refactor path." },
          ]);
        }),
      );

    const forkedOutput = extractTaskOutput(await collect(parent))!;
    const forkedSessionId = extractSessionId(forkedOutput)!;
    expect(forkedSessionId).toBeTruthy();
    expect(forkedSessionId).not.toBe(originalSessionId);
  });

  it("supports dynamic subagent catalogs", async () => {
    const child = new Agent({
      name: "researcher",
      model: createModel(),
      instructions: false,
    });
    const catalog: SubagentCatalog = {
      list: vi.fn().mockResolvedValue([
        { name: "researcher", description: "Investigate code" },
      ]),
      resolve: vi.fn().mockResolvedValue(child),
    };
    const parent = new Agent({
      name: "dev",
      model: createModel(),
      instructions: false,
      subagents: catalog,
    });

    streamTextMock
      .mockImplementationOnce(createParentTaskStream({
        agent: "researcher",
        prompt: "Investigate the auth layer.",
      }))
      .mockImplementationOnce(createTextStream("Investigation complete."));

    const events = await collect(parent);
    expect(extractTaskOutput(events)).toBe(
      "<task_result>\nInvestigation complete.\n</task_result>",
    );
    expect(catalog.list).toHaveBeenCalledTimes(1);
    expect(catalog.resolve).toHaveBeenCalledWith("researcher");
  });
});
