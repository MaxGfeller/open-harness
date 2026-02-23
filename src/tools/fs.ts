import { tool } from "ai";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { readdir } from "node:fs/promises";

export const readFile = tool({
  description:
    "Read the contents of a file. Returns the full text content. " +
    "Optionally read a specific line range with offset and limit.",
  inputSchema: z.object({
    filePath: z.string().describe("Absolute or relative path to the file"),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("0-based line offset to start reading from"),
    limit: z.number().int().min(1).optional().describe("Maximum number of lines to return"),
  }),
  execute: async ({ filePath, offset, limit }) => {
    const resolved = path.resolve(filePath);
    const content = await fs.readFile(resolved, "utf-8");
    const lines = content.split("\n");

    const start = offset ?? 0;
    const end = limit !== undefined ? start + limit : lines.length;
    const slice = lines.slice(start, end);

    return {
      filePath: resolved,
      totalLines: lines.length,
      fromLine: start,
      toLine: Math.min(end, lines.length),
      content: slice.join("\n"),
    };
  },
});

export const writeFile = tool({
  description:
    "Write content to a file. Creates the file (and parent directories) " +
    "if they don't exist, or overwrites the existing file.",
  inputSchema: z.object({
    filePath: z.string().describe("Absolute or relative path to the file"),
    content: z.string().describe("The full content to write"),
  }),
  execute: async ({ filePath, content }) => {
    const resolved = path.resolve(filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, "utf-8");
    return { filePath: resolved, bytesWritten: Buffer.byteLength(content) };
  },
});

export const editFile = tool({
  description:
    "Edit a file by replacing exact string matches. The oldString must " +
    "appear in the file. Set replaceAll to true to replace every occurrence.",
  inputSchema: z.object({
    filePath: z.string().describe("Absolute or relative path to the file"),
    oldString: z.string().describe("The exact text to find"),
    newString: z.string().describe("The replacement text"),
    replaceAll: z
      .boolean()
      .optional()
      .default(false)
      .describe("Replace all occurrences instead of just the first"),
  }),
  execute: async ({ filePath, oldString, newString, replaceAll }) => {
    const resolved = path.resolve(filePath);
    const content = await fs.readFile(resolved, "utf-8");

    if (!content.includes(oldString)) {
      return { error: "oldString not found in file", filePath: resolved };
    }

    const updated = replaceAll
      ? content.replaceAll(oldString, newString)
      : content.replace(oldString, newString);

    await fs.writeFile(resolved, updated, "utf-8");

    const occurrences = content.split(oldString).length - 1;
    const replacements = replaceAll ? occurrences : 1;

    return { filePath: resolved, replacements };
  },
});

export const listFiles = tool({
  description:
    "List files and directories at the given path. " +
    "Set recursive to true to walk subdirectories.",
  inputSchema: z.object({
    dirPath: z
      .string()
      .optional()
      .default(".")
      .describe("Directory path to list (defaults to cwd)"),
    recursive: z.boolean().optional().default(false).describe("Recursively list all entries"),
  }),
  execute: async ({ dirPath, recursive }) => {
    const resolved = path.resolve(dirPath);
    const entries = await readdir(resolved, {
      withFileTypes: true,
      recursive,
    });

    const items = entries.map((e) => ({
      name: recursive ? path.join(e.parentPath ?? "", e.name) : e.name,
      type: e.isDirectory() ? ("directory" as const) : ("file" as const),
    }));

    // Make paths relative to the listed directory
    const result = items.map((item) => ({
      ...item,
      name: path.relative(resolved, path.resolve(resolved, item.name)),
    }));

    return { dirPath: resolved, count: result.length, entries: result };
  },
});

async function walkFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      files.push(...(await walkFiles(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

export const grep = tool({
  description:
    "Search file contents with a regex pattern. Searches recursively " +
    "from the given directory, skipping node_modules and .git. " +
    "Returns matching lines with file paths and line numbers.",
  inputSchema: z.object({
    pattern: z.string().describe("Regex pattern to search for"),
    dirPath: z
      .string()
      .optional()
      .default(".")
      .describe("Root directory to search from (defaults to cwd)"),
    glob: z
      .string()
      .optional()
      .describe("Only search files matching this glob suffix (e.g. '.ts')"),
    ignoreCase: z.boolean().optional().default(false).describe("Case-insensitive matching"),
  }),
  execute: async ({ pattern, dirPath, glob: fileSuffix, ignoreCase }) => {
    const resolved = path.resolve(dirPath);
    const regex = new RegExp(pattern, ignoreCase ? "i" : undefined);
    const allFiles = await walkFiles(resolved);

    const files = fileSuffix ? allFiles.filter((f) => f.endsWith(fileSuffix)) : allFiles;

    const matches: {
      file: string;
      line: number;
      content: string;
    }[] = [];

    for (const file of files) {
      let content: string;
      try {
        content = await fs.readFile(file, "utf-8");
      } catch {
        continue; // skip binary / unreadable files
      }

      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matches.push({
            file: path.relative(resolved, file),
            line: i + 1,
            content: lines[i],
          });
        }
      }
    }

    return { dirPath: resolved, pattern, matchCount: matches.length, matches };
  },
});

export const deleteFile = tool({
  description: "Delete a file or directory. For directories, set recursive to true.",
  inputSchema: z.object({
    filePath: z.string().describe("Path to the file or directory to delete"),
    recursive: z
      .boolean()
      .optional()
      .default(false)
      .describe("Recursively delete directory contents"),
  }),
  execute: async ({ filePath, recursive }) => {
    const resolved = path.resolve(filePath);
    const stat = await fs.stat(resolved);

    if (stat.isDirectory()) {
      if (!recursive) {
        return {
          error: "Path is a directory. Set recursive to true to delete it.",
          filePath: resolved,
        };
      }
      await fs.rm(resolved, { recursive: true });
    } else {
      await fs.unlink(resolved);
    }

    return { deleted: resolved };
  },
});

export const fsTools = {
  readFile,
  writeFile,
  editFile,
  listFiles,
  grep,
  deleteFile,
};
