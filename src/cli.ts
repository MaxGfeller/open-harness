import * as readline from "node:readline";
import { openai } from "@ai-sdk/openai";
import { Agent, type AgentEvent } from "./agent.js";
import { fsTools } from "./tools/fs.js";

const agent = new Agent({
  name: "cli-agent",
  systemPrompt:
    "You are an expert agent built with open-harness. You are invoked through a CLI tool and have access to a set of tools to help you complete tasks. You help the user analyze, understand, make changes to, and implement features in their project.",
  model: openai("gpt-5.2"),
  tools: fsTools,
  maxSteps: 20,
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(): Promise<string> {
  return new Promise((resolve) => {
    rl.question("\n> ", resolve);
  });
}

async function main() {
  console.log("open-harness cli (gpt-5.2 + fs tools)");
  console.log('Type "exit" to quit.\n');

  while (true) {
    const input = await prompt();
    if (input.trim().toLowerCase() === "exit") break;
    if (!input.trim()) continue;

    process.stdout.write("\n");

    let doneEvent: Extract<AgentEvent, { type: "done" }> | undefined;

    for await (const event of agent.run(input)) {
      switch (event.type) {
        case "text.delta":
          process.stdout.write(event.text);
          break;

        case "tool.start":
          process.stdout.write(`\n[tool: ${event.toolName}] `);
          break;

        case "tool.done":
          process.stdout.write("done\n");
          break;

        case "tool.error":
          process.stdout.write(`error: ${event.error}\n`);
          break;

        case "step.done":
          if (event.finishReason === "tool-calls") {
            process.stdout.write("\n");
          }
          break;

        case "error":
          console.error(`\nError: ${event.error.message}`);
          break;

        case "done":
          doneEvent = event;
          break;
      }
    }

    process.stdout.write("\n");

    if (doneEvent) {
      const { totalUsage } = doneEvent;
      if (totalUsage.totalTokens) {
        console.log(`[${doneEvent.result} | ${totalUsage.totalTokens} tokens]`);
      }
    }
  }

  rl.close();
}

main();
