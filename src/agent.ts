import {
  streamText,
  stepCountIs,
  type LanguageModel,
  type ToolSet,
  type ModelMessage,
  type LanguageModelUsage,
} from "ai";

// ── Token usage ──────────────────────────────────────────────────────

export interface TokenUsage {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
}

// ── Events emitted by the agent loop ─────────────────────────────────

export type AgentEvent =
  | { type: "text.delta"; text: string }
  | { type: "text.done"; text: string }
  | { type: "reasoning.delta"; text: string }
  | { type: "reasoning.done"; text: string }
  | { type: "tool.start"; toolCallId: string; toolName: string; input: unknown }
  | { type: "tool.done"; toolCallId: string; toolName: string; output: unknown }
  | { type: "tool.error"; toolCallId: string; toolName: string; error: string }
  | { type: "step.start"; stepNumber: number }
  | { type: "step.done"; stepNumber: number; usage: TokenUsage; finishReason: string }
  | { type: "error"; error: Error }
  | {
      type: "done";
      result: "complete" | "stopped" | "max_steps" | "error";
      messages: ModelMessage[];
      totalUsage: TokenUsage;
    };

// ── Agent config (just data, not a class) ────────────────────────────

export interface AgentConfig {
  name: string;
  systemPrompt?: string;
  model: LanguageModel;
  tools?: ToolSet;
  maxSteps?: number;
  temperature?: number;
  maxTokens?: number;
}

// ── The core agent loop ──────────────────────────────────────────────

export async function* run(options: {
  agent: AgentConfig;
  messages: ModelMessage[];
  signal?: AbortSignal;
}): AsyncGenerator<AgentEvent> {
  const { agent, messages, signal } = options;

  const stream = streamText({
    model: agent.model,
    system: agent.systemPrompt,
    messages,
    tools: agent.tools,
    stopWhen: stepCountIs(agent.maxSteps ?? 100),
    temperature: agent.temperature,
    maxOutputTokens: agent.maxTokens,
    abortSignal: signal,
  });

  let stepNumber = 0;
  let stepText = "";
  let stepReasoning = "";

  try {
    for await (const part of stream.fullStream) {
      switch (part.type) {
        case "start-step":
          stepNumber++;
          stepText = "";
          stepReasoning = "";
          yield { type: "step.start", stepNumber };
          break;

        case "text-delta":
          stepText += part.text;
          yield { type: "text.delta", text: part.text };
          break;

        case "text-end":
          if (stepText) {
            yield { type: "text.done", text: stepText };
          }
          break;

        case "reasoning-delta":
          stepReasoning += part.text;
          yield { type: "reasoning.delta", text: part.text };
          break;

        case "reasoning-end":
          if (stepReasoning) {
            yield { type: "reasoning.done", text: stepReasoning };
          }
          break;

        case "tool-call":
          yield {
            type: "tool.start",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.input,
          };
          break;

        case "tool-result":
          yield {
            type: "tool.done",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            output: part.output,
          };
          break;

        case "tool-error":
          yield {
            type: "tool.error",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            error: String(part.error),
          };
          break;

        case "finish-step":
          yield {
            type: "step.done",
            stepNumber,
            usage: toTokenUsage(part.usage),
            finishReason: part.finishReason,
          };
          break;

        case "error":
          yield {
            type: "error",
            error: part.error instanceof Error ? part.error : new Error(String(part.error)),
          };
          break;

        case "finish": {
          const result =
            part.finishReason === "stop"
              ? "complete"
              : part.finishReason === "tool-calls"
                ? "max_steps"
                : part.finishReason === "error"
                  ? "error"
                  : "stopped";

          const response = await stream.response;

          yield {
            type: "done",
            result,
            messages: [...messages, ...response.messages],
            totalUsage: toTokenUsage(part.totalUsage),
          };
          break;
        }
      }
    }
  } catch (error) {
    yield {
      type: "error",
      error: error instanceof Error ? error : new Error(String(error)),
    };
    yield {
      type: "done",
      result: "error",
      messages,
      totalUsage: { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function toTokenUsage(usage: LanguageModelUsage): TokenUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}
