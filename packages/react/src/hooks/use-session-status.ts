import { useOHContext, type SessionState } from "../context.js";

/**
 * Derives session lifecycle state: compaction, retry, and turn info.
 *
 * Must be used within an `<OpenHarnessProvider>`.
 */
export function useSessionStatus(): SessionState {
  const { sessionState } = useOHContext();
  return sessionState;
}
