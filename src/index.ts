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
