import { describe, it, expect } from "vitest";
import { sessionEventsToUIStream } from "../ui-stream.js";
import type { SessionEvent } from "../session.js";

// ── Helpers ─────────────────────────────────────────────────────────

async function collectChunks(events: SessionEvent[]): Promise<any[]> {
  async function* gen() {
    for (const e of events) yield e;
  }
  const stream = sessionEventsToUIStream(gen());
  const reader = stream.getReader();
  const chunks: any[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

function findChunks(chunks: any[], type: string): any[] {
  return chunks.filter((c) => c.type === type);
}

// ── Tests ───────────────────────────────────────────────────────────

describe("sessionEventsToUIStream", () => {
  describe("stream lifecycle", () => {
    it("emits start chunk at the beginning", async () => {
      const chunks = await collectChunks([]);
      expect(chunks[0]).toEqual({ type: "start" });
    });

    it("emits finish chunk on done event", async () => {
      const chunks = await collectChunks([
        {
          type: "done",
          result: "complete",
          messages: [],
          totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        },
      ]);
      const finish = findChunks(chunks, "finish");
      expect(finish).toHaveLength(1);
      expect(finish[0].finishReason).toBe("stop");
    });

    it("maps result types to correct finish reasons", async () => {
      const cases: Array<[string, string]> = [
        ["complete", "stop"],
        ["max_steps", "tool-calls"],
        ["error", "error"],
        ["stopped", "unknown"],
      ];

      for (const [result, expected] of cases) {
        const chunks = await collectChunks([
          {
            type: "done",
            result: result as any,
            messages: [],
            totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          },
        ]);
        const finish = findChunks(chunks, "finish");
        expect(finish[0].finishReason).toBe(expected);
      }
    });
  });

  describe("text streaming", () => {
    it("emits text-start before first text-delta", async () => {
      const chunks = await collectChunks([
        { type: "text.delta", text: "Hello" },
        { type: "text.done", text: "Hello world" },
      ]);

      const textStart = findChunks(chunks, "text-start");
      expect(textStart).toHaveLength(1);
      expect(textStart[0].id).toBeTruthy();
    });

    it("emits text-delta with matching id", async () => {
      const chunks = await collectChunks([
        { type: "text.delta", text: "Hello" },
        { type: "text.delta", text: " world" },
        { type: "text.done", text: "Hello world" },
      ]);

      const textStart = findChunks(chunks, "text-start")[0];
      const deltas = findChunks(chunks, "text-delta");
      expect(deltas).toHaveLength(2);
      expect(deltas[0].id).toBe(textStart.id);
      expect(deltas[0].delta).toBe("Hello");
      expect(deltas[1].delta).toBe(" world");
    });

    it("emits text-end on text.done", async () => {
      const chunks = await collectChunks([
        { type: "text.delta", text: "Hi" },
        { type: "text.done", text: "Hi" },
      ]);

      const textStart = findChunks(chunks, "text-start")[0];
      const textEnd = findChunks(chunks, "text-end");
      expect(textEnd).toHaveLength(1);
      expect(textEnd[0].id).toBe(textStart.id);
    });
  });

  describe("reasoning streaming", () => {
    it("emits reasoning-start before first reasoning-delta", async () => {
      const chunks = await collectChunks([
        { type: "reasoning.delta", text: "thinking" },
        { type: "reasoning.done", text: "thinking" },
      ]);

      const start = findChunks(chunks, "reasoning-start");
      expect(start).toHaveLength(1);
    });

    it("emits reasoning-delta and reasoning-end", async () => {
      const chunks = await collectChunks([
        { type: "reasoning.delta", text: "step 1" },
        { type: "reasoning.delta", text: " step 2" },
        { type: "reasoning.done", text: "step 1 step 2" },
      ]);

      const start = findChunks(chunks, "reasoning-start")[0];
      const deltas = findChunks(chunks, "reasoning-delta");
      const end = findChunks(chunks, "reasoning-end");

      expect(deltas).toHaveLength(2);
      expect(deltas[0].id).toBe(start.id);
      expect(end).toHaveLength(1);
      expect(end[0].id).toBe(start.id);
    });

    it("closes text part before starting reasoning", async () => {
      const chunks = await collectChunks([
        { type: "text.delta", text: "Hi" },
        { type: "reasoning.delta", text: "think" },
        { type: "reasoning.done", text: "think" },
      ]);

      const types = chunks.map((c) => c.type);
      const textEndIdx = types.indexOf("text-end");
      const reasoningStartIdx = types.indexOf("reasoning-start");
      expect(textEndIdx).toBeLessThan(reasoningStartIdx);
    });
  });

  describe("tool events", () => {
    it("emits tool-input-start and tool-input-available on tool.start", async () => {
      const chunks = await collectChunks([
        {
          type: "tool.start",
          toolCallId: "tc-1",
          toolName: "readFile",
          input: { path: "/test" },
        },
      ]);

      const inputStart = findChunks(chunks, "tool-input-start");
      expect(inputStart).toHaveLength(1);
      expect(inputStart[0]).toEqual({
        type: "tool-input-start",
        toolCallId: "tc-1",
        toolName: "readFile",
      });

      const inputAvailable = findChunks(chunks, "tool-input-available");
      expect(inputAvailable).toHaveLength(1);
      expect(inputAvailable[0].input).toEqual({ path: "/test" });
    });

    it("emits tool-output-available on tool.done", async () => {
      const chunks = await collectChunks([
        {
          type: "tool.done",
          toolCallId: "tc-1",
          toolName: "readFile",
          output: { content: "file contents" },
        },
      ]);

      const output = findChunks(chunks, "tool-output-available");
      expect(output).toHaveLength(1);
      expect(output[0]).toEqual({
        type: "tool-output-available",
        toolCallId: "tc-1",
        output: { content: "file contents" },
      });
    });

    it("emits tool-output-error on tool.error", async () => {
      const chunks = await collectChunks([
        {
          type: "tool.error",
          toolCallId: "tc-1",
          toolName: "readFile",
          error: "File not found",
        },
      ]);

      const errors = findChunks(chunks, "tool-output-error");
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual({
        type: "tool-output-error",
        toolCallId: "tc-1",
        errorText: "File not found",
      });
    });

    it("closes text/reasoning parts before tool events", async () => {
      const chunks = await collectChunks([
        { type: "text.delta", text: "Let me check" },
        {
          type: "tool.start",
          toolCallId: "tc-1",
          toolName: "readFile",
          input: {},
        },
      ]);

      const types = chunks.map((c) => c.type);
      const textEndIdx = types.indexOf("text-end");
      const toolStartIdx = types.indexOf("tool-input-start");
      expect(textEndIdx).toBeLessThan(toolStartIdx);
    });
  });

  describe("subagent detection via task tool", () => {
    it("emits data-oh:subagent.start for task tool calls", async () => {
      const chunks = await collectChunks([
        {
          type: "tool.start",
          toolCallId: "tc-1",
          toolName: "task",
          input: { agent: "explore", prompt: "search codebase" },
        },
      ]);

      const subStart = findChunks(chunks, "data-oh:subagent.start");
      expect(subStart).toHaveLength(1);
      expect(subStart[0].data).toEqual({
        agentName: "explore",
        task: "search codebase",
        path: ["explore"],
      });
    });

    it("emits data-oh:subagent.done when task tool completes", async () => {
      const chunks = await collectChunks([
        {
          type: "tool.start",
          toolCallId: "tc-1",
          toolName: "task",
          input: { agent: "explore", prompt: "search" },
        },
        {
          type: "tool.done",
          toolCallId: "tc-1",
          toolName: "task",
          output: "result",
        },
      ]);

      const subDone = findChunks(chunks, "data-oh:subagent.done");
      expect(subDone).toHaveLength(1);
      expect(subDone[0].data.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("carries sessionId metadata for resumable task tools", async () => {
      const chunks = await collectChunks([
        {
          type: "tool.start",
          toolCallId: "tc-1",
          toolName: "task",
          input: {
            agent: "explore",
            prompt: "search",
            session: { mode: "resume", id: "sub-123" },
          },
        },
        {
          type: "tool.done",
          toolCallId: "tc-1",
          toolName: "task",
          output: '<task_result session_id="sub-123">result</task_result>',
        },
      ]);

      const subStart = findChunks(chunks, "data-oh:subagent.start");
      const subDone = findChunks(chunks, "data-oh:subagent.done");
      expect(subStart[0].data.sessionId).toBe("sub-123");
      expect(subDone[0].data.sessionId).toBe("sub-123");
    });

    it("emits data-oh:subagent.error when task tool fails", async () => {
      const chunks = await collectChunks([
        {
          type: "tool.start",
          toolCallId: "tc-1",
          toolName: "task",
          input: { agent: "explore", prompt: "search" },
        },
        {
          type: "tool.error",
          toolCallId: "tc-1",
          toolName: "task",
          error: "Agent crashed",
        },
      ]);

      const subError = findChunks(chunks, "data-oh:subagent.error");
      expect(subError).toHaveLength(1);
      expect(subError[0].data.error).toBe("Agent crashed");
    });

    it("emits data-oh:subagent.start for background task tool calls", async () => {
      const chunks = await collectChunks([
        {
          type: "tool.start",
          toolCallId: "tc-bg",
          toolName: "task",
          input: { agent: "researcher", prompt: "find info", background: true },
        },
      ]);

      const subStart = findChunks(chunks, "data-oh:subagent.start");
      expect(subStart).toHaveLength(1);
      expect(subStart[0].data).toEqual({
        agentName: "researcher",
        task: "find info",
        path: ["researcher"],
      });
    });

    it("suppresses data-oh:subagent.done for background task tool calls", async () => {
      const chunks = await collectChunks([
        {
          type: "tool.start",
          toolCallId: "tc-bg",
          toolName: "task",
          input: { agent: "researcher", prompt: "find info", background: true },
        },
        {
          type: "tool.done",
          toolCallId: "tc-bg",
          toolName: "task",
          output: '<background_spawn agent_id="bg-1">spawned</background_spawn>',
        },
      ]);

      const subDone = findChunks(chunks, "data-oh:subagent.done");
      expect(subDone).toHaveLength(0);
    });

    it("still emits data-oh:subagent.done for foreground task tool calls", async () => {
      const chunks = await collectChunks([
        {
          type: "tool.start",
          toolCallId: "tc-fg",
          toolName: "task",
          input: { agent: "coder", prompt: "fix bug" },
        },
        {
          type: "tool.done",
          toolCallId: "tc-fg",
          toolName: "task",
          output: "<task_result>fixed</task_result>",
        },
      ]);

      const subDone = findChunks(chunks, "data-oh:subagent.done");
      expect(subDone).toHaveLength(1);
    });

    it("emits data-oh:subagent.error for background task tool errors", async () => {
      const chunks = await collectChunks([
        {
          type: "tool.start",
          toolCallId: "tc-bg",
          toolName: "task",
          input: { agent: "researcher", prompt: "find info", background: true },
        },
        {
          type: "tool.error",
          toolCallId: "tc-bg",
          toolName: "task",
          error: "Spawn failed",
        },
      ]);

      const subError = findChunks(chunks, "data-oh:subagent.error");
      expect(subError).toHaveLength(1);
      expect(subError[0].data.error).toBe("Spawn failed");
    });

    it("handles mixed foreground and background task calls", async () => {
      const chunks = await collectChunks([
        {
          type: "tool.start",
          toolCallId: "tc-bg",
          toolName: "task",
          input: { agent: "researcher", prompt: "bg work", background: true },
        },
        {
          type: "tool.start",
          toolCallId: "tc-fg",
          toolName: "task",
          input: { agent: "coder", prompt: "fg work" },
        },
        {
          type: "tool.done",
          toolCallId: "tc-bg",
          toolName: "task",
          output: "spawned",
        },
        {
          type: "tool.done",
          toolCallId: "tc-fg",
          toolName: "task",
          output: "completed",
        },
      ]);

      const subStart = findChunks(chunks, "data-oh:subagent.start");
      expect(subStart).toHaveLength(2);

      const subDone = findChunks(chunks, "data-oh:subagent.done");
      expect(subDone).toHaveLength(1);
      expect(subDone[0].data.agentName).toBe("coder");
    });

    it("does not emit subagent events for regular tools", async () => {
      const chunks = await collectChunks([
        {
          type: "tool.start",
          toolCallId: "tc-1",
          toolName: "readFile",
          input: { path: "/test" },
        },
        {
          type: "tool.done",
          toolCallId: "tc-1",
          toolName: "readFile",
          output: "ok",
        },
      ]);

      const subEvents = chunks.filter((c) =>
        c.type?.startsWith("data-oh:subagent."),
      );
      expect(subEvents).toHaveLength(0);
    });
  });

  describe("step events", () => {
    it("emits start-step and finish-step", async () => {
      const chunks = await collectChunks([
        { type: "step.start", stepNumber: 1 },
        { type: "text.delta", text: "Hi" },
        { type: "text.done", text: "Hi" },
        {
          type: "step.done",
          stepNumber: 1,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          finishReason: "stop",
        },
      ]);

      expect(findChunks(chunks, "start-step")).toHaveLength(1);
      expect(findChunks(chunks, "finish-step")).toHaveLength(1);
    });
  });

  describe("session lifecycle data parts", () => {
    it("emits turn start/done data parts", async () => {
      const chunks = await collectChunks([
        { type: "turn.start", turnNumber: 3 },
        {
          type: "turn.done",
          turnNumber: 3,
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        },
      ]);

      const turnStart = findChunks(chunks, "data-oh:turn.start");
      expect(turnStart).toHaveLength(1);
      expect(turnStart[0].data).toEqual({ turnIndex: 3 });

      const turnDone = findChunks(chunks, "data-oh:turn.done");
      expect(turnDone).toHaveLength(1);
      expect(turnDone[0].data.turnIndex).toBe(3);
    });

    it("emits compaction data parts", async () => {
      const chunks = await collectChunks([
        { type: "compaction.start", reason: "overflow" as const, tokensBefore: 50000 },
        { type: "compaction.pruned", tokensRemoved: 10000, messagesRemoved: 5 },
        { type: "compaction.done", tokensBefore: 50000, tokensAfter: 30000 },
      ]);

      expect(findChunks(chunks, "data-oh:session.compacting")).toHaveLength(1);
      expect(findChunks(chunks, "data-oh:compaction.start")).toHaveLength(1);

      const compDone = findChunks(chunks, "data-oh:compaction.done");
      // One from pruned, one from done
      expect(compDone.length).toBeGreaterThanOrEqual(1);
    });

    it("emits retry data part", async () => {
      const chunks = await collectChunks([
        {
          type: "retry",
          attempt: 1,
          maxRetries: 3,
          delayMs: 2000,
          error: new Error("rate limit exceeded"),
        },
      ]);

      const retry = findChunks(chunks, "data-oh:retry");
      expect(retry).toHaveLength(1);
      expect(retry[0].data).toEqual({
        attempt: 1,
        reason: "rate limit exceeded",
        delayMs: 2000,
      });
    });
  });

  describe("error handling", () => {
    it("emits error chunk on error event", async () => {
      const chunks = await collectChunks([
        { type: "error", error: new Error("something went wrong") },
      ]);

      const errors = findChunks(chunks, "error");
      expect(errors).toHaveLength(1);
      expect(errors[0].errorText).toBe("something went wrong");
    });

    it("emits error chunk when generator throws", async () => {
      async function* throwingGen(): AsyncGenerator<SessionEvent> {
        throw new Error("generator exploded");
      }
      const stream = sessionEventsToUIStream(throwingGen());
      const reader = stream.getReader();
      const chunks: any[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const errors = chunks.filter((c) => c.type === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0].errorText).toBe("generator exploded");
    });
  });

  describe("full conversation flow", () => {
    it("handles a complete multi-step conversation", async () => {
      const events: SessionEvent[] = [
        { type: "turn.start", turnNumber: 1 },
        { type: "step.start", stepNumber: 1 },
        { type: "text.delta", text: "Let me " },
        { type: "text.delta", text: "check." },
        { type: "text.done", text: "Let me check." },
        {
          type: "tool.start",
          toolCallId: "tc-1",
          toolName: "readFile",
          input: { path: "/src/index.ts" },
        },
        {
          type: "tool.done",
          toolCallId: "tc-1",
          toolName: "readFile",
          output: { content: "export {}" },
        },
        {
          type: "step.done",
          stepNumber: 1,
          usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
          finishReason: "tool-calls",
        },
        { type: "step.start", stepNumber: 2 },
        { type: "text.delta", text: "The file exports nothing." },
        { type: "text.done", text: "The file exports nothing." },
        {
          type: "step.done",
          stepNumber: 2,
          usage: { inputTokens: 200, outputTokens: 30, totalTokens: 230 },
          finishReason: "stop",
        },
        {
          type: "done",
          result: "complete",
          messages: [],
          totalUsage: { inputTokens: 300, outputTokens: 50, totalTokens: 350 },
        },
        {
          type: "turn.done",
          turnNumber: 1,
          usage: { inputTokens: 300, outputTokens: 50, totalTokens: 350 },
        },
      ];

      const chunks = await collectChunks(events);
      const types = chunks.map((c) => c.type);

      // Stream structure
      expect(types[0]).toBe("start");
      expect(types[types.length - 1]).toBe("data-oh:turn.done");
      expect(types).toContain("text-start");
      expect(types).toContain("text-delta");
      expect(types).toContain("text-end");
      expect(types).toContain("tool-input-start");
      expect(types).toContain("tool-input-available");
      expect(types).toContain("tool-output-available");
      expect(types).toContain("start-step");
      expect(types).toContain("finish-step");
      expect(types).toContain("finish");
      expect(types).toContain("data-oh:turn.start");
    });
  });
});
