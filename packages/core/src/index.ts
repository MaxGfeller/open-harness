// ── Agent ────────────────────────────────────────────────────────────

export {
  Agent,
  ToolDeniedError,
  type AgentEvent,
  type TokenUsage,
  type ToolCallInfo,
  type ApproveFn,
  type SubagentEventFn,
} from "./agent.js";

// ── Agent Registry (background subagents) ───────────────────────────

export {
  AgentRegistry,
  type SubagentBackground,
  type AwaitMode,
  type AgentStatus,
  type SettledResult,
  type BackgroundAgentConfig,
} from "./agent-registry.js";

// ── MCP ─────────────────────────────────────────────────────────────

export {
  connectMCPServers,
  closeMCPClients,
  type MCPServerConfig,
  type MCPConnection,
  type StdioMCPServer,
  type HttpMCPServer,
  type SseMCPServer,
} from "./mcp.js";

// ── Session ─────────────────────────────────────────────────────────

export {
  Session,
  DefaultCompactionStrategy,
  type SessionEvent,
  type SessionLifecycleEvent,
  type SessionOptions,
  type CompactionStrategy,
  type CompactionContext,
  type CompactionResult,
  type RetryConfig,
  type SessionHooks,
  type TurnInfo,
  type SessionStore,
  type CompactionCheckInfo,
} from "./session.js";

// ── Skills ──────────────────────────────────────────────────────────

export {
  discoverSkills,
  scanSkillFiles,
  type SkillInfo,
  type SkillsConfig,
} from "./skills.js";
export { createSkillTool } from "./tools/skill.js";

// ── Instructions ────────────────────────────────────────────────────

export { findInstructions, loadInstructions } from "./instructions.js";

// ── UI Message Types ────────────────────────────────────────────────

export {
  type OHDataTypes,
  type OHMetadata,
  type OHUIMessage,
} from "./types/ui-message.js";

// ── Stream Parts ────────────────────────────────────────────────────

export {
  // Data part types
  type OHDataPart,
  type OHSubagentPart,
  type OHCompactionPart,
  type OHRetryPart,
  type OHSessionLifecyclePart,

  // Type guards
  isOHDataPart,
  isSubagentEvent,
  isCompactionEvent,
  isRetryEvent,
  isSessionLifecycleEvent,

  // SSE formatters
  formatSSE,
  formatTextDelta,
  formatReasoningDelta,
  formatDataPart,
  formatToolStart,
  formatToolResult,
  formatToolError,
  formatStepStart,
  formatStepFinish,
  formatFinishMessage,
  formatDone,
} from "./types/stream-parts.js";

// ── Message utilities ────────────────────────────────────────────────

export { extractUserInput } from "./messages.js";

// ── UI Stream ───────────────────────────────────────────────────────

export { sessionEventsToUIStream } from "./ui-stream.js";

// ── Runner & Middleware ─────────────────────────────────────────────

export { type Runner, type Middleware, pipe, apply, toRunner } from "./runner.js";

// ── Stream Combinators ──────────────────────────────────────────────

export { tap, filter, map, takeUntil } from "./stream.js";

// ── Middleware ──────────────────────────────────────────────────────

export { withRetry } from "./middleware/retry.js";
export { withCompaction, type CompactionConfig } from "./middleware/compaction.js";
export { withTurnTracking } from "./middleware/turn-tracking.js";
export { withPersistence, type PersistenceConfig } from "./middleware/persistence.js";
export { withHooks } from "./middleware/hooks.js";
export { withActionReceipts, type ActionReceiptsConfig } from "./middleware/action-receipts.js";

// ── Conversation ───────────────────────────────────────────────────

export { Conversation, type ConversationOptions } from "./conversation.js";

// ── Providers ────────────────────────────────────────────────────

export type {
  FsProvider,
  FileStat,
  DirEntry,
  ShellProvider,
  ShellResult,
  Environment,
} from "./providers/types.js";

export {
  NodeFsProvider,
  NodeShellProvider,
  FileTooLargeError,
} from "./providers/node.js";

export type {
  NodeFsProviderOptions,
  NodeShellProviderOptions,
} from "./providers/node.js";

// ── Tool Factories ──────────────────────────────────────────────

export { createFsTools, type CreateFsToolsOptions } from "./tools/create-fs-tools.js";
export { createBashTool } from "./tools/create-bash-tool.js";
export { createLocalTools } from "./tools/create-local-tools.js";
