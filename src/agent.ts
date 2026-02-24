import {
  streamText,
  stepCountIs,
  type LanguageModel,
  type ToolSet,
  type ModelMessage,
  type LanguageModelUsage,
} from "ai";
import { loadInstructions } from "./instructions.js";

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

// ── Agent ────────────────────────────────────────────────────────────

export class Agent {
  readonly name: string;
  readonly model: LanguageModel;
  readonly systemPrompt?: string;
  readonly tools?: ToolSet;
  readonly maxSteps: number;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly instructions: boolean;

  private messages: ModelMessage[] = [];
  private cachedInstructions: string | undefined | null = null; // null = not loaded yet

  constructor(options: {
    name: string;
    model: LanguageModel;
    systemPrompt?: string;
    tools?: ToolSet;
    maxSteps?: number;
    temperature?: number;
    maxTokens?: number;
    /** Load AGENTS.md / CLAUDE.md from the project directory. Defaults to true. */
    instructions?: boolean;
  }) {
    this.name = options.name;
    this.model = options.model;
    this.systemPrompt = options.systemPrompt;
    this.tools = options.tools;
    this.maxSteps = options.maxSteps ?? 100;
    this.temperature = options.temperature;
    this.maxTokens = options.maxTokens;
    this.instructions = options.instructions ?? true;
  }

  async *run(
    input: string | ModelMessage[],
    options?: { signal?: AbortSignal },
  ): AsyncGenerator<AgentEvent> {
    if (typeof input === "string") {
      this.messages.push({ role: "user", content: input });
    } else {
      this.messages.push(...input);
    }

    // Load AGENTS.md once per agent lifetime
    if (this.instructions && this.cachedInstructions === null) {
      this.cachedInstructions = await loadInstructions();
    }

    const systemParts = [this.systemPrompt, this.cachedInstructions].filter(Boolean);
    const system = systemParts.length > 0 ? systemParts.join("\n\n") : undefined;

    const stream = streamText({
      model: this.model,
      system,
      messages: this.messages,
      tools: this.tools,
      stopWhen: stepCountIs(this.maxSteps),
      temperature: this.temperature,
      maxOutputTokens: this.maxTokens,
      abortSignal: options?.signal,
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
            this.messages.push(...response.messages);

            yield {
              type: "done",
              result,
              messages: this.messages,
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
        messages: this.messages,
        totalUsage: { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
      };
    }
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
