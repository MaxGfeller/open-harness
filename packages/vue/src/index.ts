// ── Provider ────────────────────────────────────────────────────────

export { OpenHarnessProvider } from "./provider.js";

// ── Composables ────────────────────────────────────────────────────

export {
  useOpenHarness,
  type UseOpenHarnessConfig,
} from "./composables/useOpenHarness.js";

export {
  useSubagentStatus,
  type UseSubagentStatusResult,
} from "./composables/useSubagentStatus.js";

export { useSessionStatus } from "./composables/useSessionStatus.js";

export { useSandboxStatus } from "./composables/useSandboxStatus.js";

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
