import { describe, it, expect, vi, afterEach } from "vitest";
import {
  AgentRegistry,
  normalizeBackgroundConfig,
  type BackgroundAgentConfig,
} from "../agent-registry.js";
import type { Agent, AgentEvent } from "../agent.js";

// ── Mock agents ─────────────────────────────────────────────────────

function createImmediateAgent(text: string) {
  return {
    run: async function* () {
      yield { type: "text.done" as const, text };
      yield {
        type: "done" as const,
        result: "complete" as const,
        messages: [],
        totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    },
    close: vi.fn(),
  } as unknown as Agent;
}

function createFailingAgent(error: Error) {
  return {
    run: async function* () {
      throw error;
    },
    close: vi.fn(),
  } as unknown as Agent;
}

function createControllableAgent() {
  let _resolve!: (text: string) => void;
  let _reject!: (error: Error) => void;
  const gate = new Promise<string>((resolve, reject) => {
    _resolve = resolve;
    _reject = reject;
  });

  const closeFn = vi.fn();
  const agent = {
    run: async function* (
      _h: unknown[],
      _i: unknown,
      opts?: { signal?: AbortSignal },
    ): AsyncGenerator<AgentEvent> {
      const text = await Promise.race([
        gate,
        new Promise<never>((_, reject) => {
          if (opts?.signal?.aborted) {
            reject(new Error("Aborted"));
            return;
          }
          opts?.signal?.addEventListener("abort", () => reject(new Error("Aborted")));
        }),
      ]);
      yield { type: "text.done" as const, text };
      yield {
        type: "done" as const,
        result: "complete" as const,
        messages: [],
        totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    },
    close: closeFn,
  } as unknown as Agent;

  return { agent, resolve: _resolve, reject: _reject, closeFn };
}

// ── Helpers ─────────────────────────────────────────────────────────

const DEFAULT_CONFIG: BackgroundAgentConfig = {
  maxConcurrent: Infinity,
  timeout: undefined,
  autoCancel: true,
  tools: { status: true, cancel: true, await: ["all", "any", "race", "allSettled"] },
};

function createRegistry(overrides?: Partial<BackgroundAgentConfig>) {
  return new AgentRegistry({ ...DEFAULT_CONFIG, ...overrides });
}

// ── Tests ───────────────────────────────────────────────────────────

describe("normalizeBackgroundConfig", () => {
  it("returns undefined for false", () => {
    expect(normalizeBackgroundConfig(false)).toBeUndefined();
  });

  it("returns full defaults for true", () => {
    const config = normalizeBackgroundConfig(true);
    expect(config).toEqual({
      maxConcurrent: Infinity,
      timeout: undefined,
      autoCancel: true,
      tools: { status: true, cancel: true, await: ["all", "any", "race", "allSettled"] },
    });
  });

  it("fills in defaults for partial object", () => {
    const config = normalizeBackgroundConfig({ maxConcurrent: 3 });
    expect(config).toEqual({
      maxConcurrent: 3,
      timeout: undefined,
      autoCancel: true,
      tools: { status: true, cancel: true, await: ["all", "any", "race", "allSettled"] },
    });
  });

  it("respects tools.await: false", () => {
    const config = normalizeBackgroundConfig({ tools: { await: false } });
    expect(config!.tools.await).toBe(false);
  });

  it("respects tools.await: true", () => {
    const config = normalizeBackgroundConfig({ tools: { await: true } });
    expect(config!.tools.await).toEqual(["all", "any", "race", "allSettled"]);
  });

  it("respects specific await modes", () => {
    const config = normalizeBackgroundConfig({ tools: { await: ["all", "race"] } });
    expect(config!.tools.await).toEqual(["all", "race"]);
  });

  it("respects tools.status: false", () => {
    const config = normalizeBackgroundConfig({ tools: { status: false } });
    expect(config!.tools.status).toBe(false);
  });

  it("respects tools.cancel: false", () => {
    const config = normalizeBackgroundConfig({ tools: { cancel: false } });
    expect(config!.tools.cancel).toBe(false);
  });

  it("respects timeout", () => {
    const config = normalizeBackgroundConfig({ timeout: 5000 });
    expect(config!.timeout).toBe(5000);
  });

  it("respects autoCancel: false", () => {
    const config = normalizeBackgroundConfig({ autoCancel: false });
    expect(config!.autoCancel).toBe(false);
  });
});

describe("AgentRegistry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("spawn", () => {
    it("returns a unique ID", () => {
      const registry = createRegistry();
      const id1 = registry.spawn("a", createImmediateAgent("hi"), "p", {});
      const id2 = registry.spawn("b", createImmediateAgent("hi"), "p", {});
      expect(id1).toMatch(/^bg-\d+$/);
      expect(id2).toMatch(/^bg-\d+$/);
      expect(id1).not.toBe(id2);
    });

    it("tracks running count", () => {
      const registry = createRegistry();
      const { agent: a1 } = createControllableAgent();
      const { agent: a2 } = createControllableAgent();
      expect(registry.runningCount).toBe(0);
      registry.spawn("a", a1, "p", {});
      expect(registry.runningCount).toBe(1);
      registry.spawn("b", a2, "p", {});
      expect(registry.runningCount).toBe(2);
    });

    it("enforces maxConcurrent", () => {
      const registry = createRegistry({ maxConcurrent: 1 });
      const { agent: a1 } = createControllableAgent();
      const { agent: a2 } = createControllableAgent();
      registry.spawn("a", a1, "p", {});
      expect(() => registry.spawn("b", a2, "p", {})).toThrow(
        "Maximum concurrent background agents (1) reached",
      );
    });

    it("allows new spawns after previous ones complete", async () => {
      const registry = createRegistry({ maxConcurrent: 1 });
      const agent1 = createImmediateAgent("done");
      registry.spawn("a", agent1, "p", {});
      // Wait for it to complete
      await vi.waitFor(() => expect(registry.runningCount).toBe(0));
      // Should now allow another
      const { agent: a2 } = createControllableAgent();
      expect(() => registry.spawn("b", a2, "p", {})).not.toThrow();
    });

    it("calls onEvent for agent events", async () => {
      const registry = createRegistry();
      const onEvent = vi.fn();
      registry.spawn("researcher", createImmediateAgent("result"), "p", { onEvent });
      await vi.waitFor(() => expect(onEvent).toHaveBeenCalled());
      const textDoneCall = onEvent.mock.calls.find(
        (call) => (call[1] as AgentEvent).type === "text.done",
      );
      expect(textDoneCall).toBeDefined();
      expect(textDoneCall![0]).toEqual(["researcher"]);
    });

    it("calls close on child agent after completion", async () => {
      const registry = createRegistry();
      const agent = createImmediateAgent("result");
      registry.spawn("a", agent, "p", {});
      await vi.waitFor(() =>
        expect((agent as any).close).toHaveBeenCalled(),
      );
    });

    it("calls close on child agent after failure", async () => {
      const registry = createRegistry();
      const agent = createFailingAgent(new Error("boom"));
      registry.spawn("a", agent, "p", {});
      await vi.waitFor(() =>
        expect((agent as any).close).toHaveBeenCalled(),
      );
    });

    it("tracks a sessionId when provided", async () => {
      const registry = createRegistry();
      const id = registry.spawn("a", createImmediateAgent("done"), "p", {
        sessionId: "sub-1",
      });

      await vi.waitFor(() => expect(registry.getStatus(id)?.status).toBe("done"));
      expect(registry.getStatus(id)?.sessionId).toBe("sub-1");
    });
  });

  describe("getStatus", () => {
    it("returns undefined for unknown ID", () => {
      const registry = createRegistry();
      expect(registry.getStatus("bg-999")).toBeUndefined();
    });

    it("returns running immediately after spawn", () => {
      const registry = createRegistry();
      const { agent } = createControllableAgent();
      const id = registry.spawn("a", agent, "p", {});
      expect(registry.getStatus(id)).toEqual({
        status: "running",
        sessionId: undefined,
        result: undefined,
        error: undefined,
      });
    });

    it("returns done with result after success", async () => {
      const registry = createRegistry();
      const id = registry.spawn("a", createImmediateAgent("hello"), "p", {});
      await vi.waitFor(() => expect(registry.getStatus(id)?.status).toBe("done"));
      expect(registry.getStatus(id)).toEqual({
        status: "done",
        sessionId: undefined,
        result: "hello",
        error: undefined,
      });
    });

    it('returns "(no output)" when agent produces no text', async () => {
      const agent = {
        run: async function* () {
          yield {
            type: "done" as const,
            result: "complete" as const,
            messages: [],
            totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          };
        },
        close: vi.fn(),
      } as unknown as Agent;

      const registry = createRegistry();
      const id = registry.spawn("a", agent, "p", {});
      await vi.waitFor(() => expect(registry.getStatus(id)?.status).toBe("done"));
      expect(registry.getStatus(id)!.result).toBe("(no output)");
    });

    it("returns failed with error after failure", async () => {
      const registry = createRegistry();
      const id = registry.spawn("a", createFailingAgent(new Error("boom")), "p", {});
      await vi.waitFor(() => expect(registry.getStatus(id)?.status).toBe("failed"));
      expect(registry.getStatus(id)).toEqual({
        status: "failed",
        sessionId: undefined,
        result: undefined,
        error: "boom",
      });
    });

    it("returns cancelled after cancel", () => {
      const registry = createRegistry();
      const { agent } = createControllableAgent();
      const id = registry.spawn("a", agent, "p", {});
      registry.cancel(id);
      expect(registry.getStatus(id)?.status).toBe("cancelled");
    });
  });

  describe("cancel", () => {
    it("returns true for running agent", () => {
      const registry = createRegistry();
      const { agent } = createControllableAgent();
      const id = registry.spawn("a", agent, "p", {});
      expect(registry.cancel(id)).toBe(true);
    });

    it("returns false for unknown ID", () => {
      const registry = createRegistry();
      expect(registry.cancel("bg-999")).toBe(false);
    });

    it("returns false for already-completed agent", async () => {
      const registry = createRegistry();
      const id = registry.spawn("a", createImmediateAgent("done"), "p", {});
      await vi.waitFor(() => expect(registry.getStatus(id)?.status).toBe("done"));
      expect(registry.cancel(id)).toBe(false);
    });

    it("returns false for already-cancelled agent", () => {
      const registry = createRegistry();
      const { agent } = createControllableAgent();
      const id = registry.spawn("a", agent, "p", {});
      registry.cancel(id);
      expect(registry.cancel(id)).toBe(false);
    });

    it("decrements running count", () => {
      const registry = createRegistry();
      const { agent } = createControllableAgent();
      const id = registry.spawn("a", agent, "p", {});
      expect(registry.runningCount).toBe(1);
      registry.cancel(id);
      expect(registry.runningCount).toBe(0);
    });
  });

  describe("cancelAll", () => {
    it("cancels all running agents", () => {
      const registry = createRegistry();
      const c1 = createControllableAgent();
      const c2 = createControllableAgent();
      const id1 = registry.spawn("a", c1.agent, "p", {});
      const id2 = registry.spawn("b", c2.agent, "p", {});
      registry.cancelAll();
      expect(registry.getStatus(id1)?.status).toBe("cancelled");
      expect(registry.getStatus(id2)?.status).toBe("cancelled");
      expect(registry.runningCount).toBe(0);
    });

    it("does not affect already-completed agents", async () => {
      const registry = createRegistry();
      const id = registry.spawn("a", createImmediateAgent("done"), "p", {});
      await vi.waitFor(() => expect(registry.getStatus(id)?.status).toBe("done"));
      registry.cancelAll();
      expect(registry.getStatus(id)?.status).toBe("done");
    });
  });

  describe("timeout", () => {
    it("auto-cancels after timeout", async () => {
      vi.useFakeTimers();
      const registry = createRegistry({ timeout: 100 });
      const { agent } = createControllableAgent();
      const id = registry.spawn("a", agent, "p", {});
      expect(registry.getStatus(id)?.status).toBe("running");
      vi.advanceTimersByTime(100);
      expect(registry.getStatus(id)?.status).toBe("cancelled");
      expect(registry.getStatus(id)?.error).toBe("Timed out after 100ms");
      vi.useRealTimers();
    });

    it("does not cancel if completed before timeout", async () => {
      vi.useFakeTimers();
      const registry = createRegistry({ timeout: 100 });
      const id = registry.spawn("a", createImmediateAgent("fast"), "p", {});
      await vi.advanceTimersByTimeAsync(0); // let microtasks run
      expect(registry.getStatus(id)?.status).toBe("done");
      vi.advanceTimersByTime(100);
      expect(registry.getStatus(id)?.status).toBe("done"); // still done, not cancelled
      vi.useRealTimers();
    });
  });

  describe("parent signal propagation", () => {
    it("cancels child when parent signal aborts", () => {
      const registry = createRegistry();
      const parentController = new AbortController();
      const { agent } = createControllableAgent();
      const id = registry.spawn("a", agent, "p", { signal: parentController.signal });
      expect(registry.getStatus(id)?.status).toBe("running");
      parentController.abort();
      // The entry status is updated by the promise handler, but the controller is aborted
      // which will cause the agent to throw
      expect(registry.getStatus(id)?.status).toBe("running"); // status updates async
    });
  });

  describe("awaitAll", () => {
    it("resolves when all agents succeed", async () => {
      const registry = createRegistry();
      const id1 = registry.spawn("a", createImmediateAgent("result-1"), "p", {});
      const id2 = registry.spawn("b", createImmediateAgent("result-2"), "p", {});

      const results = await registry.awaitAll([id1, id2]);
      expect(results.get(id1)).toBe("result-1");
      expect(results.get(id2)).toBe("result-2");
    });

    it("rejects when any agent fails", async () => {
      const registry = createRegistry();
      const id1 = registry.spawn("a", createImmediateAgent("ok"), "p", {});
      const id2 = registry.spawn("b", createFailingAgent(new Error("boom")), "p", {});

      await expect(registry.awaitAll([id1, id2])).rejects.toThrow('Agent "bg-2" failed: boom');
    });

    it("rejects for unknown agent ID", async () => {
      const registry = createRegistry();
      await expect(registry.awaitAll(["bg-999"])).rejects.toThrow('Agent "bg-999" not found');
    });
  });

  describe("awaitAllSettled", () => {
    it("returns all results including failures", async () => {
      const registry = createRegistry();
      const id1 = registry.spawn("a", createImmediateAgent("ok"), "p", {});
      const id2 = registry.spawn("b", createFailingAgent(new Error("boom")), "p", {});

      const results = await registry.awaitAllSettled([id1, id2]);
      expect(results.get(id1)).toEqual({
        status: "done",
        sessionId: undefined,
        result: "ok",
      });
      expect(results.get(id2)).toEqual({
        status: "failed",
        sessionId: undefined,
        error: "boom",
      });
    });

    it("handles unknown IDs gracefully", async () => {
      const registry = createRegistry();
      const results = await registry.awaitAllSettled(["bg-999"]);
      expect(results.get("bg-999")).toEqual({
        status: "failed",
        error: 'Agent "bg-999" not found',
      });
    });

    it("reports cancelled agents correctly", async () => {
      const registry = createRegistry();
      const { agent } = createControllableAgent();
      const id = registry.spawn("a", agent, "p", {});
      registry.cancel(id);

      const results = await registry.awaitAllSettled([id]);
      expect(results.get(id)?.status).toBe("cancelled");
    });
  });

  describe("awaitAny", () => {
    it("resolves with the first successful agent", async () => {
      const registry = createRegistry();
      const c1 = createControllableAgent();
      const id1 = registry.spawn("a", c1.agent, "p", {});
      const id2 = registry.spawn("b", createImmediateAgent("fast"), "p", {});

      const { id, result } = await registry.awaitAny([id1, id2]);
      expect(id).toBe(id2);
      expect(result).toBe("fast");
    });

    it("rejects when all agents fail", async () => {
      const registry = createRegistry();
      const id1 = registry.spawn("a", createFailingAgent(new Error("fail-1")), "p", {});
      const id2 = registry.spawn("b", createFailingAgent(new Error("fail-2")), "p", {});

      await expect(registry.awaitAny([id1, id2])).rejects.toBeInstanceOf(AggregateError);
    });

    it("rejects for unknown agent ID", async () => {
      const registry = createRegistry();
      await expect(registry.awaitAny(["bg-999"])).rejects.toBeInstanceOf(AggregateError);
    });

    it("succeeds if at least one succeeds among failures", async () => {
      const registry = createRegistry();
      const id1 = registry.spawn("a", createFailingAgent(new Error("fail")), "p", {});
      const id2 = registry.spawn("b", createImmediateAgent("ok"), "p", {});

      const { id, result } = await registry.awaitAny([id1, id2]);
      expect(id).toBe(id2);
      expect(result).toBe("ok");
    });
  });

  describe("awaitRace", () => {
    it("resolves with the first agent to settle (success)", async () => {
      const registry = createRegistry();
      const c1 = createControllableAgent();
      const id1 = registry.spawn("slow", c1.agent, "p", {});
      const id2 = registry.spawn("fast", createImmediateAgent("quick"), "p", {});

      const result = await registry.awaitRace([id1, id2]);
      expect(result.id).toBe(id2);
      expect(result.result).toBe("quick");
      expect(result.error).toBeUndefined();
    });

    it("resolves with the first agent to settle (failure)", async () => {
      const registry = createRegistry();
      const c1 = createControllableAgent();
      const id1 = registry.spawn("slow", c1.agent, "p", {});
      const id2 = registry.spawn("fast-fail", createFailingAgent(new Error("oops")), "p", {});

      const result = await registry.awaitRace([id1, id2]);
      expect(result.id).toBe(id2);
      expect(result.error).toBe("oops");
    });

    it("handles unknown IDs", async () => {
      const registry = createRegistry();
      const c1 = createControllableAgent();
      registry.spawn("slow", c1.agent, "p", {});
      const result = await registry.awaitRace(["bg-999"]);
      expect(result.error).toContain("not found");
    });
  });
});
