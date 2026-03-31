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
import {
  connectMCPServers,
  closeMCPClients,
  type MCPServerConfig,
  type MCPConnection,
} from "./mcp.js";
import { discoverSkills, type SkillInfo, type SkillsConfig } from "./skills.js";
import { createSkillTool } from "./tools/skill.js";
import {
  AgentRegistry,
  normalizeBackgroundConfig,
  type SubagentBackground,
  type AwaitMode,
} from "./agent-registry.js";

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

/**
 * Called for every event emitted by a subagent during a task tool call.
 *
 * `path` is the ancestry chain from outermost to innermost agent, e.g.
 * `["explore"]` for a direct subagent, or `["explore", "search"]` when
 * a subagent spawns its own subagent.
 */
export type SubagentEventFn = (path: string[], event: AgentEvent) => void;

// ── Agent ────────────────────────────────────────────────────────────

export class Agent {
  readonly name: string;
  readonly description?: string;
  readonly model: LanguageModel;
  readonly systemPrompt?: string;
  readonly maxSteps: number;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly instructions: boolean;
  readonly maxSubagentDepth: number;
  readonly approve?: ApproveFn;
  readonly onSubagentEvent?: SubagentEventFn;

  /** Original subagent templates (stored so nested children can inherit them). */
  readonly subagents?: Agent[];

  /** Background config (stored so nested children can inherit it). */
  readonly subagentBackground?: SubagentBackground;

  /** Registry for background subagents. Only present when `subagentBackground` is configured. */
  private agentRegistry?: AgentRegistry;

  /** Static tools provided at construction time. */
  readonly tools?: ToolSet;

  /** MCP server configs — connected lazily on first run. */
  private mcpServerConfigs?: Record<string, MCPServerConfig>;
  private mcpConnection: MCPConnection | null = null;

  /** Skills config — discovered lazily on first run. */
  private skillsConfig?: SkillsConfig;
  private cachedSkills: SkillInfo[] | null = null; // null = not loaded yet

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
    /**
     * Maximum nesting depth for subagents. Defaults to `1` (direct subagents
     * only, no nesting). Set to `2` to allow sub-subagents, etc.
     * `0` effectively disables subagents even if `subagents` is provided.
     */
    maxSubagentDepth?: number;
    /** Called for every event emitted by a subagent during a task tool call. */
    onSubagentEvent?: SubagentEventFn;
    /**
     * Enable background execution for subagents. When enabled, the `task` tool
     * gains a `background` parameter and lifecycle tools (`agent_status`,
     * `agent_cancel`, `agent_await`) are auto-registered.
     *
     * Pass `true` for defaults, or an object for fine-grained control.
     */
    subagentBackground?: SubagentBackground;
    /**
     * MCP servers to connect to. Tools from these servers are merged into
     * the agent's toolset. Connections are established lazily on first run.
     *
     * Keys are server names (used to namespace tools when multiple servers are configured).
     */
    mcpServers?: Record<string, MCPServerConfig>;
    /**
     * Skills configuration. Skills are markdown instruction packages (SKILL.md files)
     * that the LLM can load on demand via an auto-generated `skill` tool.
     * Discovered lazily on first run.
     */
    skills?: SkillsConfig;
  }) {
    this.name = options.name;
    this.description = options.description;
    this.model = options.model;
    this.systemPrompt = options.systemPrompt;
    this.maxSteps = options.maxSteps ?? 100;
    this.temperature = options.temperature;
    this.maxTokens = options.maxTokens;
    this.instructions = options.instructions ?? true;
    this.maxSubagentDepth = options.maxSubagentDepth ?? 1;
    this.approve = options.approve;
    this.onSubagentEvent = options.onSubagentEvent;
    this.subagents = options.subagents;
    this.subagentBackground = options.subagentBackground;
    this.mcpServerConfigs = options.mcpServers;
    this.skillsConfig = options.skills;

    // Merge the task tool into the toolset when subagents are provided and depth > 0
    if (options.subagents?.length && this.maxSubagentDepth > 0) {
      const bgConfig = options.subagentBackground
        ? normalizeBackgroundConfig(options.subagentBackground)
        : undefined;
      const registry = bgConfig ? new AgentRegistry(bgConfig) : undefined;
      this.agentRegistry = registry;

      this.tools = {
        ...(options.tools ?? {}),
        task: createTaskTool(
          options.subagents,
          this.maxSubagentDepth,
          this.onSubagentEvent,
          registry,
        ),
        ...(registry && bgConfig!.tools.status
          ? { agent_status: createStatusTool(registry) }
          : {}),
        ...(registry && bgConfig!.tools.cancel
          ? { agent_cancel: createCancelTool(registry) }
          : {}),
        ...(registry && bgConfig!.tools.await
          ? { agent_await: createAwaitTool(registry, bgConfig!.tools.await as AwaitMode[]) }
          : {}),
      };
    } else {
      this.tools = options.tools;
    }
  }

  /**
   * Close all MCP server connections. Call this when the agent is no longer needed.
   */
  async close(): Promise<void> {
    if (this.agentRegistry) {
      this.agentRegistry.cancelAll();
    }
    if (this.mcpConnection) {
      await closeMCPClients(this.mcpConnection.clients);
      this.mcpConnection = null;
    }
  }

  async *run(
    history: ModelMessage[],
    input: string | ModelMessage[],
    options?: { signal?: AbortSignal },
  ): AsyncGenerator<AgentEvent> {
    // Build messages: history + new input (Agent does NOT mutate history)
    const messages: ModelMessage[] = [...history];
    if (typeof input === "string") {
      messages.push({ role: "user", content: input });
    } else {
      messages.push(...input);
    }

    // Load AGENTS.md once per agent lifetime
    if (this.instructions && this.cachedInstructions === null) {
      this.cachedInstructions = await loadInstructions();
    }

    // Connect MCP servers once per agent lifetime
    if (this.mcpServerConfigs && !this.mcpConnection) {
      this.mcpConnection = await connectMCPServers(this.mcpServerConfigs);
    }

    // Discover skills once per agent lifetime
    if (this.skillsConfig && this.cachedSkills === null) {
      this.cachedSkills = await discoverSkills(this.skillsConfig);
    }

    const systemParts = [this.systemPrompt, this.cachedInstructions].filter(Boolean);
    const system = systemParts.length > 0 ? systemParts.join("\n\n") : undefined;

    // Merge static tools with MCP tools and skill tool
    const allTools: ToolSet = {
      ...(this.cachedSkills?.length ? { skill: createSkillTool(this.cachedSkills) } : {}),
      ...(this.mcpConnection?.tools ?? {}),
      ...(this.tools ?? {}),
    };

    const tools =
      this.approve && Object.keys(allTools).length > 0
        ? wrapToolsWithApproval(allTools, this.approve)
        : Object.keys(allTools).length > 0
          ? allTools
          : undefined;

    const stream = streamText({
      model: this.model,
      system,
      messages,
      tools,
      stopWhen: stepCountIs(this.maxSteps),
      temperature: this.temperature,
      maxOutputTokens: this.maxTokens,
      abortSignal: options?.signal,
    });

    let stepNumber = 0;
    let stepText = "";
    let stepReasoning = "";
    const completedStepMessages: ModelMessage[] = [];
    let doneEmitted = false;
    let abortReason: string | undefined;

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
            completedStepMessages.push(
              ...buildAbortedStepMessages(stepText, stepReasoning),
            );
            stepText = "";
            stepReasoning = "";
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
            messages.push(...response.messages);
            doneEmitted = true;

            yield {
              type: "done",
              result,
              messages,
              totalUsage: toTokenUsage(part.totalUsage),
            };
            break;
          }

          case "abort":
            abortReason = part.reason ?? "aborted";
            break;
        }
      }

      if (!doneEmitted && abortReason !== undefined) {
        yield {
          type: "error",
          error: new Error(abortReason),
        };
        yield {
          type: "done",
          result: "stopped",
          messages: [
            ...messages,
            ...completedStepMessages,
            ...buildAbortedStepMessages(stepText, stepReasoning),
          ],
          totalUsage: {
            inputTokens: undefined,
            outputTokens: undefined,
            totalTokens: undefined,
          },
        };
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
}

// ── Subagent tools ──────────────────────────────────────────────────

function createChildFromTemplate(
  template: Agent,
  remainingDepth: number,
  onSubagentEvent?: SubagentEventFn,
): Agent {
  const nextDepth = remainingDepth - 1;
  const childOnSubagentEvent: SubagentEventFn | undefined = onSubagentEvent
    ? (childPath, event) => onSubagentEvent([template.name, ...childPath], event)
    : undefined;

  return new Agent({
    name: template.name,
    description: template.description,
    model: template.model,
    systemPrompt: template.systemPrompt,
    tools: template.tools,
    maxSteps: template.maxSteps,
    temperature: template.temperature,
    maxTokens: template.maxTokens,
    instructions: template.instructions,
    // No approve — subagents run autonomously
    // Pass subagents + background config through when there is remaining depth
    ...(nextDepth > 0 && template.subagents?.length
      ? {
          subagents: template.subagents,
          maxSubagentDepth: nextDepth,
          onSubagentEvent: childOnSubagentEvent,
          subagentBackground: template.subagentBackground,
        }
      : {}),
  });
}

function createTaskTool(
  subagents: Agent[],
  remainingDepth: number,
  onSubagentEvent?: SubagentEventFn,
  registry?: AgentRegistry,
) {
  const names = subagents.map((a) => a.name);
  const byName = new Map(subagents.map((a) => [a.name, a]));

  const listing = subagents.map((a) => `- ${a.name}: ${a.description ?? a.name}`).join("\n");

  const descriptionLines = [
    "Spawn a subagent to handle a task autonomously.",
    "The subagent runs with its own tools, completes the work, and returns the result.",
    "Launch multiple agents concurrently when possible by calling this tool multiple times in one response.",
  ];

  if (registry) {
    descriptionLines.push(
      "",
      "Set background=true to spawn the agent in the background and return immediately with an agent ID.",
      "Use agent_status, agent_await, or agent_cancel to manage background agents.",
    );
  }

  descriptionLines.push("", "Available agents:", listing);

  const baseSchema = z.object({
    agent: z.enum(names as [string, ...string[]]).describe("Which agent to use"),
    prompt: z.string().describe("Detailed task description for the subagent"),
  });

  const bgSchema = baseSchema.extend({
    background: z
      .boolean()
      .optional()
      .describe("If true, spawn in background and return immediately with an agent ID"),
  });

  const inputSchema = registry ? bgSchema : baseSchema;

  return tool({
    description: descriptionLines.join("\n"),
    inputSchema,
    execute: async (
      rawInput: z.infer<typeof bgSchema>,
      { abortSignal }: { abortSignal?: AbortSignal },
    ) => {
      const { agent: agentName, prompt, background } = rawInput;
      const template = byName.get(agentName)!;
      const child = createChildFromTemplate(template, remainingDepth, onSubagentEvent);

      // Background mode: spawn and return immediately
      if (background && registry) {
        const id = registry.spawn(agentName, child, prompt, {
          signal: abortSignal,
          onEvent: onSubagentEvent,
        });
        return `<background_spawn agent_id="${id}">\nAgent "${agentName}" spawned in background with id "${id}".\nUse agent_status, agent_await, or agent_cancel to manage it.\n</background_spawn>`;
      }

      // Foreground mode: run to completion
      let lastText = "";
      for await (const event of child.run([], prompt, { signal: abortSignal })) {
        onSubagentEvent?.([agentName], event);
        if (event.type === "text.done") {
          lastText = event.text;
        }
      }
      await child.close();

      return `<task_result>\n${lastText || "(no output)"}\n</task_result>`;
    },
  });
}

function createStatusTool(registry: AgentRegistry) {
  return tool({
    description: "Check the status of a background agent without blocking.",
    inputSchema: z.object({
      id: z.string().describe("The agent ID returned by a background task spawn"),
    }),
    execute: async ({ id }: { id: string }) => {
      const status = registry.getStatus(id);
      if (!status) return `Agent "${id}" not found.`;
      if (status.status === "done") {
        return `<agent_status id="${id}" status="done">\n${status.result}\n</agent_status>`;
      }
      if (status.status === "failed") {
        return `<agent_status id="${id}" status="failed" error="${status.error ?? "unknown"}" />`;
      }
      if (status.status === "cancelled") {
        return `<agent_status id="${id}" status="cancelled" />`;
      }
      return `<agent_status id="${id}" status="running" />`;
    },
  });
}

function createCancelTool(registry: AgentRegistry) {
  return tool({
    description: "Cancel a running background agent.",
    inputSchema: z.object({
      id: z.string().describe("The agent ID to cancel"),
    }),
    execute: async ({ id }: { id: string }) => {
      const cancelled = registry.cancel(id);
      return cancelled
        ? `Agent "${id}" cancelled.`
        : `Agent "${id}" is not running (may have already completed or been cancelled).`;
    },
  });
}

function createAwaitTool(registry: AgentRegistry, modes: AwaitMode[]) {
  const modeDescriptions: Record<AwaitMode, string> = {
    all: '"all": Wait for all agents to succeed. Fails fast if any agent fails.',
    allSettled:
      '"allSettled": Wait for all agents to finish. Returns both results and errors.',
    any: '"any": Wait for the first agent to succeed. Only fails if all agents fail.',
    race: '"race": Wait for the first agent to settle (succeed or fail).',
  };

  return tool({
    description: [
      "Wait for one or more background agents to complete.",
      "",
      "Modes:",
      ...modes.map((m) => `- ${modeDescriptions[m]}`),
    ].join("\n"),
    inputSchema: z.object({
      ids: z.array(z.string()).min(1).describe("Agent IDs to wait for"),
      mode: z.enum(modes as [AwaitMode, ...AwaitMode[]]).describe("How to wait for agents"),
    }),
    execute: async ({ ids, mode }: { ids: string[]; mode: AwaitMode }) => {
      switch (mode) {
        case "all": {
          try {
            const results = await registry.awaitAll(ids);
            const entries = [...results.entries()].map(
              ([id, result]) => `<agent id="${id}">\n${result}\n</agent>`,
            );
            return `<await_result mode="all">\n${entries.join("\n")}\n</await_result>`;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return `<await_result mode="all" error="${msg}" />`;
          }
        }

        case "allSettled": {
          const results = await registry.awaitAllSettled(ids);
          const entries = [...results.entries()].map(([id, r]) => {
            if (r.status === "done") {
              return `<agent id="${id}" status="done">\n${r.result}\n</agent>`;
            }
            return `<agent id="${id}" status="${r.status}" error="${r.error ?? "unknown"}" />`;
          });
          return `<await_result mode="allSettled">\n${entries.join("\n")}\n</await_result>`;
        }

        case "any": {
          try {
            const { id, result } = await registry.awaitAny(ids);
            return `<await_result mode="any" winner="${id}">\n${result}\n</await_result>`;
          } catch {
            return `<await_result mode="any" error="All agents failed." />`;
          }
        }

        case "race": {
          const settled = await registry.awaitRace(ids);
          if (settled.error) {
            return `<await_result mode="race" settled="${settled.id}" status="failed" error="${settled.error}" />`;
          }
          return `<await_result mode="race" settled="${settled.id}">\n${settled.result}\n</await_result>`;
        }
      }
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

function buildAbortedStepMessages(
  text: string,
  reasoning: string,
): ModelMessage[] {
  const parts: Array<
    | { type: "reasoning"; text: string }
    | { type: "text"; text: string }
  > = [];

  if (reasoning) {
    parts.push({ type: "reasoning", text: reasoning });
  }

  if (text) {
    parts.push({ type: "text", text });
  }

  if (parts.length === 0) return [];

  return [
    {
      role: "assistant",
      content: parts.length === 1 && parts[0].type === "text" ? text : parts,
    },
  ];
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
