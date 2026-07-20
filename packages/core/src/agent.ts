import {
  tool,
  streamText,
  stepCountIs,
  type LanguageModel,
  type Tool,
  type ToolSet,
  type ModelMessage,
  type LanguageModelUsage,
} from "ai";
import { z } from "zod";
import { Session } from "./session.js";
import { loadInstructions } from "./instructions.js";
import {
  connectMCPServers,
  closeMCPClients,
  type MCPServerConfig,
  type MCPConnection,
} from "./mcp.js";
import {
  discoverSkills,
  type SkillInfo,
  type SkillsConfig,
} from "./skills.js";
import {
  InMemorySubagentSessionMetadataStore,
  isSubagentCatalog,
  type SubagentCatalog,
  type SubagentDescriptor,
  type SubagentSessionMetadata,
  type SubagentSessionMetadataStore,
  type SubagentSessionMode,
  type SubagentSessionsConfig,
  type SubagentSource,
} from "./subagents.js";
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
export type ApproveFn = (
  toolCall: ToolCallInfo,
) => boolean | Promise<boolean>;

/**
 * Called for every event emitted by a subagent during a task tool call.
 *
 * `path` is the ancestry chain from outermost to innermost agent, e.g.
 * `["explore"]` for a direct subagent, or `["explore", "search"]` when
 * a subagent spawns its own subagent.
 */
export type SubagentEventFn = (
  path: string[],
  event: AgentEvent,
) => void;

type TaskSessionInput = {
  mode: SubagentSessionMode;
  id?: string;
};

type NamedToolSet<TOOLS extends object> = {
  [NAME in Extract<keyof TOOLS, string>]: Tool<any, any>;
};

type AgentToolLoopOptions<TOOLS extends object> = Pick<
  Parameters<typeof streamText<NamedToolSet<TOOLS>>>[0],
  "toolChoice" | "stopWhen" | "prepareStep" | "activeTools" | "providerOptions"
>;

export type AgentOptions<TOOLS extends object = Record<string, never>> = {
  name: string;
  /** Short description of this agent's purpose. Used in the task tool for subagent selection. */
  description?: string;
  model: LanguageModel;
  systemPrompt?: string;
  tools?: TOOLS;
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
  /** Agents or a catalog available as subagents via the auto-generated `task` tool. */
  subagents?: SubagentSource;
  /** Optional stateful session layer for the auto-generated `task` tool. */
  subagentSessions?: SubagentSessionsConfig;
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
} & AgentToolLoopOptions<TOOLS>;

interface SubagentSessionRuntime {
  activeSessionIds: Set<string>;
  metadataStore: SubagentSessionMetadataStore;
}

const SUBAGENT_SESSION_RUNTIME = new WeakMap<
  SubagentSessionsConfig,
  SubagentSessionRuntime
>();

const TASK_SESSION_MODES = ["stateless", "new", "resume", "fork"] as const;

// ── Agent ────────────────────────────────────────────────────────────

export class Agent<TOOLS extends object = any> {
  readonly name: string;
  readonly description?: string;
  readonly model: LanguageModel;
  readonly systemPrompt?: string;
  readonly maxSteps: number;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly toolChoice?: AgentToolLoopOptions<TOOLS>["toolChoice"];
  readonly stopWhen?: AgentToolLoopOptions<TOOLS>["stopWhen"];
  readonly prepareStep?: AgentToolLoopOptions<TOOLS>["prepareStep"];
  readonly activeTools?: AgentToolLoopOptions<TOOLS>["activeTools"];
  readonly providerOptions?: AgentToolLoopOptions<TOOLS>["providerOptions"];
  readonly instructions: boolean;
  readonly maxSubagentDepth: number;
  readonly approve?: ApproveFn;
  readonly onSubagentEvent?: SubagentEventFn;

  /** Original subagent templates or catalog (stored for nested children). */
  readonly subagents?: SubagentSource;

  /** Optional resumable subagent session config. */
  readonly subagentSessions?: SubagentSessionsConfig;

  /** Background config (stored so nested children can inherit it). */
  readonly subagentBackground?: SubagentBackground;

  /** Registry for background subagents. Only present when configured. */
  private agentRegistry?: AgentRegistry;

  /** Static tools provided at construction time. */
  readonly tools?: TOOLS;

  /** MCP server configs — connected lazily on first run. */
  private mcpServerConfigs?: Record<string, MCPServerConfig>;
  private mcpConnection: MCPConnection | null = null;

  /** Skills config — discovered lazily on first run. */
  private skillsConfig?: SkillsConfig;
  private cachedSkills: SkillInfo[] | null = null;

  private cachedInstructions: string | undefined | null = null;

  constructor(options: AgentOptions<TOOLS>) {
    this.name = options.name;
    this.description = options.description;
    this.model = options.model;
    this.systemPrompt = options.systemPrompt;
    this.maxSteps = options.maxSteps ?? 100;
    this.temperature = options.temperature;
    this.maxTokens = options.maxTokens;
    this.toolChoice = options.toolChoice;
    this.stopWhen = options.stopWhen;
    this.prepareStep = options.prepareStep;
    this.activeTools = options.activeTools;
    this.providerOptions = options.providerOptions;
    this.instructions = options.instructions ?? true;
    this.maxSubagentDepth = options.maxSubagentDepth ?? 1;
    this.approve = options.approve;
    this.onSubagentEvent = options.onSubagentEvent;
    this.subagents = options.subagents;
    this.subagentSessions = options.subagentSessions;
    this.subagentBackground = options.subagentBackground;
    this.mcpServerConfigs = options.mcpServers;
    this.skillsConfig = options.skills;
    this.tools = options.tools;

    if (options.subagentSessions) {
      getSubagentSessionRuntime(options.subagentSessions);
    }

    if (options.subagents && this.maxSubagentDepth > 0 && options.subagentBackground) {
      const bgConfig = normalizeBackgroundConfig(options.subagentBackground);
      if (bgConfig) {
        this.agentRegistry = new AgentRegistry(bgConfig);
      }
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
    const messages: ModelMessage[] = [...history];
    if (typeof input === "string") {
      messages.push({ role: "user", content: input });
    } else {
      messages.push(...input);
    }

    if (this.instructions && this.cachedInstructions === null) {
      this.cachedInstructions = await loadInstructions();
    }

    if (this.mcpServerConfigs && !this.mcpConnection) {
      this.mcpConnection = await connectMCPServers(this.mcpServerConfigs);
    }

    if (this.skillsConfig && this.cachedSkills === null) {
      this.cachedSkills = await discoverSkills(this.skillsConfig);
    }

    const systemParts = [this.systemPrompt, this.cachedInstructions].filter(Boolean);
    const system = systemParts.length > 0 ? systemParts.join("\n\n") : undefined;

    const subagentTools = await createSubagentTools(
      this.subagents,
      this.maxSubagentDepth,
      this.onSubagentEvent,
      this.agentRegistry,
      this.subagentBackground,
      this.subagentSessions,
    );

    // Consumer tools can come from another AI SDK installation whose schema
    // types are nominally incompatible, despite having the same runtime shape.
    const staticTools = this.tools as unknown as ToolSet | undefined;
    const allTools: ToolSet = {
      ...(this.cachedSkills?.length
        ? { skill: createSkillTool(this.cachedSkills) }
        : {}),
      ...(this.mcpConnection?.tools ?? {}),
      ...(staticTools ?? {}),
      ...(subagentTools ?? {}),
    };

    const tools =
      this.approve && Object.keys(allTools).length > 0
        ? wrapToolsWithApproval(allTools, this.approve)
        : Object.keys(allTools).length > 0
          ? allTools
          : undefined;

    const configuredStopConditions = this.stopWhen
      ? Array.isArray(this.stopWhen)
        ? this.stopWhen
        : [this.stopWhen]
      : [];
    const stopWhen = [
      ...configuredStopConditions,
      stepCountIs(this.maxSteps),
    ] as AgentToolLoopOptions<ToolSet>["stopWhen"];

    const stream = streamText({
      model: this.model,
      system,
      messages,
      tools,
      toolChoice: this.toolChoice as AgentToolLoopOptions<ToolSet>["toolChoice"],
      stopWhen,
      prepareStep: this.prepareStep as AgentToolLoopOptions<ToolSet>["prepareStep"],
      activeTools: this.activeTools as AgentToolLoopOptions<ToolSet>["activeTools"],
      providerOptions: this.providerOptions,
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
              error:
                part.error instanceof Error
                  ? part.error
                  : new Error(String(part.error)),
            };
            break;

          case "finish": {
            const result =
              part.finishReason === "stop"
                ? "complete"
                : part.finishReason === "tool-calls"
                  ? stepNumber >= this.maxSteps
                    ? "max_steps"
                    : "stopped"
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
        totalUsage: {
          inputTokens: undefined,
          outputTokens: undefined,
          totalTokens: undefined,
        },
      };
    }
  }
}

// ── Subagent tools ──────────────────────────────────────────────────

async function createSubagentTools(
  subagents: SubagentSource | undefined,
  remainingDepth: number,
  onSubagentEvent?: SubagentEventFn,
  registry?: AgentRegistry,
  backgroundConfig?: SubagentBackground,
  sessionConfig?: SubagentSessionsConfig,
): Promise<ToolSet | undefined> {
  if (!subagents || remainingDepth <= 0) return undefined;
  if (Array.isArray(subagents) && subagents.length === 0) return undefined;

  const bgConfig =
    registry && backgroundConfig
      ? normalizeBackgroundConfig(backgroundConfig)
      : undefined;
  const task = await createTaskTool(
    subagents,
    remainingDepth,
    onSubagentEvent,
    registry,
    sessionConfig,
  );

  return {
    task,
    ...(registry && bgConfig?.tools.status
      ? { agent_status: createStatusTool(registry) }
      : {}),
    ...(registry && bgConfig?.tools.cancel
      ? { agent_cancel: createCancelTool(registry) }
      : {}),
    ...(registry && bgConfig?.tools.await
      ? {
          agent_await: createAwaitTool(
            registry,
            bgConfig.tools.await as AwaitMode[],
          ),
        }
      : {}),
  };
}

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
    toolChoice: template.toolChoice,
    stopWhen: template.stopWhen,
    prepareStep: template.prepareStep,
    activeTools: template.activeTools,
    providerOptions: template.providerOptions,
    instructions: template.instructions,
    ...(nextDepth > 0 && template.subagents
      ? {
          subagents: template.subagents,
          subagentSessions: template.subagentSessions,
          maxSubagentDepth: nextDepth,
          onSubagentEvent: childOnSubagentEvent,
          subagentBackground: template.subagentBackground,
        }
      : {}),
  });
}

async function createTaskTool(
  subagents: SubagentSource,
  remainingDepth: number,
  onSubagentEvent?: SubagentEventFn,
  registry?: AgentRegistry,
  sessionConfig?: SubagentSessionsConfig,
) {
  const descriptors = await listSubagentDescriptors(subagents);
  const names = descriptors.map((subagent) => subagent.name);
  const listing = descriptors
    .map((subagent) => `- ${subagent.name}: ${subagent.description ?? subagent.name}`)
    .join("\n");

  const descriptionLines = [
    "Spawn a subagent to handle a task autonomously.",
    "The subagent runs with its own tools, completes the work, and returns the result.",
    "Launch multiple agents concurrently when possible by calling this tool multiple times in one response.",
  ];

  if (sessionConfig) {
    descriptionLines.push(
      "",
      "Set session.mode=new to create a resumable subagent session.",
      "Set session.mode=resume with session.id to continue an earlier subagent session.",
      "Set session.mode=fork with session.id to clone an earlier session into a new one.",
      'When session is omitted, the default mode is "' +
        (sessionConfig.defaultMode ?? "stateless") +
        '".',
    );
  }

  if (registry) {
    descriptionLines.push(
      "",
      "Set background=true to spawn the agent in the background and return immediately with a run ID.",
      "Use agent_status, agent_await, or agent_cancel to manage background runs.",
    );
  }

  if (listing) {
    descriptionLines.push("", "Available agents:", listing);
  } else if (isSubagentCatalog(subagents)) {
    descriptionLines.push("", "Available agents are resolved dynamically at runtime.");
  }

  const baseSchema = z.object({
    agent: createAgentSelectionSchema(names).describe("Which agent to use"),
    prompt: z.string().describe("Detailed task description for the subagent"),
  });

  const withSession = sessionConfig
    ? baseSchema.extend({
        session: createTaskSessionSchema()
          .optional()
          .describe("Optional resumable session instructions"),
      })
    : baseSchema;

  const inputSchema = registry
    ? withSession.extend({
        background: z
          .boolean()
          .optional()
          .describe("If true, spawn in background and return immediately with a run ID"),
      })
    : withSession;

  return tool({
    description: descriptionLines.join("\n"),
    inputSchema,
    execute: async (
      rawInput: z.infer<typeof inputSchema>,
      { abortSignal }: { abortSignal?: AbortSignal },
    ) => {
      const { agent: agentName, prompt } = rawInput;
      const background = "background" in rawInput ? rawInput.background : undefined;
      const session =
        "session" in rawInput ? (rawInput.session as TaskSessionInput | undefined) : undefined;
      const template = await resolveSubagent(subagents, agentName);
      if (!template) {
        const suffix = names.length > 0 ? ` Available agents: ${names.join(", ")}.` : "";
        throw new Error(`Unknown subagent "${agentName}".${suffix}`);
      }

      const prepared = sessionConfig
        ? await prepareSubagentChild({
            agentName,
            template,
            remainingDepth,
            onSubagentEvent,
            sessionConfig,
            session,
          })
        : {
            child: createChildFromTemplate(
              template,
              remainingDepth,
              onSubagentEvent,
            ),
            sessionId: undefined,
          };

      const { child, sessionId } = prepared;

      if (background && registry) {
        const id = registry.spawn(agentName, child, prompt, {
          signal: abortSignal,
          onEvent: onSubagentEvent,
          sessionId,
        });
        return formatBackgroundSpawn(agentName, id, sessionId);
      }

      let lastText = "";
      try {
        for await (const event of child.run([], prompt, { signal: abortSignal })) {
          onSubagentEvent?.([agentName], event);
          if (event.type === "text.done") {
            lastText = event.text;
          }
        }
      } finally {
        await child.close();
      }

      return formatTaskResult(lastText || "(no output)", sessionId);
    },
  });
}

function createStatusTool(registry: AgentRegistry) {
  return tool({
    description: "Check the status of a background run without blocking.",
    inputSchema: z.object({
      id: z.string().describe("The run ID returned by a background task spawn"),
    }),
    execute: async ({ id }: { id: string }) => {
      const status = registry.getStatus(id);
      if (!status) return `Agent "${id}" not found.`;
      if (status.status === "done") {
        return formatAgentStatus(id, status.status, status.result, undefined, status.sessionId);
      }
      if (status.status === "failed") {
        return formatAgentStatus(
          id,
          status.status,
          undefined,
          status.error ?? "unknown",
          status.sessionId,
        );
      }
      if (status.status === "cancelled") {
        return formatAgentStatus(id, status.status, undefined, undefined, status.sessionId);
      }
      return formatAgentStatus(id, status.status, undefined, undefined, status.sessionId);
    },
  });
}

function createCancelTool(registry: AgentRegistry) {
  return tool({
    description: "Cancel a running background run.",
    inputSchema: z.object({
      id: z.string().describe("The run ID to cancel"),
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
      "Wait for one or more background runs to complete.",
      "",
      "Modes:",
      ...modes.map((mode) => `- ${modeDescriptions[mode]}`),
    ].join("\n"),
    inputSchema: z.object({
      ids: z.array(z.string()).min(1).describe("Run IDs to wait for"),
      mode: z.enum(modes as [AwaitMode, ...AwaitMode[]]).describe("How to wait for runs"),
    }),
    execute: async ({ ids, mode }: { ids: string[]; mode: AwaitMode }) => {
      switch (mode) {
        case "all": {
          try {
            const results = await registry.awaitAll(ids);
            const entries = [...results.entries()].map(([id, result]) => {
              const sessionId = registry.getStatus(id)?.sessionId;
              return `<agent id="${id}"${formatOptionalAttr("session_id", sessionId)}>\n${result}\n</agent>`;
            });
            return `<await_result mode="all">\n${entries.join("\n")}\n</await_result>`;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return `<await_result mode="all" error="${message}" />`;
          }
        }

        case "allSettled": {
          const results = await registry.awaitAllSettled(ids);
          const entries = [...results.entries()].map(([id, result]) => {
            const sessionAttr = formatOptionalAttr("session_id", result.sessionId);
            if (result.status === "done") {
              return `<agent id="${id}" status="done"${sessionAttr}>\n${result.result}\n</agent>`;
            }
            return `<agent id="${id}" status="${result.status}"${sessionAttr} error="${result.error ?? "unknown"}" />`;
          });
          return `<await_result mode="allSettled">\n${entries.join("\n")}\n</await_result>`;
        }

        case "any": {
          try {
            const { id, sessionId, result } = await registry.awaitAny(ids);
            return `<await_result mode="any" winner="${id}"${formatOptionalAttr("session_id", sessionId)}>\n${result}\n</await_result>`;
          } catch {
            return `<await_result mode="any" error="All agents failed." />`;
          }
        }

        case "race": {
          const settled = await registry.awaitRace(ids);
          const sessionAttr = formatOptionalAttr("session_id", settled.sessionId);
          if (settled.error) {
            return `<await_result mode="race" settled="${settled.id}"${sessionAttr} status="failed" error="${settled.error}" />`;
          }
          return `<await_result mode="race" settled="${settled.id}"${sessionAttr}>\n${settled.result}\n</await_result>`;
        }
      }
    },
  });
}

async function prepareSubagentChild(params: {
  agentName: string;
  template: Agent;
  remainingDepth: number;
  onSubagentEvent?: SubagentEventFn;
  sessionConfig: SubagentSessionsConfig;
  session?: TaskSessionInput;
}): Promise<{ child: Agent; sessionId?: string }> {
  const {
    agentName,
    template,
    remainingDepth,
    onSubagentEvent,
    sessionConfig,
    session,
  } = params;
  const child = createChildFromTemplate(template, remainingDepth, onSubagentEvent);
  const mode = session?.mode ?? sessionConfig.defaultMode ?? "stateless";
  if (mode === "stateless") {
    return { child };
  }

  const runtime = getSubagentSessionRuntime(sessionConfig);
  const now = new Date().toISOString();
  let sessionId: string;
  let initialMessages: ModelMessage[] = [];
  let metadata: SubagentSessionMetadata;

  try {
    switch (mode) {
      case "new":
        sessionId = crypto.randomUUID();
        metadata = {
          sessionId,
          agentName,
          createdAt: now,
          updatedAt: now,
        };
        await runtime.metadataStore.save(metadata);
        break;

      case "resume": {
        sessionId = requireSessionId(session, mode);
        metadata = await loadRequiredSessionMetadata(
          runtime.metadataStore,
          sessionId,
          agentName,
        );
        const storedMessages = await sessionConfig.messages.load(sessionId);
        if (!storedMessages) {
          throw new Error(`Subagent session "${sessionId}" could not be loaded.`);
        }
        initialMessages = structuredClone(storedMessages);
        metadata = { ...metadata, updatedAt: now };
        break;
      }

      case "fork": {
        const sourceId = requireSessionId(session, mode);
        await loadRequiredSessionMetadata(
          runtime.metadataStore,
          sourceId,
          agentName,
        );
        const sourceMessages = await sessionConfig.messages.load(sourceId);
        if (!sourceMessages) {
          throw new Error(`Subagent session "${sourceId}" could not be loaded.`);
        }
        sessionId = crypto.randomUUID();
        initialMessages = structuredClone(sourceMessages);
        metadata = {
          sessionId,
          agentName,
          createdAt: now,
          updatedAt: now,
        };
        await runtime.metadataStore.save(metadata);
        await sessionConfig.messages.save(sessionId, initialMessages);
        break;
      }

      default:
        return { child };
    }
  } catch (error) {
    await child.close();
    throw error;
  }

  if (runtime.activeSessionIds.has(sessionId)) {
    await child.close();
    throw new Error(`Subagent session "${sessionId}" is already running.`);
  }

  runtime.activeSessionIds.add(sessionId);
  let released = false;

  const close = async () => {
    if (released) return;
    released = true;
    runtime.activeSessionIds.delete(sessionId);
    await child.close();
  };

  const statefulChild = {
    run: async function* (
      _history: ModelMessage[],
      input: string | ModelMessage[],
      options?: { signal?: AbortSignal },
    ): AsyncGenerator<AgentEvent> {
      const session = new Session({
        agent: child,
        sessionId,
        sessionStore: sessionConfig.messages,
        ...(sessionConfig.sessionOptions ?? {}),
      });
      session.messages = structuredClone(initialMessages);

      try {
        for await (const event of session.send(input, options)) {
          if (
            event.type === "turn.start" ||
            event.type === "turn.done" ||
            event.type === "compaction.start" ||
            event.type === "compaction.pruned" ||
            event.type === "compaction.summary" ||
            event.type === "compaction.done" ||
            event.type === "retry"
          ) {
            continue;
          }
          yield event;
        }
        await runtime.metadataStore.save({
          sessionId,
          agentName,
          createdAt: metadata.createdAt,
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        await runtime.metadataStore.save({
          sessionId,
          agentName,
          createdAt: metadata.createdAt,
          updatedAt: new Date().toISOString(),
        });
        throw error;
      }
    },
    close,
  } as unknown as Agent;

  return { child: statefulChild, sessionId };
}

function getSubagentSessionRuntime(
  config: SubagentSessionsConfig,
): SubagentSessionRuntime {
  let runtime = SUBAGENT_SESSION_RUNTIME.get(config);
  if (!runtime) {
    runtime = {
      activeSessionIds: new Set<string>(),
      metadataStore:
        config.metadata ?? new InMemorySubagentSessionMetadataStore(),
    };
    SUBAGENT_SESSION_RUNTIME.set(config, runtime);
  }
  return runtime;
}

function createAgentSelectionSchema(names: string[]) {
  if (names.length > 0) {
    return z.enum(names as [string, ...string[]]);
  }
  return z.string().min(1);
}

function createTaskSessionSchema() {
  return z
    .object({
      mode: z.enum(TASK_SESSION_MODES).describe("How to handle subagent memory"),
      id: z.string().optional().describe("Existing session ID to resume or fork"),
    })
    .superRefine((value, ctx) => {
      if ((value.mode === "resume" || value.mode === "fork") && !value.id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `session.id is required when session.mode="${value.mode}"`,
          path: ["id"],
        });
      }

      if ((value.mode === "stateless" || value.mode === "new") && value.id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `session.id is not used when session.mode="${value.mode}"`,
          path: ["id"],
        });
      }
    });
}

async function listSubagentDescriptors(
  subagents: SubagentSource,
): Promise<SubagentDescriptor[]> {
  if (Array.isArray(subagents)) {
    return subagents.map((agent) => ({
      name: agent.name,
      description: agent.description,
    }));
  }
  return subagents.list();
}

async function resolveSubagent(
  subagents: SubagentSource,
  name: string,
): Promise<Agent | undefined> {
  if (Array.isArray(subagents)) {
    return subagents.find((agent) => agent.name === name);
  }
  return subagents.resolve(name);
}

async function loadRequiredSessionMetadata(
  store: SubagentSessionMetadataStore,
  sessionId: string,
  agentName: string,
): Promise<SubagentSessionMetadata> {
  const metadata = await store.load(sessionId);
  if (!metadata) {
    throw new Error(`Unknown subagent session "${sessionId}".`);
  }
  if (metadata.agentName !== agentName) {
    throw new Error(
      `Subagent session "${sessionId}" belongs to "${metadata.agentName}", not "${agentName}".`,
    );
  }
  return metadata;
}

function requireSessionId(
  session: TaskSessionInput | undefined,
  mode: "resume" | "fork",
): string {
  if (!session?.id) {
    throw new Error(`session.id is required when session.mode="${mode}".`);
  }
  return session.id;
}

function formatBackgroundSpawn(
  agentName: string,
  runId: string,
  sessionId?: string,
) {
  return `<background_spawn agent_id="${runId}"${formatOptionalAttr("session_id", sessionId)}>\nAgent "${agentName}" spawned in background with id "${runId}".\nUse agent_status, agent_await, or agent_cancel to manage it.\n</background_spawn>`;
}

function formatTaskResult(result: string, sessionId?: string) {
  return `<task_result${formatOptionalAttr("session_id", sessionId)}>\n${result}\n</task_result>`;
}

function formatAgentStatus(
  runId: string,
  status: "running" | "done" | "failed" | "cancelled",
  result?: string,
  error?: string,
  sessionId?: string,
) {
  const sessionAttr = formatOptionalAttr("session_id", sessionId);
  if (status === "done") {
    return `<agent_status id="${runId}" status="done"${sessionAttr}>\n${result}\n</agent_status>`;
  }
  if (status === "failed") {
    return `<agent_status id="${runId}" status="failed"${sessionAttr} error="${error ?? "unknown"}" />`;
  }
  if (status === "cancelled") {
    return `<agent_status id="${runId}" status="cancelled"${sessionAttr} />`;
  }
  return `<agent_status id="${runId}" status="running"${sessionAttr} />`;
}

function formatOptionalAttr(name: string, value: string | undefined) {
  return value ? ` ${name}="${value}"` : "";
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
  for (const [name, toolDef] of Object.entries(tools)) {
    if (!toolDef.execute) {
      wrapped[name] = toolDef;
      continue;
    }

    const originalExecute = toolDef.execute;
    wrapped[name] = {
      ...toolDef,
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
