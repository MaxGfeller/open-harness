import { describe, it, expect } from "vitest";
import {
  // Type guards
  isOHDataPart,
  isSubagentEvent,
  isCompactionEvent,
  isRetryEvent,
  isSessionLifecycleEvent,

  // SSE formatters
  formatSSE,
  formatTextDelta,
  formatReasoningDelta,
  formatDataPart,
  formatToolStart,
  formatToolResult,
  formatToolError,
  formatStepStart,
  formatStepFinish,
  formatFinishMessage,
  formatDone,
} from "../stream-parts.js";

// ── Type guards ─────────────────────────────────────────────────────

describe("isOHDataPart", () => {
  it("matches any oh: prefixed data part", () => {
    expect(isOHDataPart({ type: "data-oh:subagent.start" })).toBe(true);
    expect(isOHDataPart({ type: "data-oh:retry" })).toBe(true);
    expect(isOHDataPart({ type: "data-oh:session.compacting" })).toBe(true);
  });

  it("rejects non-OH parts", () => {
    expect(isOHDataPart({ type: "text" })).toBe(false);
    expect(isOHDataPart({ type: "data-custom:foo" })).toBe(false);
    expect(isOHDataPart({ type: "tool" })).toBe(false);
  });
});

describe("isSubagentEvent", () => {
  it("matches subagent events", () => {
    expect(isSubagentEvent({ type: "data-oh:subagent.start" })).toBe(true);
    expect(isSubagentEvent({ type: "data-oh:subagent.done" })).toBe(true);
    expect(isSubagentEvent({ type: "data-oh:subagent.error" })).toBe(true);
  });

  it("rejects other OH events", () => {
    expect(isSubagentEvent({ type: "data-oh:retry" })).toBe(false);
    expect(isSubagentEvent({ type: "data-oh:compaction.start" })).toBe(false);
  });
});

describe("isCompactionEvent", () => {
  it("matches compaction events", () => {
    expect(isCompactionEvent({ type: "data-oh:compaction.start" })).toBe(true);
    expect(isCompactionEvent({ type: "data-oh:compaction.done" })).toBe(true);
  });

  it("rejects other events", () => {
    expect(isCompactionEvent({ type: "data-oh:subagent.start" })).toBe(false);
    expect(isCompactionEvent({ type: "data-oh:turn.start" })).toBe(false);
  });
});

describe("isRetryEvent", () => {
  it("matches retry events", () => {
    expect(isRetryEvent({ type: "data-oh:retry" })).toBe(true);
  });

  it("rejects other events", () => {
    expect(isRetryEvent({ type: "data-oh:subagent.start" })).toBe(false);
    expect(isRetryEvent({ type: "data-oh:turn.start" })).toBe(false);
  });
});

describe("isSessionLifecycleEvent", () => {
  it("matches turn and session compacting events", () => {
    expect(isSessionLifecycleEvent({ type: "data-oh:turn.start" })).toBe(true);
    expect(isSessionLifecycleEvent({ type: "data-oh:turn.done" })).toBe(true);
    expect(isSessionLifecycleEvent({ type: "data-oh:session.compacting" })).toBe(true);
  });

  it("rejects other events", () => {
    expect(isSessionLifecycleEvent({ type: "data-oh:retry" })).toBe(false);
    expect(isSessionLifecycleEvent({ type: "data-oh:subagent.start" })).toBe(false);
    expect(isSessionLifecycleEvent({ type: "data-oh:compaction.start" })).toBe(false);
  });
});

// ── SSE formatters ──────────────────────────────────────────────────

describe("formatSSE", () => {
  it("wraps data as SSE event", () => {
    expect(formatSSE({ hello: "world" })).toBe('data: {"hello":"world"}\n\n');
  });

  it("handles strings", () => {
    expect(formatSSE("test")).toBe('data: "test"\n\n');
  });

  it("handles null", () => {
    expect(formatSSE(null)).toBe("data: null\n\n");
  });
});

describe("formatTextDelta", () => {
  it("produces text-delta SSE chunk", () => {
    const result = formatTextDelta("part-1", "Hello");
    const parsed = parseSSE(result);
    expect(parsed).toEqual({ type: "text-delta", id: "part-1", delta: "Hello" });
  });
});

describe("formatReasoningDelta", () => {
  it("produces reasoning-delta SSE chunk", () => {
    const result = formatReasoningDelta("r-1", "thinking...");
    const parsed = parseSSE(result);
    expect(parsed).toEqual({
      type: "reasoning-delta",
      id: "r-1",
      delta: "thinking...",
    });
  });
});

describe("formatDataPart", () => {
  it("produces data-oh:* SSE chunk for subagent start", () => {
    const result = formatDataPart("oh:subagent.start", {
      agentName: "explore",
      task: "search the codebase",
    });
    const parsed = parseSSE(result);
    expect(parsed).toEqual({
      type: "data-oh:subagent.start",
      data: { agentName: "explore", task: "search the codebase" },
    });
  });

  it("produces data-oh:* SSE chunk for retry", () => {
    const result = formatDataPart("oh:retry", {
      attempt: 2,
      reason: "rate limit",
      delayMs: 3000,
    });
    const parsed = parseSSE(result);
    expect(parsed).toEqual({
      type: "data-oh:retry",
      data: { attempt: 2, reason: "rate limit", delayMs: 3000 },
    });
  });

  it("produces data-oh:* SSE chunk for empty data", () => {
    const result = formatDataPart("oh:compaction.start", {});
    const parsed = parseSSE(result);
    expect(parsed).toEqual({
      type: "data-oh:compaction.start",
      data: {},
    });
  });
});

describe("formatToolStart", () => {
  it("produces tool-input-start SSE chunk", () => {
    const result = formatToolStart("tc-1", "readFile");
    const parsed = parseSSE(result);
    expect(parsed).toEqual({
      type: "tool-input-start",
      id: "tc-1",
      toolName: "readFile",
    });
  });
});

describe("formatToolResult", () => {
  it("produces tool-output-available SSE chunk", () => {
    const result = formatToolResult("tc-1", { content: "file contents" });
    const parsed = parseSSE(result);
    expect(parsed).toEqual({
      type: "tool-output-available",
      id: "tc-1",
      output: { content: "file contents" },
    });
  });
});

describe("formatToolError", () => {
  it("produces tool-output-error SSE chunk", () => {
    const result = formatToolError("tc-1", "File not found");
    const parsed = parseSSE(result);
    expect(parsed).toEqual({
      type: "tool-output-error",
      id: "tc-1",
      error: "File not found",
    });
  });
});

describe("formatStepStart", () => {
  it("produces start-step SSE chunk", () => {
    const result = formatStepStart();
    const parsed = parseSSE(result);
    expect(parsed).toEqual({ type: "start-step" });
  });

  it("includes messageId when provided", () => {
    const result = formatStepStart("msg-1");
    const parsed = parseSSE(result);
    expect(parsed).toEqual({ type: "start-step", messageId: "msg-1" });
  });
});

describe("formatStepFinish", () => {
  it("produces finish-step SSE chunk with reason", () => {
    const result = formatStepFinish("stop");
    const parsed = parseSSE(result);
    expect(parsed).toEqual({ type: "finish-step", finishReason: "stop" });
  });

  it("includes usage when provided", () => {
    const result = formatStepFinish("stop", {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
    const parsed = parseSSE(result);
    expect(parsed).toEqual({
      type: "finish-step",
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
  });

  it("includes messageId when provided", () => {
    const result = formatStepFinish("stop", undefined, "msg-1");
    const parsed = parseSSE(result);
    expect(parsed).toEqual({
      type: "finish-step",
      finishReason: "stop",
      messageId: "msg-1",
    });
  });
});

describe("formatFinishMessage", () => {
  it("produces finish SSE chunk", () => {
    const result = formatFinishMessage("stop");
    const parsed = parseSSE(result);
    expect(parsed).toEqual({ type: "finish", finishReason: "stop" });
  });

  it("includes usage when provided", () => {
    const result = formatFinishMessage("stop", {
      inputTokens: 500,
      outputTokens: 200,
      totalTokens: 700,
    });
    const parsed = parseSSE(result);
    expect(parsed).toEqual({
      type: "finish",
      finishReason: "stop",
      usage: { inputTokens: 500, outputTokens: 200, totalTokens: 700 },
    });
  });
});

describe("formatDone", () => {
  it("produces the SSE done sentinel", () => {
    expect(formatDone()).toBe("data: [DONE]\n\n");
  });
});

// ── Test helpers ────────────────────────────────────────────────────

function parseSSE(sse: string): unknown {
  const match = sse.match(/^data: (.*)\n\n$/);
  if (!match) throw new Error(`Invalid SSE format: ${sse}`);
  return JSON.parse(match[1]);
}
