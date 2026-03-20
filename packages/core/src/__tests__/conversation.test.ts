import { describe, it, expect, vi } from "vitest";
import type { AgentEvent } from "../agent.js";
import type { Runner } from "../runner.js";
import type { SessionEvent } from "../session.js";
import { Conversation } from "../conversation.js";

// ── Helpers ─────────────────────────────────────────────────────────

const makeMessages = () => [
  { role: "user" as const, content: "hi" },
  { role: "assistant" as const, content: "hello" },
];

function createMockRunner(events: AgentEvent[]): Runner {
  return async function* () {
    for (const event of events) yield event;
  };
}

async function collectEvents(gen: AsyncGenerator<SessionEvent>): Promise<SessionEvent[]> {
  const result: SessionEvent[] = [];
  for await (const event of gen) result.push(event);
  return result;
}

const doneEvent: AgentEvent = {
  type: "done",
  result: "complete",
  messages: makeMessages(),
  totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
};

// ── Tests ───────────────────────────────────────────────────────────

describe("Conversation", () => {
  it("updates messages from done events", async () => {
    const runner = createMockRunner([
      { type: "text.delta", text: "hello" },
      doneEvent,
    ]);
    const conv = new Conversation({ runner });

    expect(conv.messages).toEqual([]);
    await collectEvents(conv.send("hi"));
    expect(conv.messages).toEqual(makeMessages());
  });

  it("yields all events from the runner", async () => {
    const events: AgentEvent[] = [
      { type: "text.delta", text: "hello" },
      { type: "text.done", text: "hello" },
      doneEvent,
    ];
    const runner = createMockRunner(events);
    const conv = new Conversation({ runner });

    const collected = await collectEvents(conv.send("hi"));
    expect(collected).toEqual(events);
  });

  it("passes messages as history to subsequent calls", async () => {
    const histories: any[] = [];
    const runner: Runner = async function* (history, input) {
      histories.push([...history]);
      yield {
        type: "done",
        result: "complete",
        messages: [...history, { role: "user", content: input }, { role: "assistant", content: "ok" }],
        totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      } as AgentEvent;
    };

    const conv = new Conversation({ runner });

    await collectEvents(conv.send("first"));
    await collectEvents(conv.send("second"));

    expect(histories[0]).toEqual([]);
    expect(histories[1]).toHaveLength(2);
  });

  describe("load/save", () => {
    it("load returns false without store", async () => {
      const conv = new Conversation({ runner: createMockRunner([]) });
      expect(await conv.load()).toBe(false);
    });

    it("save is a no-op without store", async () => {
      const conv = new Conversation({ runner: createMockRunner([]) });
      await conv.save(); // should not throw
    });

    it("load populates messages from store", async () => {
      const store = {
        load: vi.fn().mockResolvedValue(makeMessages()),
        save: vi.fn(),
      };
      const conv = new Conversation({
        runner: createMockRunner([]),
        store,
        sessionId: "test-session",
      });

      const loaded = await conv.load();
      expect(loaded).toBe(true);
      expect(conv.messages).toEqual(makeMessages());
      expect(store.load).toHaveBeenCalledWith("test-session");
    });

    it("load returns false when store returns undefined", async () => {
      const store = {
        load: vi.fn().mockResolvedValue(undefined),
        save: vi.fn(),
      };
      const conv = new Conversation({ runner: createMockRunner([]), store });

      expect(await conv.load()).toBe(false);
      expect(conv.messages).toEqual([]);
    });

    it("save persists messages to store", async () => {
      const store = {
        load: vi.fn(),
        save: vi.fn(),
      };
      const conv = new Conversation({
        runner: createMockRunner([doneEvent]),
        store,
        sessionId: "test-session",
      });

      await collectEvents(conv.send("hi"));
      await conv.save();

      expect(store.save).toHaveBeenCalledWith("test-session", makeMessages());
    });
  });

  it("generates a sessionId when not provided", () => {
    const conv = new Conversation({ runner: createMockRunner([]) });
    expect(conv.sessionId).toBeTruthy();
    expect(typeof conv.sessionId).toBe("string");
  });

  it("uses provided sessionId", () => {
    const conv = new Conversation({
      runner: createMockRunner([]),
      sessionId: "my-session",
    });
    expect(conv.sessionId).toBe("my-session");
  });

  describe("send with options", () => {
    it("passes abort signal to the runner", async () => {
      let receivedSignal: AbortSignal | undefined;
      const runner: Runner = async function* (_h, _i, options) {
        receivedSignal = options?.signal;
        yield doneEvent;
      };

      const controller = new AbortController();
      const conv = new Conversation({ runner });
      await collectEvents(conv.send("hi", { signal: controller.signal }));

      expect(receivedSignal).toBe(controller.signal);
    });

    it("accepts array input", async () => {
      let receivedInput: any;
      const runner: Runner = async function* (_h, input) {
        receivedInput = input;
        yield doneEvent;
      };

      const conv = new Conversation({ runner });
      const arrayInput = [{ role: "user" as const, content: "array msg" }];
      await collectEvents(conv.send(arrayInput));

      expect(receivedInput).toEqual(arrayInput);
    });
  });

  describe("error handling", () => {
    it("propagates runner errors", async () => {
      const runner: Runner = async function* () {
        throw new Error("runner exploded");
      };

      const conv = new Conversation({ runner });
      await expect(collectEvents(conv.send("hi"))).rejects.toThrow("runner exploded");
    });

    it("does not update messages if no done event before error", async () => {
      const runner: Runner = async function* () {
        yield { type: "text.delta", text: "partial" } as AgentEvent;
        throw new Error("oops");
      };

      const conv = new Conversation({ runner });
      try {
        await collectEvents(conv.send("hi"));
      } catch {}

      expect(conv.messages).toEqual([]);
    });
  });

  describe("toUIMessageStream", () => {
    it("returns a ReadableStream", () => {
      const conv = new Conversation({ runner: createMockRunner([doneEvent]) });
      const stream = conv.toUIMessageStream("hi");
      expect(stream).toBeInstanceOf(ReadableStream);
    });

    it("produces chunks from runner events", async () => {
      const runner = createMockRunner([
        { type: "text.delta", text: "hello" },
        { type: "text.done", text: "hello" },
        doneEvent,
      ]);
      const conv = new Conversation({ runner });
      const stream = conv.toUIMessageStream("hi");

      const reader = stream.getReader();
      const chunks: any[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].type).toBe("start");
      expect(chunks.find((c: any) => c.type === "text-delta")).toBeDefined();
      expect(chunks.find((c: any) => c.type === "finish")).toBeDefined();
    });
  });

  describe("toResponse", () => {
    it("returns a Response object", () => {
      const conv = new Conversation({ runner: createMockRunner([doneEvent]) });
      const response = conv.toResponse("hi");
      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
    });
  });
});
