// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { type ReactNode } from "react";
import { OpenHarnessProvider } from "../provider.js";
import { useSubagentStatus } from "../hooks/use-subagent-status.js";
import { useSessionStatus } from "../hooks/use-session-status.js";
import { useSandboxStatus } from "../hooks/use-sandbox-status.js";
import { useOHContext } from "../context.js";

// ── Test wrapper ────────────────────────────────────────────────────

function wrapper({ children }: { children: ReactNode }) {
  return <OpenHarnessProvider>{children}</OpenHarnessProvider>;
}

// Helper hook to access dispatch directly for testing
function useDispatch() {
  return useOHContext().dispatch;
}

// ── Provider ────────────────────────────────────────────────────────

describe("OpenHarnessProvider", () => {
  it("provides initial context without errors", () => {
    const { result } = renderHook(() => useSessionStatus(), { wrapper });
    expect(result.current.currentTurn).toBe(0);
    expect(result.current.isCompacting).toBe(false);
    expect(result.current.isRetrying).toBe(false);
  });

  it("throws when hooks are used outside provider", () => {
    expect(() => {
      renderHook(() => useSessionStatus());
    }).toThrow("useOpenHarness hooks must be used within an <OpenHarnessProvider>");
  });
});

// ── useSubagentStatus ───────────────────────────────────────────────

describe("useSubagentStatus", () => {
  it("starts with no subagents", () => {
    const { result } = renderHook(() => useSubagentStatus(), { wrapper });
    expect(result.current.activeSubagents).toHaveLength(0);
    expect(result.current.recentSubagents).toHaveLength(0);
    expect(result.current.hasActiveSubagents).toBe(false);
  });

  it("tracks subagent start", () => {
    const { result } = renderHook(
      () => ({ sub: useSubagentStatus(), dispatch: useDispatch() }),
      { wrapper },
    );

    act(() => {
      result.current.dispatch({
        type: "data-oh:subagent.start",
        data: { agentName: "explore", task: "search codebase" },
      });
    });

    expect(result.current.sub.activeSubagents).toHaveLength(1);
    expect(result.current.sub.activeSubagents[0].name).toBe("explore");
    expect(result.current.sub.activeSubagents[0].task).toBe("search codebase");
    expect(result.current.sub.activeSubagents[0].status).toBe("running");
    expect(result.current.sub.hasActiveSubagents).toBe(true);
  });

  it("tracks subagent completion", () => {
    const { result } = renderHook(
      () => ({ sub: useSubagentStatus(), dispatch: useDispatch() }),
      { wrapper },
    );

    act(() => {
      result.current.dispatch({
        type: "data-oh:subagent.start",
        data: { agentName: "explore", task: "search" },
      });
    });

    act(() => {
      result.current.dispatch({
        type: "data-oh:subagent.done",
        data: { agentName: "explore", durationMs: 1500 },
      });
    });

    expect(result.current.sub.activeSubagents).toHaveLength(0);
    expect(result.current.sub.recentSubagents).toHaveLength(1);
    expect(result.current.sub.recentSubagents[0].status).toBe("done");
    expect(result.current.sub.recentSubagents[0].durationMs).toBe(1500);
    expect(result.current.sub.hasActiveSubagents).toBe(false);
  });

  it("tracks subagent error", () => {
    const { result } = renderHook(
      () => ({ sub: useSubagentStatus(), dispatch: useDispatch() }),
      { wrapper },
    );

    act(() => {
      result.current.dispatch({
        type: "data-oh:subagent.start",
        data: { agentName: "explore", task: "search" },
      });
    });

    act(() => {
      result.current.dispatch({
        type: "data-oh:subagent.error",
        data: { agentName: "explore", error: "Agent crashed" },
      });
    });

    expect(result.current.sub.activeSubagents).toHaveLength(0);
    expect(result.current.sub.recentSubagents[0].status).toBe("error");
    expect(result.current.sub.recentSubagents[0].error).toBe("Agent crashed");
  });

  it("tracks multiple concurrent subagents", () => {
    const { result } = renderHook(
      () => ({ sub: useSubagentStatus(), dispatch: useDispatch() }),
      { wrapper },
    );

    act(() => {
      result.current.dispatch({
        type: "data-oh:subagent.start",
        data: { agentName: "explore", task: "search" },
      });
      result.current.dispatch({
        type: "data-oh:subagent.start",
        data: { agentName: "code-writer", task: "implement feature" },
      });
    });

    expect(result.current.sub.activeSubagents).toHaveLength(2);
    expect(result.current.sub.hasActiveSubagents).toBe(true);

    act(() => {
      result.current.dispatch({
        type: "data-oh:subagent.done",
        data: { agentName: "explore", durationMs: 500 },
      });
    });

    expect(result.current.sub.activeSubagents).toHaveLength(1);
    expect(result.current.sub.activeSubagents[0].name).toBe("code-writer");
  });
});

// ── useSessionStatus ────────────────────────────────────────────────

describe("useSessionStatus", () => {
  it("starts with initial state", () => {
    const { result } = renderHook(() => useSessionStatus(), { wrapper });
    expect(result.current).toEqual({
      isCompacting: false,
      isRetrying: false,
      retryAttempt: 0,
      retryReason: null,
      currentTurn: 0,
      lastCompactionAt: null,
      messagesRemovedByCompaction: 0,
    });
  });

  it("tracks turn start", () => {
    const { result } = renderHook(
      () => ({ session: useSessionStatus(), dispatch: useDispatch() }),
      { wrapper },
    );

    act(() => {
      result.current.dispatch({
        type: "data-oh:turn.start",
        data: { turnIndex: 3 },
      });
    });

    expect(result.current.session.currentTurn).toBe(3);
  });

  it("tracks compaction lifecycle", () => {
    const { result } = renderHook(
      () => ({ session: useSessionStatus(), dispatch: useDispatch() }),
      { wrapper },
    );

    act(() => {
      result.current.dispatch({ type: "data-oh:compaction.start" });
    });

    expect(result.current.session.isCompacting).toBe(true);

    act(() => {
      result.current.dispatch({
        type: "data-oh:compaction.done",
        data: { messagesRemoved: 5 },
      });
    });

    expect(result.current.session.isCompacting).toBe(false);
    expect(result.current.session.lastCompactionAt).toBeInstanceOf(Date);
    expect(result.current.session.messagesRemovedByCompaction).toBe(5);
  });

  it("accumulates messages removed across compactions", () => {
    const { result } = renderHook(
      () => ({ session: useSessionStatus(), dispatch: useDispatch() }),
      { wrapper },
    );

    act(() => {
      result.current.dispatch({ type: "data-oh:compaction.start" });
      result.current.dispatch({
        type: "data-oh:compaction.done",
        data: { messagesRemoved: 3 },
      });
    });

    act(() => {
      result.current.dispatch({ type: "data-oh:compaction.start" });
      result.current.dispatch({
        type: "data-oh:compaction.done",
        data: { messagesRemoved: 7 },
      });
    });

    expect(result.current.session.messagesRemovedByCompaction).toBe(10);
  });

  it("tracks retry state", () => {
    const { result } = renderHook(
      () => ({ session: useSessionStatus(), dispatch: useDispatch() }),
      { wrapper },
    );

    act(() => {
      result.current.dispatch({
        type: "data-oh:retry",
        data: { attempt: 2, reason: "rate limit", delayMs: 3000 },
      });
    });

    expect(result.current.session.isRetrying).toBe(true);
    expect(result.current.session.retryAttempt).toBe(2);
    expect(result.current.session.retryReason).toBe("rate limit");
  });
});

// ── useSandboxStatus ────────────────────────────────────────────────

describe("useSandboxStatus", () => {
  it("starts with initial idle state", () => {
    const { result } = renderHook(() => useSandboxStatus(), { wrapper });
    expect(result.current).toEqual({
      isProvisioning: false,
      isWarm: false,
      provisioningMessage: null,
      provisionedAt: null,
    });
  });

  it("tracks sandbox provisioning lifecycle", () => {
    const { result } = renderHook(
      () => ({ sandbox: useSandboxStatus(), dispatch: useDispatch() }),
      { wrapper },
    );

    act(() => {
      result.current.dispatch({
        type: "data-oh:sandbox.provisioning",
        data: { message: "Setting up workspace..." },
      });
    });

    expect(result.current.sandbox.isProvisioning).toBe(true);
    expect(result.current.sandbox.provisioningMessage).toBe(
      "Setting up workspace...",
    );

    act(() => {
      result.current.dispatch({ type: "data-oh:sandbox.ready" });
    });

    expect(result.current.sandbox.isProvisioning).toBe(false);
    expect(result.current.sandbox.isWarm).toBe(true);
    expect(result.current.sandbox.provisionedAt).toBeInstanceOf(Date);
    expect(result.current.sandbox.provisioningMessage).toBeNull();
  });
});
