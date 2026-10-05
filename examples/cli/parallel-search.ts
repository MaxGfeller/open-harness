import { pathToFileURL } from "node:url";
import { openai } from "@ai-sdk/openai";
import { Agent } from "@openharness/core";

/** A separate, opt-in agent using the built-in HTTP MCP transport. */
export function createParallelSearchAgent(model: Agent["model"]) {
  return new Agent({
    name: "parallel-search",
    model,
    instructions: false,
    systemPrompt:
      "Search the web to answer the user's question. Use the search results as evidence " +
      "and cite source URLs in your answer. Fetch pages when you need more detail.",
    maxSteps: 5,
    mcpServers: {
      parallel: {
        type: "http",
        url: "https://search.parallel.ai/mcp",
        headers: { "User-Agent": "open-harness/parallel-search-example" },
      },
    },
  });
}

async function main() {
  const question = process.argv
    .slice(2)
    .filter((arg) => arg !== "--")
    .join(" ")
    .trim();
  if (!question) {
    console.error('Usage: pnpm --filter cli-demo search "What is Streamable HTTP in MCP?"');
    process.exitCode = 1;
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("Set OPENAI_API_KEY for the answering model. Parallel Search MCP needs no key.");
    process.exitCode = 1;
    return;
  }

  const agent = createParallelSearchAgent(openai("gpt-5.2"));
  try {
    for await (const event of agent.run([], question)) {
      if (event.type === "text.delta") process.stdout.write(event.text);
      if (event.type === "error") throw event.error;
      if (event.type === "tool.error") throw new Error(`${event.toolName}: ${event.error}`);
    }
    process.stdout.write("\n");
  } finally {
    await agent.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
