import { type InjectionKey, type Ref, inject } from "vue";

// ── Subagent state ──────────────────────────────────────────────────

export interface SubagentInfo {
  name: string;
  task: string;
  status: "running" | "done" | "error";
  sessionId?: string;
  /** Full ancestry path from outermost to innermost agent, e.g. ["explore"] or ["explore", "search"]. */
  path: string[];
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
  subagents: Ref<Map<string, SubagentInfo>>;
  sessionState: Ref<SessionState>;
  sandboxState: Ref<SandboxState>;
  dispatch: (part: { type: string; data?: unknown }) => void;
}

export const OH_INJECTION_KEY: InjectionKey<OHContextValue> =
  Symbol("openharness");

export function useOHContext(): OHContextValue {
  const ctx = inject(OH_INJECTION_KEY);
  if (!ctx) {
    throw new Error(
      "useOpenHarness composables must be used within an <OpenHarnessProvider>",
    );
  }
  return ctx;
}
