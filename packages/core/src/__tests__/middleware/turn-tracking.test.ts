import { describe, it, expect } from "vitest";
import type { AgentEvent } from "../../agent.js";
import type { Runner } from "../../runner.js";
import { withTurnTracking } from "../../middleware/turn-tracking.js";

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

const doneEvent: AgentEvent = {
  type: "done",
  result: "complete",
  messages: [],
  totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
};

// ── Tests ───────────────────────────────────────────────────────────

describe("withTurnTracking", () => {
  it("wraps events with turn.start and turn.done", async () => {
    const runner = createMockRunner([
      { type: "text.delta", text: "hi" },
      doneEvent,
    ]);
    const tracked = withTurnTracking()(runner);
    const events = await collect(tracked([], "test"));

    expect(events[0]).toEqual({ type: "turn.start", turnNumber: 1 });
    expect(events[events.length - 1]).toMatchObject({
      type: "turn.done",
      turnNumber: 1,
    });
  });

  it("increments turn counter across calls", async () => {
    const runner = createMockRunner([doneEvent]);
    const tracked = withTurnTracking()(runner);

    const events1 = await collect(tracked([], "first"));
    const events2 = await collect(tracked([], "second"));

    expect(events1[0]).toEqual({ type: "turn.start", turnNumber: 1 });
    expect(events2[0]).toEqual({ type: "turn.start", turnNumber: 2 });
  });

  it("reports usage from done event in turn.done", async () => {
    const runner = createMockRunner([doneEvent]);
    const tracked = withTurnTracking()(runner);
    const events = await collect(tracked([], "test"));

    const turnDone = events.find((e: any) => e.type === "turn.done");
    expect(turnDone.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
  });

  it("passes through all inner events", async () => {
    const innerEvents: AgentEvent[] = [
      { type: "text.delta", text: "a" },
      { type: "text.done", text: "a" },
      doneEvent,
    ];
    const runner = createMockRunner(innerEvents);
    const tracked = withTurnTracking()(runner);
    const events = await collect(tracked([], "test"));

    // turn.start + 3 inner events + turn.done
    expect(events).toHaveLength(5);
    expect(events.slice(1, 4)).toEqual(innerEvents);
  });

  it("reports undefined usage when no done event", async () => {
    const runner = createMockRunner([
      { type: "text.delta", text: "hi" },
    ]);
    const tracked = withTurnTracking()(runner);
    const events = await collect(tracked([], "test"));

    const turnDone = events.find((e: any) => e.type === "turn.done");
    expect(turnDone.usage).toEqual({
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
    });
  });

  it("each withTurnTracking() call creates independent counters", async () => {
    const runner = createMockRunner([doneEvent]);

    const tracked1 = withTurnTracking()(runner);
    const tracked2 = withTurnTracking()(runner);

    const events1 = await collect(tracked1([], "test"));
    const events2 = await collect(tracked2([], "test"));

    // Both should start at 1 (independent closures)
    expect(events1[0]).toEqual({ type: "turn.start", turnNumber: 1 });
    expect(events2[0]).toEqual({ type: "turn.start", turnNumber: 1 });
  });
});
