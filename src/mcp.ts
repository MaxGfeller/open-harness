import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";

// ── MCP server config ───────────────────────────────────────────────

export interface StdioMCPServer {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface HttpMCPServer {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

export interface SseMCPServer {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
}

export type MCPServerConfig = StdioMCPServer | HttpMCPServer | SseMCPServer;

// ── Client lifecycle ────────────────────────────────────────────────

export interface MCPConnection {
  clients: MCPClient[];
  tools: ToolSet;
}

/**
 * Connect to one or more MCP servers and return a merged toolset.
 * Tools are namespaced as `serverName_toolName` to avoid collisions.
 *
 * Call `close()` on each client when done.
 */
export async function connectMCPServers(
  servers: Record<string, MCPServerConfig>,
): Promise<MCPConnection> {
  const clients: MCPClient[] = [];
  const tools: ToolSet = {};

  const entries = Object.entries(servers);

  const results = await Promise.all(
    entries.map(async ([name, config]) => {
      const transport = await buildTransport(config);
      const client = await createMCPClient({ transport, name });
      const serverTools = await client.tools();
      return { name, client, serverTools };
    }),
  );

  for (const { name, client, serverTools } of results) {
    clients.push(client);
    for (const [toolName, tool] of Object.entries(serverTools)) {
      const key = entries.length === 1 ? toolName : `${name}_${toolName}`;
      tools[key] = tool;
    }
  }

  return { clients, tools };
}

/**
 * Close all MCP clients gracefully.
 */
export async function closeMCPClients(clients: MCPClient[]): Promise<void> {
  await Promise.all(clients.map((c) => c.close().catch(() => {})));
}

// ── Transport builder ───────────────────────────────────────────────

async function buildTransport(config: MCPServerConfig) {
  switch (config.type) {
    case "stdio": {
      // Dynamic import — only available in Node.js
      const { Experimental_StdioMCPTransport } = await import("@ai-sdk/mcp/mcp-stdio");
      return new Experimental_StdioMCPTransport({
        command: config.command,
        args: config.args,
        env: config.env,
        cwd: config.cwd,
      });
    }
    case "http":
      return { type: "http" as const, url: config.url, headers: config.headers };
    case "sse":
      return { type: "sse" as const, url: config.url, headers: config.headers };
  }
}
