import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { createParallelSearchAgent } from "./parallel-search.js";

const question = "What is Streamable HTTP in MCP?";
const source = "https://modelcontextprotocol.io/specification/2025-03-26/basic/transports";
const answer = `Streamable HTTP uses HTTP POST and GET for MCP messages. Source: ${source}`;
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

test("the example discovers and executes HTTP MCP tools through Agent.run", async () => {
  const requests: Array<{
    method: string;
    params?: { name?: string; arguments?: unknown };
    userAgent?: string;
    authorization?: string;
  }> = [];
  const server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const message = JSON.parse(body);
    requests.push({
      method: message.method,
      params: message.params,
      userAgent: req.headers["user-agent"],
      authorization: req.headers.authorization,
    });
    if (message.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    let result: unknown;
    switch (message.method) {
      case "initialize":
        result = {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "search-fixture", version: "1.0.0" },
        };
        break;
      case "tools/list":
        result = {
          tools: [
            {
              name: "web_search",
              description: "Search the web",
              inputSchema: {
                type: "object",
                properties: {
                  objective: { type: "string" },
                  search_queries: { type: "array", items: { type: "string" } },
                },
                required: ["objective", "search_queries"],
              },
            },
          ],
        };
        break;
      case "tools/call":
        result = { content: [{ type: "text", text: answer }] };
        break;
      default:
        res.writeHead(400).end();
        return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const originalFetch = globalThis.fetch;
  // Redirect only the example's endpoint to a real local HTTP protocol fixture.
  // Keep the actual Agent configuration and MCP transport intact.
  globalThis.fetch = (input, init) => {
    assert.equal(String(input), "https://search.parallel.ai/mcp");
    return originalFetch(`http://127.0.0.1:${address.port}/mcp`, init);
  };

  const model = new MockLanguageModelV3({
    doStream: async ({ prompt, tools }) => {
      assert.ok(tools?.some((tool) => tool.name === "web_search"));
      const toolMessage = prompt.find((message) => message.role === "tool");
      if (!toolMessage) {
        return {
          stream: convertArrayToReadableStream([
            { type: "stream-start", warnings: [] },
            {
              type: "tool-call",
              toolCallId: "search-1",
              toolName: "web_search",
              input: JSON.stringify({
                objective: question,
                search_queries: ["MCP Streamable HTTP"],
              }),
            },
            { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
          ]),
        };
      }
      assert.ok(JSON.stringify(toolMessage).includes(source));
      return {
        stream: convertArrayToReadableStream([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "answer" },
          { type: "text-delta", id: "answer", delta: answer },
          { type: "text-end", id: "answer" },
          { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
        ]),
      };
    },
  });
  const agent = createParallelSearchAgent(model);
  try {
    assert.equal(requests.length, 0, "connection is lazy");
    const events = [];
    for await (const event of agent.run([], question)) events.push(event);
    assert.ok(
      events.some((event) => event.type === "tool.done" && event.toolName === "web_search"),
    );
    assert.equal(
      events
        .filter((event) => event.type === "text.delta")
        .map((event) => event.text)
        .join(""),
      answer,
    );
    assert.ok(events.some((event) => event.type === "done" && event.result === "complete"));
    assert.ok(!events.some((event) => event.type === "error" || event.type === "tool.error"));
    assert.equal(model.doStreamCalls.length, 2);
    assert.ok(requests.some((request) => request.method === "tools/list"));
    const call = requests.find((request) => request.method === "tools/call");
    assert.equal(call?.params?.name, "web_search");
    assert.deepEqual(call?.params?.arguments, {
      objective: question,
      search_queries: ["MCP Streamable HTTP"],
    });
    for (const request of requests) {
      assert.match(request.userAgent ?? "", /open-harness\/parallel-search-example/);
      assert.equal(request.authorization, undefined);
    }
    await agent.close();
    const count = requests.length;
    await agent.close();
    assert.equal(requests.length, count, "close is idempotent");
  } finally {
    await agent.close();
    globalThis.fetch = originalFetch;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("the entry point explains missing inputs without opening an MCP connection", () => {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  const missingQuestion = spawnSync(process.execPath, ["--import", "tsx", "parallel-search.ts"], {
    encoding: "utf8",
    env,
  });
  assert.equal(missingQuestion.status, 1);
  assert.match(missingQuestion.stderr, /Usage:/);
  const missingKey = spawnSync(
    process.execPath,
    ["--import", "tsx", "parallel-search.ts", question],
    { encoding: "utf8", env },
  );
  assert.equal(missingKey.status, 1);
  assert.match(missingKey.stderr, /Set OPENAI_API_KEY/);
});
