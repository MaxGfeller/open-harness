import { computed } from "vue";
import { useOHContext, type SandboxState } from "../context.js";

/**
 * Derives sandbox provisioning state.
 *
 * This composable depends on the agent layer emitting `oh:sandbox.*` data parts.
 * If your agent setup doesn't use a sandbox, this composable is a no-op —
 * it will always return the initial (idle) state.
 *
 * Must be used within an `<OpenHarnessProvider>`.
 */
export function useSandboxStatus() {
  const { sandboxState } = useOHContext();

  return computed<SandboxState>(() => sandboxState.value);
}
