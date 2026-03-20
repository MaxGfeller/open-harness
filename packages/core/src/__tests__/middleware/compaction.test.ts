import { describe, it, expect, vi } from "vitest";
import type { AgentEvent } from "../../agent.js";
import type { Runner } from "../../runner.js";
import type { CompactionStrategy, CompactionContext } from "../../session.js";
import { withCompaction } from "../../middleware/compaction.js";

// ── Helpers ─────────────────────────────────────────────────────────

async function collect(gen: AsyncGenerator<any>): Promise<any[]> {
  const result: any[] = [];
  for await (const event of gen) result.push(event);
  return result;
}

const doneEvent: AgentEvent = {
  type: "done",
  result: "complete",
  messages: [],
  totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
};

function createMockStrategy(
  result?: Partial<{
    messages: any[];
    summary: string;
    messagesRemoved: number;
    tokensPruned: number;
  }>,
): CompactionStrategy {
  return {
    compact: vi.fn().mockResolvedValue({
      messages: result?.messages ?? [{ role: "user", content: "compacted" }],
      summary: result?.summary,
      messagesRemoved: result?.messagesRemoved ?? 5,
      tokensPruned: result?.tokensPruned ?? 10000,
    }),
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("withCompaction", () => {
  it("does not compact when under threshold", async () => {
    const strategy = createMockStrategy();
    const runner: Runner = async function* () {
      yield doneEvent;
    };

    const compacted = withCompaction({
      contextWindow: 200_000,
      model: {} as any,
      strategy,
    })(runner);

    // lastInputTokens starts at 0, threshold is 200_000 - 20_000 = 180_000
    const events = await collect(compacted([], "test"));

    expect(strategy.compact).not.toHaveBeenCalled();
    expect(events.find((e: any) => e.type === "compaction.start")).toBeUndefined();
  });

  it("compacts when over threshold", async () => {
    const strategy = createMockStrategy({ tokensPruned: 50000 });
    let receivedHistory: any[] = [];

    const runner: Runner = async function* (history) {
      receivedHistory = [...history];
      // Emit step.done with high inputTokens to trigger next compaction
      yield {
        type: "step.done",
        stepNumber: 1,
        usage: { inputTokens: 190_000, outputTokens: 100, totalTokens: 190_100 },
        finishReason: "stop",
      } as AgentEvent;
      yield doneEvent;
    };

    const compacted = withCompaction({
      contextWindow: 200_000,
      model: {} as any,
      strategy,
    })(runner);

    // First call: no compaction (lastInputTokens = 0)
    const history = [{ role: "user" as const, content: "a long conversation" }];
    await collect(compacted(history, "test"));
    expect(strategy.compact).not.toHaveBeenCalled();

    // Second call: should compact (lastInputTokens = 190_000 >= 180_000)
    const events2 = await collect(compacted(history, "test2"));
    expect(strategy.compact).toHaveBeenCalled();

    const compactionStart = events2.find((e: any) => e.type === "compaction.start");
    expect(compactionStart).toBeDefined();
    expect(compactionStart.reason).toBe("overflow");

    const compactionDone = events2.find((e: any) => e.type === "compaction.done");
    expect(compactionDone).toBeDefined();

    // Runner should receive compacted history
    expect(receivedHistory).toEqual([{ role: "user", content: "compacted" }]);
  });

  it("yields compaction lifecycle events", async () => {
    const strategy = createMockStrategy({
      tokensPruned: 5000,
      summary: "A summary",
      messagesRemoved: 3,
    });

    const runner: Runner = async function* () {
      yield {
        type: "step.done",
        stepNumber: 1,
        usage: { inputTokens: 190_000, outputTokens: 100, totalTokens: 190_100 },
        finishReason: "stop",
      } as AgentEvent;
      yield doneEvent;
    };

    const compacted = withCompaction({
      contextWindow: 200_000,
      model: {} as any,
      strategy,
    })(runner);

    // First call to set lastInputTokens
    const history = [{ role: "user" as const, content: "stuff" }];
    await collect(compacted(history, "test"));

    // Second call triggers compaction
    const events = await collect(compacted(history, "test2"));

    const types = events.map((e: any) => e.type);
    expect(types).toContain("compaction.start");
    expect(types).toContain("compaction.pruned");
    expect(types).toContain("compaction.summary");
    expect(types).toContain("compaction.done");
  });

  it("supports custom shouldCompact", async () => {
    const strategy = createMockStrategy({ tokensPruned: 100 });
    const runner: Runner = async function* () {
      yield doneEvent;
    };

    const compacted = withCompaction({
      contextWindow: 200_000,
      model: {} as any,
      strategy,
      shouldCompact: () => true, // Always compact
    })(runner);

    const history = [{ role: "user" as const, content: "hi" }];
    const events = await collect(compacted(history, "test"));

    expect(strategy.compact).toHaveBeenCalled();
    expect(events.find((e: any) => e.type === "compaction.start")).toBeDefined();
  });

  it("does not compact on empty history", async () => {
    const strategy = createMockStrategy();
    const runner: Runner = async function* () {
      yield doneEvent;
    };

    const compacted = withCompaction({
      contextWindow: 200_000,
      model: {} as any,
      strategy,
      shouldCompact: () => true,
    })(runner);

    const events = await collect(compacted([], "test"));
    expect(strategy.compact).not.toHaveBeenCalled();
  });

  it("tracks lastInputTokens from step.done events across calls", async () => {
    const strategy = createMockStrategy();
    const runner: Runner = async function* () {
      yield {
        type: "step.done",
        stepNumber: 1,
        usage: { inputTokens: 50_000, outputTokens: 100, totalTokens: 50_100 },
        finishReason: "stop",
      } as AgentEvent;
      yield doneEvent;
    };

    const shouldCompact = vi.fn().mockReturnValue(false);
    const compacted = withCompaction({
      contextWindow: 200_000,
      model: {} as any,
      strategy,
      shouldCompact,
    })(runner);

    await collect(compacted([], "first"));
    await collect(compacted([], "second"));

    // On second call, shouldCompact should see lastInputTokens from first call
    expect(shouldCompact).toHaveBeenCalledTimes(2);
    expect(shouldCompact.mock.calls[1][0].lastInputTokens).toBe(50_000);
  });

  it("skips compaction.pruned when tokensPruned is 0", async () => {
    const strategy = createMockStrategy({ tokensPruned: 0, messagesRemoved: 0 });
    const runner: Runner = async function* () {
      yield doneEvent;
    };

    const compacted = withCompaction({
      contextWindow: 200_000,
      model: {} as any,
      strategy,
      shouldCompact: () => true,
    })(runner);

    const history = [{ role: "user" as const, content: "hi" }];
    const events = await collect(compacted(history, "test"));

    expect(events.find((e: any) => e.type === "compaction.pruned")).toBeUndefined();
    expect(events.find((e: any) => e.type === "compaction.start")).toBeDefined();
    expect(events.find((e: any) => e.type === "compaction.done")).toBeDefined();
  });

  it("skips compaction.summary when no summary returned", async () => {
    const strategy = createMockStrategy({
      tokensPruned: 5000,
      summary: undefined,
    });
    const runner: Runner = async function* () {
      yield doneEvent;
    };

    const compacted = withCompaction({
      contextWindow: 200_000,
      model: {} as any,
      strategy,
      shouldCompact: () => true,
    })(runner);

    const history = [{ role: "user" as const, content: "hi" }];
    const events = await collect(compacted(history, "test"));

    expect(events.find((e: any) => e.type === "compaction.summary")).toBeUndefined();
  });

  it("uses last step.done when multiple are emitted", async () => {
    const strategy = createMockStrategy();
    const runner: Runner = async function* () {
      yield {
        type: "step.done",
        stepNumber: 1,
        usage: { inputTokens: 10_000, outputTokens: 100, totalTokens: 10_100 },
        finishReason: "tool-calls",
      } as AgentEvent;
      yield {
        type: "step.done",
        stepNumber: 2,
        usage: { inputTokens: 60_000, outputTokens: 200, totalTokens: 60_200 },
        finishReason: "stop",
      } as AgentEvent;
      yield doneEvent;
    };

    const shouldCompact = vi.fn().mockReturnValue(false);
    const compacted = withCompaction({
      contextWindow: 200_000,
      model: {} as any,
      strategy,
      shouldCompact,
    })(runner);

    await collect(compacted([], "first"));
    await collect(compacted([], "second"));

    // Should see last step.done's inputTokens (60_000)
    expect(shouldCompact.mock.calls[1][0].lastInputTokens).toBe(60_000);
  });

  it("uses custom reservedTokens", async () => {
    const strategy = createMockStrategy();
    const runner: Runner = async function* () {
      yield {
        type: "step.done",
        stepNumber: 1,
        usage: { inputTokens: 160_000, outputTokens: 100, totalTokens: 160_100 },
        finishReason: "stop",
      } as AgentEvent;
      yield doneEvent;
    };

    // With reservedTokens: 50_000, threshold = 200_000 - 50_000 = 150_000
    // 160_000 >= 150_000 → should compact
    const compacted = withCompaction({
      contextWindow: 200_000,
      model: {} as any,
      strategy,
      reservedTokens: 50_000,
    })(runner);

    const history = [{ role: "user" as const, content: "hi" }];
    await collect(compacted(history, "first"));
    const events2 = await collect(compacted(history, "second"));

    expect(strategy.compact).toHaveBeenCalled();
    expect(events2.find((e: any) => e.type === "compaction.start")).toBeDefined();
  });

  it("propagates strategy errors", async () => {
    const strategy: CompactionStrategy = {
      compact: vi.fn().mockRejectedValue(new Error("compaction failed")),
    };
    const runner: Runner = async function* () {
      yield doneEvent;
    };

    const compacted = withCompaction({
      contextWindow: 200_000,
      model: {} as any,
      strategy,
      shouldCompact: () => true,
    })(runner);

    const history = [{ role: "user" as const, content: "hi" }];
    await expect(collect(compacted(history, "test"))).rejects.toThrow("compaction failed");
  });
});
