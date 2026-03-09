import type { UIMessage } from "ai";

// ── Custom data types for OpenHarness UI stream ─────────────────────
//
// Keys become `data-${key}` part types in UIMessage.parts.
// The `oh:` namespace prevents collisions with other data parts.

export type OHDataTypes = {
  "oh:subagent.start": {
    agentName: string;
    task: string;
    parentAgent?: string;
  };
  "oh:subagent.done": {
    agentName: string;
    durationMs: number;
  };
  "oh:subagent.error": {
    agentName: string;
    error: string;
  };
  "oh:compaction.start": Record<string, never>;
  "oh:compaction.done": {
    messagesRemoved: number;
  };
  "oh:retry": {
    attempt: number;
    reason: string;
    delayMs: number;
  };
  "oh:turn.start": {
    turnIndex: number;
  };
  "oh:turn.done": {
    turnIndex: number;
    durationMs: number;
  };
  "oh:session.compacting": Record<string, never>;
};

// ── Per-message metadata ────────────────────────────────────────────

export type OHMetadata = {
  agentName?: string;
  sessionId?: string;
  turnIndex?: number;
  wasCompacted?: boolean;
};

// ── Pre-typed UIMessage for OpenHarness consumers ───────────────────

export type OHUIMessage = UIMessage<OHMetadata, OHDataTypes>;
