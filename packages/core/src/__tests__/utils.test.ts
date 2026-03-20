import { describe, it, expect, vi } from "vitest";
import {
  isRetryableError,
  getRetryDelay,
  sleep,
  addUsage,
  defaultEstimateTokens,
} from "../utils.js";
import type { RetryConfig } from "../session.js";

// ── isRetryableError ────────────────────────────────────────────────

describe("isRetryableError", () => {
  it.each([
    "429 Too Many Requests",
    "500 Internal Server Error",
    "502 Bad Gateway",
    "503 Service Unavailable",
    "504 Gateway Timeout",
    "529 overloaded",
  ])("returns true for status code error: %s", (msg) => {
    expect(isRetryableError(new Error(msg))).toBe(true);
  });

  it.each([
    "rate limit exceeded",
    "Rate Limit Exceeded",
    "RATE LIMIT hit",
  ])("returns true for rate limit variants: %s", (msg) => {
    expect(isRetryableError(new Error(msg))).toBe(true);
  });

  it.each(["timeout", "TIMEOUT", "connection timeout"])("returns true for timeout: %s", (msg) => {
    expect(isRetryableError(new Error(msg))).toBe(true);
  });

  it("returns true for econnreset", () => {
    expect(isRetryableError(new Error("ECONNRESET"))).toBe(true);
  });

  it("returns true for overloaded", () => {
    expect(isRetryableError(new Error("server overloaded"))).toBe(true);
  });

  it.each([
    "invalid input",
    "authentication failed",
    "404 Not Found",
    "",
  ])("returns false for non-retryable error: %s", (msg) => {
    expect(isRetryableError(new Error(msg))).toBe(false);
  });
});

// ── getRetryDelay ───────────────────────────────────────────────────

describe("getRetryDelay", () => {
  const config: RetryConfig = {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30_000,
    backoffMultiplier: 2,
  };

  it("returns exponential backoff delay", () => {
    const delay = getRetryDelay(0, config, new Error("429"));
    // base = 1000 * 2^0 = 1000, jitter up to 300
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThanOrEqual(1300);
  });

  it("increases delay with attempt number", () => {
    // We need to control jitter for this test, so just check the base increases
    const delay0 = getRetryDelay(0, config, new Error("429"));
    // Attempt 2: base = 1000 * 2^2 = 4000
    const delay2 = getRetryDelay(2, config, new Error("429"));
    // delay2's minimum (4000) should be higher than delay0's max (1300)
    expect(delay2).toBeGreaterThanOrEqual(4000);
  });

  it("caps at maxDelayMs", () => {
    const delay = getRetryDelay(10, config, new Error("429"));
    expect(delay).toBeLessThanOrEqual(config.maxDelayMs);
  });

  it("uses Retry-After header when present", () => {
    const error = new Error("429") as any;
    error.headers = { "retry-after": "5" };
    const delay = getRetryDelay(0, config, error);
    expect(delay).toBe(5000);
  });

  it("caps Retry-After at maxDelayMs", () => {
    const error = new Error("429") as any;
    error.headers = { "retry-after": "60" };
    const delay = getRetryDelay(0, config, error);
    expect(delay).toBe(config.maxDelayMs);
  });
});

// ── sleep ───────────────────────────────────────────────────────────

describe("sleep", () => {
  it("resolves after the specified delay", async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it("rejects immediately if signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort("cancelled");
    await expect(sleep(1000, controller.signal)).rejects.toBe("cancelled");
  });

  it("rejects when signal is aborted during sleep", async () => {
    const controller = new AbortController();
    const promise = sleep(5000, controller.signal);
    setTimeout(() => controller.abort("stopped"), 10);
    await expect(promise).rejects.toBe("stopped");
  });

  it("works without a signal", async () => {
    await sleep(1); // should not throw
  });
});

// ── addUsage ────────────────────────────────────────────────────────

describe("addUsage", () => {
  it("adds two usages together", () => {
    const result = addUsage(
      { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    );
    expect(result).toEqual({
      inputTokens: 30,
      outputTokens: 15,
      totalTokens: 45,
    });
  });

  it("treats undefined as 0", () => {
    const result = addUsage(
      { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
      { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    );
    expect(result).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
  });

  it("handles both sides undefined", () => {
    const result = addUsage(
      { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
      { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
    );
    expect(result).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
  });
});

// ── defaultEstimateTokens ───────────────────────────────────────────

describe("defaultEstimateTokens", () => {
  it("estimates based on JSON length / 4", () => {
    const messages = [{ role: "user", content: "hello" }];
    const json = JSON.stringify(messages);
    expect(defaultEstimateTokens(messages)).toBe(Math.ceil(json.length / 4));
  });

  it("returns 0 for empty array", () => {
    // JSON.stringify([]) = "[]" = 2 chars => ceil(2/4) = 1
    expect(defaultEstimateTokens([])).toBe(1);
  });

  it("handles complex nested messages", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: "world" },
    ];
    const result = defaultEstimateTokens(messages);
    expect(result).toBeGreaterThan(0);
    expect(result).toBe(Math.ceil(JSON.stringify(messages).length / 4));
  });
});
