import { computed } from "vue";
import { useOHContext, type SubagentInfo } from "../context.js";

export interface UseSubagentStatusResult {
  /** Currently running subagents. */
  activeSubagents: SubagentInfo[];
  /** All subagents (running, done, or errored) from the current session. */
  recentSubagents: SubagentInfo[];
  /** True when at least one subagent is running. */
  hasActiveSubagents: boolean;
}

/**
 * Derives real-time subagent state from the provider's event stream.
 * No polling or manual `onData` wiring needed.
 *
 * Must be used within an `<OpenHarnessProvider>`.
 */
export function useSubagentStatus() {
  const { subagents } = useOHContext();

  return computed<UseSubagentStatusResult>(() => {
    const all = Array.from(subagents.value.values());
    const active = all.filter((s) => s.status === "running");
    return {
      activeSubagents: active,
      recentSubagents: all,
      hasActiveSubagents: active.length > 0,
    };
  });
}
