import { defineComponent, ref, provide, type Slot } from "vue";
import {
  OH_INJECTION_KEY,
  initialSessionState,
  initialSandboxState,
  type SubagentInfo,
  type SessionState,
  type SandboxState,
  type OHContextValue,
} from "./context.js";

/**
 * Provides shared OpenHarness state (subagent, session, sandbox) to all
 * child composables. Place this at the root of your chat UI.
 *
 * The provider does NOT render any UI — it only manages state.
 *
 * ```vue
 * <OpenHarnessProvider>
 *   <ChatView />
 * </OpenHarnessProvider>
 * ```
 */
export const OpenHarnessProvider = defineComponent({
  name: "OpenHarnessProvider",
  setup(_, { slots }) {
    const subagents = ref<Map<string, SubagentInfo>>(new Map());
    const sessionState = ref<SessionState>({ ...initialSessionState });
    const sandboxState = ref<SandboxState>({ ...initialSandboxState });

    function dispatch(part: { type: string; data?: unknown }) {
      const data = part.data as Record<string, any> | undefined;

      switch (part.type) {
        // ── Subagent events ──────────────────────────────────────
        case "data-oh:subagent.start": {
          const path: string[] = data?.path ?? [data?.agentName ?? "unknown"];
          const key = path.join("/");
          const info: SubagentInfo = {
            name: path[path.length - 1],
            task: data?.task ?? "",
            status: "running",
            sessionId: data?.sessionId,
            path,
            startedAt: Date.now(),
          };
          const next = new Map(subagents.value);
          next.set(key, info);
          subagents.value = next;
          break;
        }

        case "data-oh:subagent.done": {
          const path: string[] = data?.path ?? [data?.agentName ?? "unknown"];
          const key = path.join("/");
          const existing = subagents.value.get(key);
          if (!existing) break;
          const next = new Map(subagents.value);
          next.set(key, {
            ...existing,
            status: "done",
            sessionId: data?.sessionId ?? existing.sessionId,
            durationMs: data?.durationMs ?? Date.now() - existing.startedAt,
          });
          subagents.value = next;
          break;
        }

        case "data-oh:subagent.error": {
          const path: string[] = data?.path ?? [data?.agentName ?? "unknown"];
          const key = path.join("/");
          const existing = subagents.value.get(key);
          if (!existing) break;
          const next = new Map(subagents.value);
          next.set(key, {
            ...existing,
            status: "error",
            sessionId: data?.sessionId ?? existing.sessionId,
            error: data?.error ?? "Unknown error",
          });
          subagents.value = next;
          break;
        }

        // ── Session lifecycle events ─────────────────────────────
        case "data-oh:turn.start":
          sessionState.value = {
            ...sessionState.value,
            currentTurn: data?.turnIndex ?? sessionState.value.currentTurn + 1,
          };
          break;

        case "data-oh:turn.done":
          // Turn completed — no special state change needed
          break;

        case "data-oh:session.compacting":
        case "data-oh:compaction.start":
          sessionState.value = { ...sessionState.value, isCompacting: true };
          break;

        case "data-oh:compaction.done":
          sessionState.value = {
            ...sessionState.value,
            isCompacting: false,
            lastCompactionAt: new Date(),
            messagesRemovedByCompaction:
              sessionState.value.messagesRemovedByCompaction +
              (data?.messagesRemoved ?? 0),
          };
          break;

        case "data-oh:retry":
          sessionState.value = {
            ...sessionState.value,
            isRetrying: true,
            retryAttempt: data?.attempt ?? sessionState.value.retryAttempt + 1,
            retryReason: data?.reason ?? null,
          };
          break;

        // ── Sandbox events (future) ──────────────────────────────
        case "data-oh:sandbox.provisioning":
          sandboxState.value = {
            ...sandboxState.value,
            isProvisioning: true,
            provisioningMessage: data?.message ?? "Provisioning...",
          };
          break;

        case "data-oh:sandbox.ready":
          sandboxState.value = {
            ...sandboxState.value,
            isProvisioning: false,
            isWarm: true,
            provisionedAt: new Date(),
            provisioningMessage: null,
          };
          break;
      }
    }

    const value: OHContextValue = {
      subagents,
      sessionState,
      sandboxState,
      dispatch,
    };

    provide(OH_INJECTION_KEY, value);

    return () => slots.default?.();
  },
});
