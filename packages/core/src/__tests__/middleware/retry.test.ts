import { describe, it, expect, vi } from "vitest";
import type { AgentEvent } from "../../agent.js";
import type { Runner } from "../../runner.js";
import { withRetry } from "../../middleware/retry.js";

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

// ── Tests ───────────────────────────────────────────────────────────

describe("withRetry", () => {
  it("passes through events on success", async () => {
    const runner: Runner = async function* () {
      yield { type: "text.delta", text: "hello" } as AgentEvent;
      yield doneEvent;
    };

    const retried = withRetry({ maxRetries: 3, initialDelayMs: 1 })(runner);
    const events = await collect(retried([], "test"));

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("text.delta");
    expect(events[1].type).toBe("done");
  });

  it("retries on retryable error before content", async () => {
    let callCount = 0;
    const runner: Runner = async function* () {
      callCount++;
      if (callCount === 1) {
        yield { type: "error", error: new Error("429 rate limit") } as AgentEvent;
        yield {
          type: "done",
          result: "error",
          messages: [],
          totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        } as AgentEvent;
        return;
      }
      yield { type: "text.delta", text: "success" } as AgentEvent;
      yield doneEvent;
    };

    const retried = withRetry({ maxRetries: 3, initialDelayMs: 1 })(runner);
    const events = await collect(retried([], "test"));

    expect(callCount).toBe(2);
    const retryEvents = events.filter((e: any) => e.type === "retry");
    expect(retryEvents).toHaveLength(1);
    expect(retryEvents[0].attempt).toBe(0);
  });

  it("does not retry after content has been yielded", async () => {
    let callCount = 0;
    const runner: Runner = async function* () {
      callCount++;
      yield { type: "text.delta", text: "content" } as AgentEvent;
      yield { type: "error", error: new Error("429 rate limit") } as AgentEvent;
      yield doneEvent;
    };

    const retried = withRetry({ maxRetries: 3, initialDelayMs: 1 })(runner);
    const events = await collect(retried([], "test"));

    expect(callCount).toBe(1);
    expect(events.filter((e: any) => e.type === "retry")).toHaveLength(0);
    // Error should pass through
    expect(events.find((e: any) => e.type === "error")).toBeDefined();
  });

  it("does not retry non-retryable errors", async () => {
    let callCount = 0;
    const runner: Runner = async function* () {
      callCount++;
      yield { type: "error", error: new Error("invalid input") } as AgentEvent;
      yield {
        type: "done",
        result: "error",
        messages: [],
        totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      } as AgentEvent;
    };

    const retried = withRetry({ maxRetries: 3, initialDelayMs: 1 })(runner);
    const events = await collect(retried([], "test"));

    expect(callCount).toBe(1);
    expect(events.filter((e: any) => e.type === "retry")).toHaveLength(0);
  });

  it("retries on thrown retryable errors", async () => {
    let callCount = 0;
    const runner: Runner = async function* () {
      callCount++;
      if (callCount === 1) {
        throw new Error("503 service unavailable");
      }
      yield doneEvent;
    };

    const retried = withRetry({ maxRetries: 3, initialDelayMs: 1 })(runner);
    const events = await collect(retried([], "test"));

    expect(callCount).toBe(2);
    expect(events.filter((e: any) => e.type === "retry")).toHaveLength(1);
  });

  it("throws non-retryable thrown errors", async () => {
    const runner: Runner = async function* () {
      throw new Error("bug in code");
    };

    const retried = withRetry({ maxRetries: 3, initialDelayMs: 1 })(runner);
    await expect(collect(retried([], "test"))).rejects.toThrow("bug in code");
  });

  it("gives up after maxRetries", async () => {
    let callCount = 0;
    const runner: Runner = async function* () {
      callCount++;
      yield { type: "error", error: new Error("429 rate limit") } as AgentEvent;
      yield {
        type: "done",
        result: "error",
        messages: [],
        totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      } as AgentEvent;
    };

    const retried = withRetry({ maxRetries: 2, initialDelayMs: 1 })(runner);
    const events = await collect(retried([], "test"));

    // 1 initial + 2 retries = 3 calls
    expect(callCount).toBe(3);
    // Last attempt's error should pass through (not retried)
    const errorEvents = events.filter((e: any) => e.type === "error");
    expect(errorEvents).toHaveLength(1);
  });

  it("supports custom isRetryable", async () => {
    let callCount = 0;
    const runner: Runner = async function* () {
      callCount++;
      if (callCount === 1) {
        yield { type: "error", error: new Error("custom-retryable") } as AgentEvent;
        yield {
          type: "done",
          result: "error",
          messages: [],
          totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        } as AgentEvent;
        return;
      }
      yield doneEvent;
    };

    const retried = withRetry({
      maxRetries: 3,
      initialDelayMs: 1,
      isRetryable: (e) => e.message.includes("custom-retryable"),
    })(runner);
    await collect(retried([], "test"));

    expect(callCount).toBe(2);
  });

  it("does not retry after tool.start (counts as content)", async () => {
    let callCount = 0;
    const runner: Runner = async function* () {
      callCount++;
      yield {
        type: "tool.start",
        toolCallId: "tc-1",
        toolName: "readFile",
        input: {},
      } as AgentEvent;
      yield { type: "error", error: new Error("429 rate limit") } as AgentEvent;
      yield doneEvent;
    };

    const retried = withRetry({ maxRetries: 3, initialDelayMs: 1 })(runner);
    const events = await collect(retried([], "test"));

    expect(callCount).toBe(1);
    expect(events.filter((e: any) => e.type === "retry")).toHaveLength(0);
  });

  it("works with maxRetries: 0 (no retries)", async () => {
    let callCount = 0;
    const runner: Runner = async function* () {
      callCount++;
      yield { type: "error", error: new Error("429 rate limit") } as AgentEvent;
      yield {
        type: "done",
        result: "error",
        messages: [],
        totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      } as AgentEvent;
    };

    const retried = withRetry({ maxRetries: 0, initialDelayMs: 1 })(runner);
    const events = await collect(retried([], "test"));

    expect(callCount).toBe(1);
    expect(events.filter((e: any) => e.type === "retry")).toHaveLength(0);
    expect(events.find((e: any) => e.type === "error")).toBeDefined();
  });

  it("retry events include error details", async () => {
    let callCount = 0;
    const runner: Runner = async function* () {
      callCount++;
      if (callCount === 1) {
        yield { type: "error", error: new Error("503 overloaded") } as AgentEvent;
        yield {
          type: "done",
          result: "error",
          messages: [],
          totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        } as AgentEvent;
        return;
      }
      yield doneEvent;
    };

    const retried = withRetry({ maxRetries: 3, initialDelayMs: 1 })(runner);
    const events = await collect(retried([], "test"));

    const retryEvent = events.find((e: any) => e.type === "retry");
    expect(retryEvent).toBeDefined();
    expect(retryEvent.error.message).toBe("503 overloaded");
    expect(retryEvent.maxRetries).toBe(3);
    expect(retryEvent.delayMs).toBeGreaterThan(0);
  });

  it("wraps non-Error thrown values in Error", async () => {
    const runner: Runner = async function* () {
      throw "string error";
    };

    const retried = withRetry({ maxRetries: 0, initialDelayMs: 1 })(runner);
    await expect(collect(retried([], "test"))).rejects.toBe("string error");
  });
});
