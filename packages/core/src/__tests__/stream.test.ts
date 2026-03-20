import { describe, it, expect, vi } from "vitest";
import type { AgentEvent } from "../agent.js";
import { tap, filter, map, takeUntil } from "../stream.js";

// ── Helpers ─────────────────────────────────────────────────────────

async function collect(gen: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const result: AgentEvent[] = [];
  for await (const event of gen) result.push(event);
  return result;
}

async function* fromArray(events: AgentEvent[]): AsyncGenerator<AgentEvent> {
  for (const event of events) yield event;
}

const doneEvent: AgentEvent = {
  type: "done",
  result: "complete",
  messages: [],
  totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
};

// ── Tests ───────────────────────────────────────────────────────────

describe("stream combinators", () => {
  describe("tap", () => {
    it("calls fn for each event without modifying the stream", async () => {
      const seen: string[] = [];
      const events: AgentEvent[] = [
        { type: "text.delta", text: "a" },
        { type: "text.delta", text: "b" },
        doneEvent,
      ];

      const result = await collect(tap((e) => seen.push(e.type))(fromArray(events)));

      expect(result).toEqual(events);
      expect(seen).toEqual(["text.delta", "text.delta", "done"]);
    });

    it("returns all events unchanged", async () => {
      const events: AgentEvent[] = [
        { type: "step.start", stepNumber: 1 },
        doneEvent,
      ];

      const result = await collect(tap(() => {})(fromArray(events)));
      expect(result).toEqual(events);
    });
  });

  describe("filter", () => {
    it("drops events that don't match the predicate", async () => {
      const events: AgentEvent[] = [
        { type: "text.delta", text: "a" },
        { type: "reasoning.delta", text: "think" },
        { type: "text.delta", text: "b" },
        doneEvent,
      ];

      const result = await collect(
        filter((e) => e.type !== "reasoning.delta")(fromArray(events)),
      );

      expect(result).toHaveLength(3);
      expect(result.map((e) => e.type)).toEqual(["text.delta", "text.delta", "done"]);
    });

    it("never filters done events", async () => {
      const events: AgentEvent[] = [
        { type: "text.delta", text: "a" },
        doneEvent,
      ];

      // Predicate rejects everything
      const result = await collect(filter(() => false)(fromArray(events)));

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("done");
    });
  });

  describe("map", () => {
    it("transforms each event", async () => {
      const events: AgentEvent[] = [
        { type: "text.delta", text: "hello" },
        doneEvent,
      ];

      const result = await collect(
        map((e) => (e.type === "text.delta" ? { ...e, text: e.text.toUpperCase() } : e))(
          fromArray(events),
        ),
      );

      expect(result[0]).toEqual({ type: "text.delta", text: "HELLO" });
      expect(result[1]).toEqual(doneEvent);
    });
  });

  describe("takeUntil", () => {
    it("stops after predicate matches (inclusive)", async () => {
      const events: AgentEvent[] = [
        { type: "text.delta", text: "a" },
        { type: "text.delta", text: "b" },
        { type: "text.done", text: "ab" },
        { type: "text.delta", text: "c" },
        doneEvent,
      ];

      const result = await collect(
        takeUntil((e) => e.type === "text.done")(fromArray(events)),
      );

      expect(result).toHaveLength(3);
      expect(result[2]).toEqual({ type: "text.done", text: "ab" });
    });

    it("yields all events if predicate never matches", async () => {
      const events: AgentEvent[] = [
        { type: "text.delta", text: "a" },
        doneEvent,
      ];

      const result = await collect(takeUntil(() => false)(fromArray(events)));
      expect(result).toEqual(events);
    });

    it("stops on first event if predicate matches immediately", async () => {
      const events: AgentEvent[] = [
        { type: "text.delta", text: "stop" },
        { type: "text.delta", text: "never" },
        doneEvent,
      ];

      const result = await collect(
        takeUntil((e) => e.type === "text.delta")(fromArray(events)),
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ type: "text.delta", text: "stop" });
    });
  });

  describe("chaining", () => {
    it("composes multiple transforms", async () => {
      const events: AgentEvent[] = [
        { type: "text.delta", text: "hello" },
        { type: "reasoning.delta", text: "think" },
        { type: "text.delta", text: "world" },
        doneEvent,
      ];

      // Filter out reasoning, then uppercase text deltas
      const filtered = filter((e) => e.type !== "reasoning.delta");
      const mapped = map((e) =>
        e.type === "text.delta" ? { ...e, text: e.text.toUpperCase() } : e,
      );

      const result = await collect(mapped(filtered(fromArray(events))));

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ type: "text.delta", text: "HELLO" });
      expect(result[1]).toEqual({ type: "text.delta", text: "WORLD" });
      expect(result[2]).toEqual(doneEvent);
    });
  });

  describe("empty stream", () => {
    it("tap handles empty stream", async () => {
      const result = await collect(tap(() => {})(fromArray([])));
      expect(result).toEqual([]);
    });

    it("filter handles empty stream", async () => {
      const result = await collect(filter(() => true)(fromArray([])));
      expect(result).toEqual([]);
    });

    it("map handles empty stream", async () => {
      const result = await collect(map((e) => e)(fromArray([])));
      expect(result).toEqual([]);
    });

    it("takeUntil handles empty stream", async () => {
      const result = await collect(takeUntil(() => true)(fromArray([])));
      expect(result).toEqual([]);
    });
  });
});
