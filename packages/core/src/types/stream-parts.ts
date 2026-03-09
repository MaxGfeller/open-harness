import type { OHDataTypes } from "./ui-message.js";

// ── Resolved data part types (as seen in UIMessage.parts) ───────────
//
// These match the AI SDK 5 DataUIPart shape: { type: `data-${name}`, data: T }

export type OHSubagentPart =
  | {
      type: "data-oh:subagent.start";
      data: OHDataTypes["oh:subagent.start"];
    }
  | {
      type: "data-oh:subagent.done";
      data: OHDataTypes["oh:subagent.done"];
    }
  | {
      type: "data-oh:subagent.error";
      data: OHDataTypes["oh:subagent.error"];
    };

export type OHCompactionPart =
  | {
      type: "data-oh:compaction.start";
      data: OHDataTypes["oh:compaction.start"];
    }
  | {
      type: "data-oh:compaction.done";
      data: OHDataTypes["oh:compaction.done"];
    };

export type OHRetryPart = {
  type: "data-oh:retry";
  data: OHDataTypes["oh:retry"];
};

export type OHSessionLifecyclePart =
  | {
      type: "data-oh:turn.start";
      data: OHDataTypes["oh:turn.start"];
    }
  | {
      type: "data-oh:turn.done";
      data: OHDataTypes["oh:turn.done"];
    }
  | {
      type: "data-oh:session.compacting";
      data: OHDataTypes["oh:session.compacting"];
    };

export type OHDataPart =
  | OHSubagentPart
  | OHCompactionPart
  | OHRetryPart
  | OHSessionLifecyclePart;

// ── Type guards ─────────────────────────────────────────────────────

export const isOHDataPart = (part: { type: string }): part is OHDataPart =>
  part.type.startsWith("data-oh:");

export const isSubagentEvent = (part: { type: string }): part is OHSubagentPart =>
  part.type.startsWith("data-oh:subagent.");

export const isCompactionEvent = (part: { type: string }): part is OHCompactionPart =>
  part.type.startsWith("data-oh:compaction.");

export const isRetryEvent = (part: { type: string }): part is OHRetryPart =>
  part.type === "data-oh:retry";

export const isSessionLifecycleEvent = (
  part: { type: string },
): part is OHSessionLifecyclePart =>
  part.type.startsWith("data-oh:turn.") || part.type === "data-oh:session.compacting";

// ── SSE stream formatters ───────────────────────────────────────────
//
// These produce SSE-encoded strings matching the AI SDK 5 data stream
// protocol. Each returns a complete SSE event line (`data: ...\n\n`).
//
// Primary use: building raw ReadableStreams without `createUIMessageStream`.
// For the standard path, `toUIMessageStream` uses the AI SDK's writer
// and only needs the chunk objects (not SSE strings).

export function formatSSE(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export function formatTextDelta(id: string, delta: string): string {
  return formatSSE({ type: "text-delta", id, delta });
}

export function formatReasoningDelta(id: string, delta: string): string {
  return formatSSE({ type: "reasoning-delta", id, delta });
}

export function formatDataPart<K extends keyof OHDataTypes & string>(
  name: K,
  data: OHDataTypes[K],
): string {
  return formatSSE({ type: `data-${name}`, data });
}

export function formatToolStart(id: string, toolName: string): string {
  return formatSSE({ type: "tool-input-start", id, toolName });
}

export function formatToolResult(id: string, output: unknown): string {
  return formatSSE({ type: "tool-output-available", id, output });
}

export function formatToolError(id: string, error: string): string {
  return formatSSE({ type: "tool-output-error", id, error });
}

export function formatStepStart(messageId?: string): string {
  return formatSSE({ type: "start-step", ...(messageId ? { messageId } : {}) });
}

export function formatStepFinish(
  finishReason: string,
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number },
  messageId?: string,
): string {
  return formatSSE({
    type: "finish-step",
    finishReason,
    ...(usage ? { usage } : {}),
    ...(messageId ? { messageId } : {}),
  });
}

export function formatFinishMessage(
  finishReason: string,
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number },
): string {
  return formatSSE({ type: "finish", finishReason, ...(usage ? { usage } : {}) });
}

export function formatDone(): string {
  return "data: [DONE]\n\n";
}
