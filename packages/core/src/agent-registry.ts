import type { Agent, SubagentEventFn } from "./agent.js";

// ── User-facing config type ─────────────────────────────────────────

export type AwaitMode = "all" | "any" | "race" | "allSettled";

export type SubagentBackground =
  | boolean
  | {
      /** Maximum number of concurrent background agents. Defaults to `Infinity`. */
      maxConcurrent?: number;
      /** Auto-cancel background agents after this many milliseconds. No timeout by default. */
      timeout?: number;
      /** Cancel all running background agents when the parent agent closes. Defaults to `true`. */
      autoCancel?: boolean;
      /** Which lifecycle tools to register. */
      tools?: {
        /** Register the `agent_status` tool. Defaults to `true`. */
        status?: boolean;
        /** Register the `agent_cancel` tool. Defaults to `true`. */
        cancel?: boolean;
        /** Register the `agent_await` tool with these modes. `true` enables all modes. `false` disables. Defaults to all modes. */
        await?: boolean | AwaitMode[];
      };
    };

// ── Normalized internal config ──────────────────────────────────────

export interface BackgroundAgentConfig {
  maxConcurrent: number;
  timeout: number | undefined;
  autoCancel: boolean;
  tools: {
    status: boolean;
    cancel: boolean;
    await: AwaitMode[] | false;
  };
}

const ALL_AWAIT_MODES: AwaitMode[] = ["all", "any", "race", "allSettled"];

export function normalizeBackgroundConfig(
  input: SubagentBackground,
): BackgroundAgentConfig | undefined {
  if (!input) return undefined;

  if (input === true) {
    return {
      maxConcurrent: Infinity,
      timeout: undefined,
      autoCancel: true,
      tools: { status: true, cancel: true, await: ALL_AWAIT_MODES },
    };
  }

  const awaitOpt = input.tools?.await;
  const awaitModes: AwaitMode[] | false =
    awaitOpt === false
      ? false
      : awaitOpt === true || awaitOpt === undefined
        ? ALL_AWAIT_MODES
        : awaitOpt;

  return {
    maxConcurrent: input.maxConcurrent ?? Infinity,
    timeout: input.timeout,
    autoCancel: input.autoCancel ?? true,
    tools: {
      status: input.tools?.status ?? true,
      cancel: input.tools?.cancel ?? true,
      await: awaitModes,
    },
  };
}

// ── Registry types ──────────────────────────────────────────────────

export type AgentStatus = "running" | "done" | "failed" | "cancelled";

export interface SettledResult {
  status: "done" | "failed" | "cancelled";
  result?: string;
  error?: string;
}

interface RegistryEntry {
  promise: Promise<string>;
  controller: AbortController;
  status: AgentStatus;
  result?: string;
  error?: string;
  timeoutId?: ReturnType<typeof setTimeout>;
}

// ── AgentRegistry ───────────────────────────────────────────────────

export class AgentRegistry {
  private agents = new Map<string, RegistryEntry>();
  private idCounter = 0;

  constructor(private config: BackgroundAgentConfig) {}

  get runningCount(): number {
    let count = 0;
    for (const entry of this.agents.values()) {
      if (entry.status === "running") count++;
    }
    return count;
  }

  /**
   * Spawn a child agent in the background. Returns an ID to track it.
   */
  spawn(
    name: string,
    child: Agent,
    prompt: string,
    opts: { signal?: AbortSignal; onEvent?: SubagentEventFn },
  ): string {
    if (
      this.config.maxConcurrent !== Infinity &&
      this.runningCount >= this.config.maxConcurrent
    ) {
      throw new Error(
        `Maximum concurrent background agents (${this.config.maxConcurrent}) reached`,
      );
    }

    const id = `bg-${++this.idCounter}`;
    const controller = new AbortController();

    // Link to parent abort signal
    if (opts.signal) {
      opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    const entry: RegistryEntry = {
      promise: undefined!,
      controller,
      status: "running",
    };

    // Auto-timeout
    if (this.config.timeout) {
      entry.timeoutId = setTimeout(() => {
        if (entry.status === "running") {
          controller.abort();
          entry.status = "cancelled";
          entry.error = `Timed out after ${this.config.timeout}ms`;
        }
      }, this.config.timeout);
    }

    entry.promise = (async () => {
      try {
        let lastText = "";
        for await (const event of child.run([], prompt, { signal: controller.signal })) {
          opts.onEvent?.([name], event);
          if (event.type === "text.done") {
            lastText = event.text;
          }
        }
        entry.status = "done";
        entry.result = lastText || "(no output)";
        return entry.result;
      } catch (e) {
        if (controller.signal.aborted && entry.status !== "cancelled") {
          entry.status = "cancelled";
        } else if (entry.status === "running") {
          entry.status = "failed";
        }
        entry.error = e instanceof Error ? e.message : String(e);
        throw e;
      } finally {
        if (entry.timeoutId) clearTimeout(entry.timeoutId);
        await child.close();
      }
    })();

    // Prevent unhandled rejection warnings — errors are tracked in entry.status/error
    entry.promise.catch(() => {});

    this.agents.set(id, entry);
    return id;
  }

  /**
   * Non-blocking status check.
   */
  getStatus(id: string): { status: AgentStatus; result?: string; error?: string } | undefined {
    const entry = this.agents.get(id);
    if (!entry) return undefined;
    return { status: entry.status, result: entry.result, error: entry.error };
  }

  /**
   * Cancel a running background agent.
   */
  cancel(id: string): boolean {
    const entry = this.agents.get(id);
    if (!entry || entry.status !== "running") return false;
    entry.controller.abort();
    entry.status = "cancelled";
    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    return true;
  }

  /**
   * Promise.all — wait for all to succeed. Rejects on first failure.
   */
  async awaitAll(ids: string[]): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    await Promise.all(
      ids.map(async (id) => {
        const entry = this.agents.get(id);
        if (!entry) throw new Error(`Agent "${id}" not found`);
        try {
          const result = await entry.promise;
          results.set(id, result);
        } catch {
          throw new Error(`Agent "${id}" failed: ${entry.error ?? "unknown error"}`);
        }
      }),
    );
    return results;
  }

  /**
   * Promise.allSettled — wait for all, return results and errors.
   */
  async awaitAllSettled(ids: string[]): Promise<Map<string, SettledResult>> {
    const results = new Map<string, SettledResult>();
    await Promise.allSettled(
      ids.map(async (id) => {
        const entry = this.agents.get(id);
        if (!entry) {
          results.set(id, { status: "failed", error: `Agent "${id}" not found` });
          return;
        }
        try {
          const result = await entry.promise;
          results.set(id, { status: "done", result });
        } catch {
          results.set(id, {
            status: entry.status === "cancelled" ? "cancelled" : "failed",
            error: entry.error,
          });
        }
      }),
    );
    return results;
  }

  /**
   * Promise.any — first success wins. Rejects only if all fail.
   */
  async awaitAny(ids: string[]): Promise<{ id: string; result: string }> {
    return Promise.any(
      ids.map(async (id) => {
        const entry = this.agents.get(id);
        if (!entry) throw new Error(`Agent "${id}" not found`);
        const result = await entry.promise;
        return { id, result };
      }),
    );
  }

  /**
   * Promise.race — first to settle (success or failure) wins.
   */
  async awaitRace(ids: string[]): Promise<{ id: string; result?: string; error?: string }> {
    return Promise.race(
      ids.map(async (id) => {
        const entry = this.agents.get(id);
        if (!entry) return { id, error: `Agent "${id}" not found` };
        try {
          const result = await entry.promise;
          return { id, result };
        } catch {
          return { id, error: entry.error ?? "unknown error" };
        }
      }),
    );
  }

  /**
   * Cancel all running background agents.
   */
  cancelAll(): void {
    for (const entry of this.agents.values()) {
      if (entry.status === "running") {
        entry.controller.abort();
        entry.status = "cancelled";
        if (entry.timeoutId) clearTimeout(entry.timeoutId);
      }
    }
  }
}
