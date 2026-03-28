// ── Provider ────────────────────────────────────────────────────────

export {
  OpenHarnessProvider,
  type OpenHarnessProviderProps,
} from "./provider.js";

// ── Hooks ───────────────────────────────────────────────────────────

export {
  useOpenHarness,
  type UseOpenHarnessConfig,
  type UseOpenHarnessFinishEvent,
} from "./hooks/use-open-harness.js";

export {
  useSubagentStatus,
  type UseSubagentStatusResult,
} from "./hooks/use-subagent-status.js";

export { useSessionStatus } from "./hooks/use-session-status.js";

export { useSandboxStatus } from "./hooks/use-sandbox-status.js";

// ── Transport ───────────────────────────────────────────────────────

export {
  createOHTransport,
  type OHTransportOptions,
} from "./transport.js";

// ── Context types (for advanced usage) ──────────────────────────────

export {
  type SubagentInfo,
  type SessionState,
  type SandboxState,
} from "./context.js";
