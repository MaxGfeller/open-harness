import { beforeEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { tool as consumerTool } from "ai-consumer";
import { z } from "zod";

const { stepCountIsMock, streamTextMock } = vi.hoisted(() => ({
  stepCountIsMock: vi.fn(),
  streamTextMock: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: streamTextMock,
    stepCountIs: stepCountIsMock,
  };
});

import { Agent } from "../index.js";

function createModel() {
  return {
    specificationVersion: "v2",
    provider: "mock",
    modelId: "mock-model",
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  } as any;
}

async function collect(agent: Agent) {
  const events = [];
  for await (const event of agent.run([], "Run the tool loop")) {
    events.push(event);
  }
  return events;
}

function createToolLoopStream(record: { activeToolsByStep: unknown[] }) {
  return (config: any) => {
    const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

    return {
      fullStream: (async function* () {
        const steps: unknown[] = [];
        const stopConditions = Array.isArray(config.stopWhen) ? config.stopWhen : [config.stopWhen];

        for (let stepNumber = 0; stepNumber < 20; stepNumber++) {
          const prepared = await config.prepareStep?.({ stepNumber, steps });
          record.activeToolsByStep.push(prepared?.activeTools ?? config.activeTools);

          yield { type: "start-step" } as const;
          yield {
            type: "tool-call",
            toolCallId: `tool-${stepNumber}`,
            toolName: "lookup",
            input: {},
          } as const;
          yield {
            type: "tool-result",
            toolCallId: `tool-${stepNumber}`,
            toolName: "lookup",
            output: "result",
          } as const;
          steps.push({});
          yield { type: "finish-step", usage, finishReason: "tool-calls" } as const;

          if (
            await Promise.all(stopConditions.map((condition: any) => condition({ steps }))).then(
              (results) => results.some(Boolean),
            )
          ) {
            yield { type: "finish", finishReason: "tool-calls", totalUsage: usage } as const;
            return;
          }
        }

        throw new Error("The agent did not receive a stop condition.");
      })(),
      response: Promise.resolve({ messages: [] }),
    };
  };
}

const staticTools = {
  lookup: tool({
    inputSchema: z.object({}),
    execute: async () => "result",
  }),
  submitResult: tool({
    inputSchema: z.object({}),
    execute: async () => "submitted",
  }),
};

const consumerTools = {
  lookup: consumerTool({
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => query,
  }),
  submitResult: consumerTool({
    inputSchema: z.object({ result: z.string() }),
    execute: async ({ result }) => result,
  }),
};

describe("Agent tool-loop options", () => {
  beforeEach(() => {
    streamTextMock.mockReset();
    stepCountIsMock.mockReset();
    stepCountIsMock.mockImplementation(
      (maxSteps: number) =>
        ({ steps }: { steps: unknown[] }) =>
          steps.length >= maxSteps,
    );
  });

  it("keeps the maximum-step guard when no tool-loop options are configured", async () => {
    const record = { activeToolsByStep: [] as unknown[] };
    streamTextMock.mockImplementation(createToolLoopStream(record));
    const agent = new Agent({
      name: "default-loop",
      model: createModel(),
      instructions: false,
      maxSteps: 2,
    });

    const events = await collect(agent);
    const config = streamTextMock.mock.calls[0][0];

    expect(stepCountIsMock).toHaveBeenCalledWith(2);
    expect(config.stopWhen).toHaveLength(1);
    expect(events.find((event) => event.type === "done")).toMatchObject({
      result: "max_steps",
    });
  });

  it("forwards toolChoice, activeTools, providerOptions, and prepareStep", async () => {
    const record = { activeToolsByStep: [] as unknown[] };
    streamTextMock.mockImplementation(createToolLoopStream(record));
    const prepareStep = vi.fn(({ stepNumber }: { stepNumber: number }) =>
      stepNumber === 1 ? { activeTools: ["submitResult"] as Array<"submitResult"> } : undefined,
    );
    const providerOptions = { someProvider: { someOption: true } };
    const agent = new Agent({
      name: "configured-loop",
      model: createModel(),
      instructions: false,
      tools: staticTools,
      toolChoice: "required",
      activeTools: ["lookup", "submitResult"],
      providerOptions,
      prepareStep,
      stopWhen: ({ steps }) => steps.length >= 2,
      maxSteps: 4,
    });

    await collect(agent);
    const config = streamTextMock.mock.calls[0][0];

    expect(config.toolChoice).toBe("required");
    expect(config.activeTools).toEqual(["lookup", "submitResult"]);
    expect(config.providerOptions).toBe(providerOptions);
    expect(config.prepareStep).toBe(prepareStep);
    expect(prepareStep).toHaveBeenCalledTimes(2);
    expect(record.activeToolsByStep[1]).toEqual(["submitResult"]);
  });

  it("stops on a custom condition before maxSteps without reporting max_steps", async () => {
    const record = { activeToolsByStep: [] as unknown[] };
    streamTextMock.mockImplementation(createToolLoopStream(record));
    const stopWhen = vi.fn(({ steps }: { steps: unknown[] }) => steps.length === 1);
    const agent = new Agent({
      name: "early-stop",
      model: createModel(),
      instructions: false,
      stopWhen,
      maxSteps: 3,
    });

    const events = await collect(agent);
    const config = streamTextMock.mock.calls[0][0];

    expect(config.stopWhen).toHaveLength(2);
    expect(stopWhen).toHaveBeenCalledTimes(1);
    expect(events.find((event) => event.type === "done")).toMatchObject({
      result: "stopped",
    });
  });

  it("still stops at maxSteps when a custom condition never succeeds", async () => {
    const record = { activeToolsByStep: [] as unknown[] };
    streamTextMock.mockImplementation(createToolLoopStream(record));
    const agent = new Agent({
      name: "safe-loop",
      model: createModel(),
      instructions: false,
      stopWhen: () => false,
      maxSteps: 2,
    });

    const events = await collect(agent);

    expect(events.find((event) => event.type === "done")).toMatchObject({
      result: "max_steps",
    });
  });

  it("infers static tool names for tool-loop configuration", () => {
    new Agent({
      name: "typed-loop",
      model: createModel(),
      instructions: false,
      tools: staticTools,
      toolChoice: { type: "tool", toolName: "lookup" },
      activeTools: ["lookup"],
      stopWhen: ({ steps }) => steps.length > 0,
      prepareStep: () => ({ activeTools: ["submitResult"] }),
    });

    new Agent({
      name: "invalid-typed-loop",
      model: createModel(),
      instructions: false,
      tools: staticTools,
      // @ts-expect-error Static tool names are checked.
      activeTools: ["missing"],
    });
  });

  it("accepts tools from another AI SDK installation", () => {
    new Agent({
      name: "consumer-tools",
      model: createModel(),
      instructions: false,
      tools: consumerTools,
      toolChoice: { type: "tool", toolName: "lookup" },
      activeTools: ["lookup"],
      prepareStep: () => ({
        activeTools: ["submitResult"],
        toolChoice: { type: "tool", toolName: "submitResult" },
      }),
    });

    new Agent({
      name: "invalid-consumer-tool-choice",
      model: createModel(),
      tools: consumerTools,
      // @ts-expect-error Static tool names are checked across package boundaries.
      toolChoice: { type: "tool", toolName: "missing" },
    });

    new Agent({
      name: "invalid-consumer-active-tools",
      model: createModel(),
      tools: consumerTools,
      // @ts-expect-error Static tool names are checked across package boundaries.
      activeTools: ["missing"],
    });

    new Agent({
      name: "invalid-consumer-prepare-step",
      model: createModel(),
      tools: consumerTools,
      // @ts-expect-error Static tool names are checked across package boundaries.
      prepareStep: () => ({ activeTools: ["missing"] }),
    });
  });
});
