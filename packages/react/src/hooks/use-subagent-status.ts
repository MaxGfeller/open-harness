import { useMemo } from "react";
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
export function useSubagentStatus(): UseSubagentStatusResult {
  const { subagents } = useOHContext();

  return useMemo(() => {
    const all = Array.from(subagents.values());
    const active = all.filter((s) => s.status === "running");
    return {
      activeSubagents: active,
      recentSubagents: all,
      hasActiveSubagents: active.length > 0,
    };
  }, [subagents]);
}
