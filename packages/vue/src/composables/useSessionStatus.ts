import { computed } from "vue";
import { useOHContext, type SessionState } from "../context.js";

/**
 * Derives session lifecycle state: compaction, retry, and turn info.
 *
 * Must be used within an `<OpenHarnessProvider>`.
 */
export function useSessionStatus() {
  const { sessionState } = useOHContext();

  return computed<SessionState>(() => sessionState.value);
}
