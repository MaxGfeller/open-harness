import { tool } from "ai";
import { z } from "zod";
import { execFile } from "node:child_process";

export const bash = tool({
  description:
    "Run a bash command and return its output. " +
    "Use this for git operations, running tests, installing packages, " +
    "building projects, and any other shell tasks. " +
    "Commands run in the project's working directory. " +
    "Prefer dedicated file tools (readFile, writeFile, etc.) over shell equivalents (cat, echo >).",
  inputSchema: z.object({
    command: z.string().describe("The bash command to execute"),
    timeout: z
      .number()
      .int()
      .min(1000)
      .max(300000)
      .optional()
      .default(30000)
      .describe("Timeout in milliseconds (default 30s, max 5min)"),
  }),
  execute: async ({ command, timeout }) => {
    return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
      const child = execFile(
        "bash",
        ["-c", command],
        { timeout, maxBuffer: 1024 * 1024, cwd: process.cwd() },
        (error, stdout, stderr) => {
          resolve({
            stdout: truncate(stdout, 50000),
            stderr: truncate(stderr, 10000),
            exitCode: child.exitCode ?? (error ? 1 : 0),
          });
        },
      );
    });
  },
});

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n... (truncated, ${text.length - max} chars omitted)`;
}

export const bashTools = { bash };
