import { describe, it, expect, vi } from "vitest";
import type { AgentEvent } from "../../agent.js";
import type { Runner } from "../../runner.js";
import { withHooks } from "../../middleware/hooks.js";

// ── Helpers ─────────────────────────────────────────────────────────

async function collect(gen: AsyncGenerator<any>): Promise<any[]> {
  const result: any[] = [];
  for await (const event of gen) result.push(event);
  return result;
}

const doneEvent: AgentEvent = {
  type: "done",
  result: "complete",
  messages: [{ role: "user", content: "hi" }],
  totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
};

// ── Tests ───────────────────────────────────────────────────────────

describe("withHooks", () => {
  describe("onBeforeSend", () => {
    it("modifies history before passing to inner runner", async () => {
      const receivedHistory: any[] = [];
      const runner: Runner = async function* (history) {
        receivedHistory.push(...history);
        yield doneEvent;
      };

      const hooked = withHooks({
        onBeforeSend: (msgs) => [...msgs, { role: "user", content: "injected" }],
      })(runner);

      await collect(hooked([{ role: "user", content: "original" }], "test"));

      expect(receivedHistory).toEqual([
        { role: "user", content: "original" },
        { role: "user", content: "injected" },
      ]);
    });
  });

  describe("onAfterResponse", () => {
    it("is called after done event with turn info", async () => {
      const onAfterResponse = vi.fn();
      const runner: Runner = async function* () {
        yield doneEvent;
      };

      const hooked = withHooks({ onAfterResponse })(runner);
      await collect(hooked([], "test"));

      expect(onAfterResponse).toHaveBeenCalledOnce();
      expect(onAfterResponse).toHaveBeenCalledWith({
        turnNumber: 0,
        messages: doneEvent.messages,
        usage: doneEvent.totalUsage,
      });
    });

    it("is not called when no done event", async () => {
      const onAfterResponse = vi.fn();
      const runner: Runner = async function* () {
        yield { type: "text.delta", text: "hi" } as AgentEvent;
      };

      const hooked = withHooks({ onAfterResponse })(runner);
      await collect(hooked([], "test"));

      expect(onAfterResponse).not.toHaveBeenCalled();
    });
  });

  describe("onError", () => {
    it("can suppress error events", async () => {
      const runner: Runner = async function* () {
        yield { type: "error", error: new Error("transient") } as AgentEvent;
        yield doneEvent;
      };

      const hooked = withHooks({
        onError: () => true,
      })(runner);
      const events = await collect(hooked([], "test"));

      expect(events.find((e: any) => e.type === "error")).toBeUndefined();
      expect(events.find((e: any) => e.type === "done")).toBeDefined();
    });

    it("passes through errors when onError returns false", async () => {
      const runner: Runner = async function* () {
        yield { type: "error", error: new Error("fatal") } as AgentEvent;
        yield doneEvent;
      };

      const hooked = withHooks({
        onError: () => false,
      })(runner);
      const events = await collect(hooked([], "test"));

      expect(events.find((e: any) => e.type === "error")).toBeDefined();
    });

    it("passes through errors when onError returns undefined", async () => {
      const runner: Runner = async function* () {
        yield { type: "error", error: new Error("fatal") } as AgentEvent;
        yield doneEvent;
      };

      const hooked = withHooks({
        onError: () => {},
      })(runner);
      const events = await collect(hooked([], "test"));

      expect(events.find((e: any) => e.type === "error")).toBeDefined();
    });

    it("receives the error object", async () => {
      const receivedErrors: Error[] = [];
      const runner: Runner = async function* () {
        yield { type: "error", error: new Error("check-me") } as AgentEvent;
        yield doneEvent;
      };

      const hooked = withHooks({
        onError: (err) => {
          receivedErrors.push(err);
          return false;
        },
      })(runner);
      await collect(hooked([], "test"));

      expect(receivedErrors).toHaveLength(1);
      expect(receivedErrors[0].message).toBe("check-me");
    });
  });

  describe("no hooks provided", () => {
    it("passes history and events through unchanged without hooks", async () => {
      let receivedHistory: any[] = [];
      const runner: Runner = async function* (history) {
        receivedHistory = [...history];
        yield { type: "text.delta", text: "hi" } as AgentEvent;
        yield doneEvent;
      };

      const hooked = withHooks({})(runner);
      const history = [{ role: "user", content: "original" }];
      const events = await collect(hooked(history as any, "test"));

      expect(receivedHistory).toEqual(history);
      expect(events).toHaveLength(2);
    });
  });

  describe("async hooks", () => {
    it("supports async onBeforeSend", async () => {
      const runner: Runner = async function* (history) {
        yield doneEvent;
      };

      const hooked = withHooks({
        onBeforeSend: async (msgs) => {
          await new Promise((r) => setTimeout(r, 1));
          return [...msgs, { role: "user", content: "async-injected" }];
        },
      })(runner);

      let receivedHistory: any[] = [];
      const captureRunner: Runner = async function* (history) {
        receivedHistory = [...history];
        yield doneEvent;
      };
      const hooked2 = withHooks({
        onBeforeSend: async (msgs) => [...msgs, { role: "user", content: "async" }],
      })(captureRunner);

      await collect(hooked2([], "test"));
      expect(receivedHistory).toEqual([{ role: "user", content: "async" }]);
    });

    it("supports async onAfterResponse", async () => {
      let called = false;
      const runner: Runner = async function* () {
        yield doneEvent;
      };

      const hooked = withHooks({
        onAfterResponse: async () => {
          await new Promise((r) => setTimeout(r, 1));
          called = true;
        },
      })(runner);
      await collect(hooked([], "test"));

      expect(called).toBe(true);
    });
  });
});
