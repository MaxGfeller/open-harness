import { describe, it, expect, vi } from "vitest";
import type { AgentEvent } from "../../agent.js";
import type { Runner } from "../../runner.js";
import { withPersistence } from "../../middleware/persistence.js";

// ── Helpers ─────────────────────────────────────────────────────────

function createMockRunner(events: AgentEvent[]): Runner {
  return async function* () {
    for (const event of events) yield event;
  };
}

async function collect(gen: AsyncGenerator<any>): Promise<any[]> {
  const result: any[] = [];
  for await (const event of gen) result.push(event);
  return result;
}

const messages = [
  { role: "user" as const, content: "hi" },
  { role: "assistant" as const, content: "hello" },
];

const doneEvent: AgentEvent = {
  type: "done",
  result: "complete",
  messages,
  totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
};

// ── Tests ───────────────────────────────────────────────────────────

describe("withPersistence", () => {
  it("saves messages on done event", async () => {
    const store = {
      load: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
    };

    const runner = createMockRunner([
      { type: "text.delta", text: "hello" },
      doneEvent,
    ]);
    const persisted = withPersistence({ store, sessionId: "s1" })(runner);
    await collect(persisted([], "test"));

    expect(store.save).toHaveBeenCalledOnce();
    expect(store.save).toHaveBeenCalledWith("s1", messages);
  });

  it("does not save when no done event", async () => {
    const store = {
      load: vi.fn(),
      save: vi.fn(),
    };

    const runner = createMockRunner([
      { type: "text.delta", text: "hello" },
    ]);
    const persisted = withPersistence({ store, sessionId: "s1" })(runner);
    await collect(persisted([], "test"));

    expect(store.save).not.toHaveBeenCalled();
  });

  it("passes all events through unchanged", async () => {
    const store = {
      load: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
    };

    const events: AgentEvent[] = [
      { type: "text.delta", text: "hello" },
      { type: "text.done", text: "hello" },
      doneEvent,
    ];
    const runner = createMockRunner(events);
    const persisted = withPersistence({ store, sessionId: "s1" })(runner);
    const result = await collect(persisted([], "test"));

    expect(result).toEqual(events);
  });

  it("propagates store.save errors", async () => {
    const store = {
      load: vi.fn(),
      save: vi.fn().mockRejectedValue(new Error("disk full")),
    };

    const runner = createMockRunner([doneEvent]);
    const persisted = withPersistence({ store, sessionId: "s1" })(runner);

    await expect(collect(persisted([], "test"))).rejects.toThrow("disk full");
  });

  it("uses the provided sessionId", async () => {
    const store = {
      load: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
    };

    const runner = createMockRunner([doneEvent]);
    const persisted = withPersistence({ store, sessionId: "custom-id" })(runner);
    await collect(persisted([], "test"));

    expect(store.save).toHaveBeenCalledWith("custom-id", expect.any(Array));
  });
});
