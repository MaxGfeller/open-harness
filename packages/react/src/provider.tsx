import { useState, useCallback, useRef, type ReactNode } from "react";
import {
  OHContext,
  initialSessionState,
  initialSandboxState,
  type SubagentInfo,
  type SessionState,
  type SandboxState,
  type OHContextValue,
} from "./context.js";

export interface OpenHarnessProviderProps {
  children: ReactNode;
}

/**
 * Provides shared OpenHarness state (subagent, session, sandbox) to all
 * child hooks. Place this at the root of your chat UI.
 *
 * The provider does NOT render any UI — it only manages state.
 */
export function OpenHarnessProvider({ children }: OpenHarnessProviderProps) {
  const [subagents, setSubagents] = useState<Map<string, SubagentInfo>>(
    () => new Map(),
  );
  const [sessionState, setSessionState] =
    useState<SessionState>(initialSessionState);
  const [sandboxState, setSandboxState] =
    useState<SandboxState>(initialSandboxState);

  // Use a ref to avoid re-creating dispatch on every render
  const subagentsRef = useRef(subagents);
  subagentsRef.current = subagents;

  const dispatch = useCallback(
    (part: { type: string; data?: unknown }) => {
      const data = part.data as Record<string, any> | undefined;

      switch (part.type) {
        // ── Subagent events ──────────────────────────────────────
        case "data-oh:subagent.start": {
          const name = data?.agentName ?? "unknown";
          const info: SubagentInfo = {
            name,
            task: data?.task ?? "",
            status: "running",
            parentAgent: data?.parentAgent,
            startedAt: Date.now(),
          };
          setSubagents((prev) => {
            const next = new Map(prev);
            next.set(name, info);
            return next;
          });
          break;
        }

        case "data-oh:subagent.done": {
          const name = data?.agentName ?? "unknown";
          setSubagents((prev) => {
            const existing = prev.get(name);
            if (!existing) return prev;
            const next = new Map(prev);
            next.set(name, {
              ...existing,
              status: "done",
              durationMs: data?.durationMs ?? Date.now() - existing.startedAt,
            });
            return next;
          });
          break;
        }

        case "data-oh:subagent.error": {
          const name = data?.agentName ?? "unknown";
          setSubagents((prev) => {
            const existing = prev.get(name);
            if (!existing) return prev;
            const next = new Map(prev);
            next.set(name, {
              ...existing,
              status: "error",
              error: data?.error ?? "Unknown error",
            });
            return next;
          });
          break;
        }

        // ── Session lifecycle events ─────────────────────────────
        case "data-oh:turn.start":
          setSessionState((prev) => ({
            ...prev,
            currentTurn: data?.turnIndex ?? prev.currentTurn + 1,
          }));
          break;

        case "data-oh:turn.done":
          // Turn completed — no special state change needed
          break;

        case "data-oh:session.compacting":
        case "data-oh:compaction.start":
          setSessionState((prev) => ({ ...prev, isCompacting: true }));
          break;

        case "data-oh:compaction.done":
          setSessionState((prev) => ({
            ...prev,
            isCompacting: false,
            lastCompactionAt: new Date(),
            messagesRemovedByCompaction:
              prev.messagesRemovedByCompaction +
              (data?.messagesRemoved ?? 0),
          }));
          break;

        case "data-oh:retry":
          setSessionState((prev) => ({
            ...prev,
            isRetrying: true,
            retryAttempt: data?.attempt ?? prev.retryAttempt + 1,
            retryReason: data?.reason ?? null,
          }));
          break;

        // ── Sandbox events (future) ──────────────────────────────
        case "data-oh:sandbox.provisioning":
          setSandboxState((prev) => ({
            ...prev,
            isProvisioning: true,
            provisioningMessage: data?.message ?? "Provisioning...",
          }));
          break;

        case "data-oh:sandbox.ready":
          setSandboxState((prev) => ({
            ...prev,
            isProvisioning: false,
            isWarm: true,
            provisionedAt: new Date(),
            provisioningMessage: null,
          }));
          break;
      }
    },
    [],
  );

  const value: OHContextValue = {
    subagents,
    sessionState,
    sandboxState,
    dispatch,
  };

  return <OHContext.Provider value={value}>{children}</OHContext.Provider>;
}
