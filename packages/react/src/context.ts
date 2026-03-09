import { createContext, useContext } from "react";

// ── Subagent state ──────────────────────────────────────────────────

export interface SubagentInfo {
  name: string;
  task: string;
  status: "running" | "done" | "error";
  parentAgent?: string;
  startedAt: number;
  durationMs?: number;
  error?: string;
}

// ── Session state ───────────────────────────────────────────────────

export interface SessionState {
  isCompacting: boolean;
  isRetrying: boolean;
  retryAttempt: number;
  retryReason: string | null;
  currentTurn: number;
  lastCompactionAt: Date | null;
  messagesRemovedByCompaction: number;
}

export const initialSessionState: SessionState = {
  isCompacting: false,
  isRetrying: false,
  retryAttempt: 0,
  retryReason: null,
  currentTurn: 0,
  lastCompactionAt: null,
  messagesRemovedByCompaction: 0,
};

// ── Sandbox state ───────────────────────────────────────────────────

export interface SandboxState {
  isProvisioning: boolean;
  isWarm: boolean;
  provisioningMessage: string | null;
  provisionedAt: Date | null;
}

export const initialSandboxState: SandboxState = {
  isProvisioning: false,
  isWarm: false,
  provisioningMessage: null,
  provisionedAt: null,
};

// ── Context ─────────────────────────────────────────────────────────

export interface OHContextValue {
  subagents: Map<string, SubagentInfo>;
  sessionState: SessionState;
  sandboxState: SandboxState;
  dispatch: (part: { type: string; data?: unknown }) => void;
}

export const OHContext = createContext<OHContextValue | null>(null);

export function useOHContext(): OHContextValue {
  const ctx = useContext(OHContext);
  if (!ctx) {
    throw new Error(
      "useOpenHarness hooks must be used within an <OpenHarnessProvider>",
    );
  }
  return ctx;
}
