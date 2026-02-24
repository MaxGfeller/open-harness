import {
  tool,
  streamText,
  stepCountIs,
  type LanguageModel,
  type ToolSet,
  type ModelMessage,
  type LanguageModelUsage,
} from "ai";
import { z } from "zod";
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

// ── Approval callback ────────────────────────────────────────────────

export interface ToolCallInfo {
  toolName: string;
  toolCallId: string;
  input: unknown;
}

/**
 * Called before each tool execution. Return `true` to allow, `false` to deny.
 * Can be async — e.g. to prompt a user in a custom UI.
 */
export type ApproveFn = (toolCall: ToolCallInfo) => boolean | Promise<boolean>;

/** Called for every event emitted by a subagent during a task tool call. */
export type SubagentEventFn = (agentName: string, event: AgentEvent) => void;

// ── Agent ────────────────────────────────────────────────────────────

export class Agent {
  readonly name: string;
  readonly description?: string;
  readonly model: LanguageModel;
  readonly systemPrompt?: string;
  readonly tools?: ToolSet;
  readonly maxSteps: number;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly instructions: boolean;
  readonly approve?: ApproveFn;
  readonly onSubagentEvent?: SubagentEventFn;

  private messages: ModelMessage[] = [];
  private cachedInstructions: string | undefined | null = null; // null = not loaded yet

  constructor(options: {
    name: string;
    /** Short description of this agent's purpose. Used in the task tool for subagent selection. */
    description?: string;
    model: LanguageModel;
    systemPrompt?: string;
    tools?: ToolSet;
    maxSteps?: number;
    temperature?: number;
    maxTokens?: number;
    /** Load AGENTS.md / CLAUDE.md from the project directory. Defaults to true. */
    instructions?: boolean;
    /**
     * Called before each tool execution. Return `true` to allow, `false` to deny.
     * When omitted, all tool calls are allowed.
     */
    approve?: ApproveFn;
    /** Agents available as subagents via the auto-generated `task` tool. */
    subagents?: Agent[];
    /** Called for every event emitted by a subagent during a task tool call. */
    onSubagentEvent?: SubagentEventFn;
  }) {
    this.name = options.name;
    this.description = options.description;
    this.model = options.model;
    this.systemPrompt = options.systemPrompt;
    this.maxSteps = options.maxSteps ?? 100;
    this.temperature = options.temperature;
    this.maxTokens = options.maxTokens;
    this.instructions = options.instructions ?? true;
    this.approve = options.approve;
    this.onSubagentEvent = options.onSubagentEvent;

    // Merge the task tool into the toolset when subagents are provided
    if (options.subagents?.length) {
      this.tools = {
        ...(options.tools ?? {}),
        task: createTaskTool(options.subagents, this.onSubagentEvent),
      };
    } else {
      this.tools = options.tools;
    }
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

    const tools =
      this.approve && this.tools ? wrapToolsWithApproval(this.tools, this.approve) : this.tools;

    const stream = streamText({
      model: this.model,
      system,
      messages: this.messages,
      tools,
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

// ── Subagent task tool ───────────────────────────────────────────────

function createTaskTool(subagents: Agent[], onSubagentEvent?: SubagentEventFn) {
  const names = subagents.map((a) => a.name);
  const byName = new Map(subagents.map((a) => [a.name, a]));

  const listing = subagents.map((a) => `- ${a.name}: ${a.description ?? a.name}`).join("\n");

  return tool({
    description: [
      "Spawn a subagent to handle a task autonomously.",
      "The subagent runs with its own tools, completes the work, and returns the result.",
      "Launch multiple agents concurrently when possible by calling this tool multiple times in one response.",
      "",
      "Available agents:",
      listing,
    ].join("\n"),
    inputSchema: z.object({
      agent: z.enum(names as [string, ...string[]]).describe("Which agent to use"),
      prompt: z.string().describe("Detailed task description for the subagent"),
    }),
    execute: async (
      { agent: agentName, prompt }: { agent: string; prompt: string },
      { abortSignal }: { abortSignal?: AbortSignal },
    ) => {
      const template = byName.get(agentName)!;

      // Fresh agent instance for each task — no shared state
      const child = new Agent({
        name: template.name,
        model: template.model,
        systemPrompt: template.systemPrompt,
        tools: template.tools,
        maxSteps: template.maxSteps,
        temperature: template.temperature,
        maxTokens: template.maxTokens,
        instructions: template.instructions,
        // No approve — subagents run autonomously
        // No subagents — prevent recursive nesting
      });

      let lastText = "";
      for await (const event of child.run(prompt, { signal: abortSignal })) {
        onSubagentEvent?.(agentName, event);
        if (event.type === "text.done") {
          lastText = event.text;
        }
      }

      return `<task_result>\n${lastText || "(no output)"}\n</task_result>`;
    },
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

function toTokenUsage(usage: LanguageModelUsage): TokenUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}

function wrapToolsWithApproval(tools: ToolSet, approve: ApproveFn): ToolSet {
  const wrapped: ToolSet = {};
  for (const [name, t] of Object.entries(tools)) {
    if (!t.execute) {
      wrapped[name] = t;
      continue;
    }
    const originalExecute = t.execute;
    wrapped[name] = {
      ...t,
      execute: async (input: any, options: any) => {
        const allowed = await approve({
          toolName: name,
          toolCallId: options.toolCallId,
          input,
        });
        if (!allowed) {
          throw new ToolDeniedError(name);
        }
        return originalExecute(input, options);
      },
    };
  }
  return wrapped;
}

export class ToolDeniedError extends Error {
  constructor(toolName: string) {
    super(`Tool call to "${toolName}" was denied.`);
    this.name = "ToolDeniedError";
  }
}
