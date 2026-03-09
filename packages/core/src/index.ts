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
