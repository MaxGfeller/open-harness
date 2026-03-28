import { describe, it, expect } from "vitest";
import { NodeShellProvider } from "../../providers/node.js";
import { createBashTool } from "../../tools/create-bash-tool.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper to bypass AI SDK's union return type
async function exec(tool: any, input: any): Promise<any> {
  return tool.execute(input, { toolCallId: "test", messages: [] });
}

describe("createBashTool", () => {
  it("executes commands via the shell provider", async () => {
    const provider = new NodeShellProvider();
    const { bash } = createBashTool(provider);
    const result = await exec(bash, { command: "echo hello", timeout: 30000 });
    expect(result.stdout.trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
  });

  it("works with a custom shell provider", async () => {
    const mockShell = {
      exec: async () => ({ stdout: "mocked", stderr: "", exitCode: 0 }),
    };
    const { bash } = createBashTool(mockShell);
    const result = await exec(bash, { command: "anything", timeout: 30000 });
    expect(result.stdout).toBe("mocked");
  });
});
