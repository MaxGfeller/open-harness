import fs from "node:fs/promises";
import path from "node:path";

const FILENAMES = ["AGENTS.md", "CLAUDE.md"];

/**
 * Walk from `startDir` up to the filesystem root, returning the first
 * AGENTS.md or CLAUDE.md found. AGENTS.md takes precedence in each directory.
 */
export async function findInstructions(startDir?: string): Promise<string | undefined> {
  let dir = path.resolve(startDir ?? process.cwd());

  while (true) {
    for (const name of FILENAMES) {
      const candidate = path.join(dir, name);
      try {
        await fs.access(candidate);
        const content = await fs.readFile(candidate, "utf-8");
        return content.trim() || undefined;
      } catch {
        // not found, try next
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) break; // reached root
    dir = parent;
  }

  return undefined;
}

/**
 * Build the instruction block that gets prepended to the system prompt.
 */
export async function loadInstructions(startDir?: string): Promise<string | undefined> {
  const content = await findInstructions(startDir);
  if (!content) return undefined;

  return [
    "The following instructions come from the project's AGENTS.md file.",
    "They were written by the project maintainers and describe project-specific",
    "conventions, preferences, and rules you must follow.",
    "",
    "<agents-md>",
    content,
    "</agents-md>",
  ].join("\n");
}
