import { describe, expect, it, vi } from "vitest";

const { streamTextMock } = vi.hoisted(() => ({
  streamTextMock: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: streamTextMock,
    stepCountIs: vi.fn(),
  };
});

import { Agent } from "../agent.js";
import { Session } from "../session.js";

function createAbortableStream(abortSignal?: AbortSignal) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start-step" } as const;
      yield { type: "text-delta", text: "partial answer" } as const;

      await new Promise<void>((resolve) => {
        if (abortSignal?.aborted) {
          resolve();
          return;
        }

        abortSignal?.addEventListener("abort", () => resolve(), { once: true });
      });

      yield { type: "abort", reason: "aborted" } as const;
    },
  };
}

describe("Session abort handling", () => {
  it("persists aborted turns when the model stream ends without finish", async () => {
    streamTextMock.mockImplementation(({ abortSignal }) => ({
      fullStream: createAbortableStream(abortSignal),
      response: Promise.resolve({ messages: [] }),
    }));

    const agent = new Agent({
      name: "test",
      model: {
        specificationVersion: "v2",
        provider: "mock",
        modelId: "mock-model",
        doGenerate: vi.fn(),
        doStream: vi.fn(),
      } as any,
      instructions: false,
    });
    const store = {
      load: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const session = new Session({
      agent,
      sessionId: "test-session",
      sessionStore: store,
    });
    const controller = new AbortController();
    const reader = session
      .toUIMessageStream("Write me an article about Sutro Apps.", {
        signal: controller.signal,
      })
      .getReader();
    const chunks: Array<{ type: string }> = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as { type: string });
      if (value.type === "text-delta") {
        controller.abort("stop");
      }
    }

    expect(chunks.find((chunk) => chunk.type === "abort")).toEqual({
      type: "abort",
      reason: "aborted",
    });
    expect(session.messages).toEqual([
      { role: "user", content: "Write me an article about Sutro Apps." },
      { role: "assistant", content: "partial answer" },
    ]);
    expect(store.save).toHaveBeenCalledWith("test-session", session.messages);
  });
});
