import { describe, it, expect, vi } from "vitest";
import type { AgentEvent } from "../agent.js";
import type { Runner, Middleware } from "../runner.js";
import { toRunner, pipe, apply } from "../runner.js";

// ── Helpers ─────────────────────────────────────────────────────────

function createMockRunner(events: AgentEvent[]): Runner {
  return async function* () {
    for (const event of events) yield event;
  };
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const result: AgentEvent[] = [];
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

describe("runner", () => {
  describe("toRunner", () => {
    it("wraps an Agent-like object into a Runner", async () => {
      const mockAgent = {
        run: vi.fn(async function* () {
          yield { type: "text.delta" as const, text: "hello" };
          yield doneEvent;
        }),
      };

      const runner = toRunner(mockAgent as any);
      const events = await collect(runner([], "test"));

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: "text.delta", text: "hello" });
      expect(mockAgent.run).toHaveBeenCalledWith([], "test", undefined);
    });

    it("passes history, input, and options through", async () => {
      const mockAgent = {
        run: vi.fn(async function* () {
          yield doneEvent;
        }),
      };

      const history = [{ role: "user" as const, content: "hi" }];
      const signal = new AbortController().signal;
      const runner = toRunner(mockAgent as any);
      await collect(runner(history, "test", { signal }));

      expect(mockAgent.run).toHaveBeenCalledWith(history, "test", { signal });
    });
  });

  describe("pipe", () => {
    it("returns identity when no middleware provided", async () => {
      const runner = createMockRunner([doneEvent]);
      const piped = pipe()(runner);
      const events = await collect(piped([], "test"));

      expect(events).toEqual([doneEvent]);
    });

    it("composes middleware outermost first", async () => {
      const order: string[] = [];

      const outer: Middleware = (inner) =>
        async function* (h, i, o) {
          order.push("outer-before");
          yield* inner(h, i, o);
          order.push("outer-after");
        };

      const inner: Middleware = (inner) =>
        async function* (h, i, o) {
          order.push("inner-before");
          yield* inner(h, i, o);
          order.push("inner-after");
        };

      const runner = createMockRunner([doneEvent]);
      const piped = pipe(outer, inner)(runner);
      await collect(piped([], "test"));

      expect(order).toEqual([
        "outer-before",
        "inner-before",
        "inner-after",
        "outer-after",
      ]);
    });

    it("composes three middleware in correct order", async () => {
      const tags: string[] = [];

      const mw = (tag: string): Middleware => (inner) =>
        async function* (h, i, o) {
          tags.push(`${tag}-in`);
          yield* inner(h, i, o);
          tags.push(`${tag}-out`);
        };

      const runner = createMockRunner([doneEvent]);
      const piped = pipe(mw("a"), mw("b"), mw("c"))(runner);
      await collect(piped([], "test"));

      expect(tags).toEqual(["a-in", "b-in", "c-in", "c-out", "b-out", "a-out"]);
    });
  });

  describe("apply", () => {
    it("is shorthand for pipe(...mw)(runner)", async () => {
      const addPrefix: Middleware = (inner) =>
        async function* (h, i, o) {
          yield { type: "text.delta", text: "[prefix] " } as AgentEvent;
          yield* inner(h, i, o);
        };

      const runner = createMockRunner([
        { type: "text.delta", text: "hello" },
        doneEvent,
      ]);

      const applied = apply(runner, addPrefix);
      const events = await collect(applied([], "test"));

      expect(events).toHaveLength(3);
      expect(events[0]).toEqual({ type: "text.delta", text: "[prefix] " });
      expect(events[1]).toEqual({ type: "text.delta", text: "hello" });
    });

    it("applies multiple middleware in correct order", async () => {
      const tags: string[] = [];
      const mw = (tag: string): Middleware => (inner) =>
        async function* (h, i, o) {
          tags.push(`${tag}-in`);
          yield* inner(h, i, o);
          tags.push(`${tag}-out`);
        };

      const runner = createMockRunner([doneEvent]);
      const applied = apply(runner, mw("a"), mw("b"));
      await collect(applied([], "test"));

      expect(tags).toEqual(["a-in", "b-in", "b-out", "a-out"]);
    });

    it("with no middleware returns runner unchanged", async () => {
      const runner = createMockRunner([doneEvent]);
      const applied = apply(runner);
      const events = await collect(applied([], "test"));

      expect(events).toEqual([doneEvent]);
    });
  });

  describe("middleware modifying history", () => {
    it("middleware can modify history before passing to inner", async () => {
      let receivedHistory: any[] = [];
      const runner: Runner = async function* (history) {
        receivedHistory = [...history];
        yield doneEvent;
      };

      const addMessage: Middleware = (inner) =>
        async function* (h, i, o) {
          const modified = [...h, { role: "system" as const, content: "injected" }];
          yield* inner(modified, i, o);
        };

      const applied = apply(runner, addMessage);
      await collect(applied([{ role: "user", content: "hi" }], "test"));

      expect(receivedHistory).toEqual([
        { role: "user", content: "hi" },
        { role: "system", content: "injected" },
      ]);
    });
  });
});
