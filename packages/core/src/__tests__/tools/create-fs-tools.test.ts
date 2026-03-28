import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { NodeFsProvider } from "../../providers/node.js";
import { createFsTools } from "../../tools/create-fs-tools.js";

// ── Helpers ─────────────────────────────────────────────────────────

let tmpDir: string;
let provider: NodeFsProvider;
let tools: ReturnType<typeof createFsTools>;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oh-fs-tools-"));
  provider = new NodeFsProvider({ cwd: tmpDir });
  tools = createFsTools(provider);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper to bypass AI SDK's union return type
async function exec(tool: any, input: any): Promise<any> {
  return tool.execute(input, { toolCallId: "test", messages: [] });
}

async function writeTestFile(name: string, content: string) {
  const full = path.join(tmpDir, name);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf-8");
}

// ── readFile ────────────────────────────────────────────────────────

describe("readFile", () => {
  it("reads a file with line numbers", async () => {
    await writeTestFile("hello.txt", "line one\nline two\nline three");
    const result = await exec(tools.readFile, { filePath: "hello.txt" });
    expect(result.content).toContain("1: line one");
    expect(result.content).toContain("2: line two");
    expect(result.content).toContain("3: line three");
    expect(result.totalLines).toBe(3);
  });

  it("supports 1-based offset", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
    await writeTestFile("lines.txt", lines);

    const result = await exec(tools.readFile, { filePath: "lines.txt", offset: 5, limit: 3 });
    expect(result.content).toContain("5: line 5");
    expect(result.content).toContain("6: line 6");
    expect(result.content).toContain("7: line 7");
    expect(result.fromLine).toBe(5);
    expect(result.toLine).toBe(7);
  });

  it("returns pagination hint when file is truncated by line limit", async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
    await writeTestFile("big.txt", lines);

    const smallTools = createFsTools(provider, { maxLines: 10 });
    const result = await exec(smallTools.readFile, { filePath: "big.txt" });

    expect(result.toLine).toBe(10);
    expect(result.totalLines).toBe(100);
    expect(result.status).toContain("offset=11");
  });

  it("truncates output at maxOutputBytes", async () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}: ${"x".repeat(100)}`).join("\n");
    await writeTestFile("huge.txt", lines);

    const smallTools = createFsTools(provider, { maxOutputBytes: 500 });
    const result = await exec(smallTools.readFile, { filePath: "huge.txt" });

    expect(result.status).toContain("capped");
    expect(result.status).toContain("offset=");
  });

  it("truncates long lines", async () => {
    const longLine = "x".repeat(5000);
    await writeTestFile("long-line.txt", longLine);

    const result = await exec(tools.readFile, { filePath: "long-line.txt" });

    expect(result.content).toContain("line truncated");
    expect(result.content.length).toBeLessThan(5000);
  });

  it("rejects binary files by extension", async () => {
    await writeTestFile("image.png", "fake png");
    const result = await exec(tools.readFile, { filePath: "image.png" });
    expect(result.error).toContain("binary");
  });

  it("returns error for out-of-range offset", async () => {
    await writeTestFile("small.txt", "one\ntwo");
    const result = await exec(tools.readFile, { filePath: "small.txt", offset: 100 });
    expect(result.error).toContain("out of range");
  });

  it("returns error when file is too large for provider", async () => {
    const tinyProvider = new NodeFsProvider({ cwd: tmpDir, maxFileSize: 10 });
    const tinyTools = createFsTools(tinyProvider);

    await writeTestFile("toobig.txt", "a".repeat(100));
    const result = await exec(tinyTools.readFile, { filePath: "toobig.txt" });
    expect(result.error).toContain("too large");
  });

  it("shows end-of-file status when reading entire file", async () => {
    await writeTestFile("short.txt", "hello");
    const result = await exec(tools.readFile, { filePath: "short.txt" });
    expect(result.status).toContain("End of file");
  });
});

// ── writeFile ───────────────────────────────────────────────────────

describe("writeFile", () => {
  it("creates a new file", async () => {
    const result = await exec(tools.writeFile, { filePath: "new.txt", content: "hello" });
    expect(result.bytesWritten).toBe(5);
    const content = await fs.readFile(path.join(tmpDir, "new.txt"), "utf-8");
    expect(content).toBe("hello");
  });

  it("creates parent directories", async () => {
    await exec(tools.writeFile, { filePath: "a/b/c.txt", content: "nested" });
    const content = await fs.readFile(path.join(tmpDir, "a/b/c.txt"), "utf-8");
    expect(content).toBe("nested");
  });
});

// ── editFile ────────────────────────────────────────────────────────

describe("editFile", () => {
  it("replaces first occurrence", async () => {
    await writeTestFile("edit.txt", "foo bar foo baz");
    const result = await exec(tools.editFile, {
      filePath: "edit.txt", oldString: "foo", newString: "qux", replaceAll: false,
    });
    expect(result.replacements).toBe(1);
    const content = await fs.readFile(path.join(tmpDir, "edit.txt"), "utf-8");
    expect(content).toBe("qux bar foo baz");
  });

  it("replaces all occurrences", async () => {
    await writeTestFile("edit.txt", "foo bar foo baz");
    const result = await exec(tools.editFile, {
      filePath: "edit.txt", oldString: "foo", newString: "qux", replaceAll: true,
    });
    expect(result.replacements).toBe(2);
    const content = await fs.readFile(path.join(tmpDir, "edit.txt"), "utf-8");
    expect(content).toBe("qux bar qux baz");
  });

  it("returns error when oldString not found", async () => {
    await writeTestFile("edit.txt", "hello");
    const result = await exec(tools.editFile, {
      filePath: "edit.txt", oldString: "missing", newString: "x", replaceAll: false,
    });
    expect(result.error).toContain("not found");
  });
});

// ── listFiles ───────────────────────────────────────────────────────

describe("listFiles", () => {
  it("lists directory contents", async () => {
    await writeTestFile("a.txt", "a");
    await writeTestFile("b.txt", "b");
    await fs.mkdir(path.join(tmpDir, "subdir"));

    const result = await exec(tools.listFiles, { dirPath: ".", recursive: false });
    const names = result.entries.map((e: { name: string }) => e.name).sort();
    expect(names).toContain("a.txt");
    expect(names).toContain("b.txt");
    expect(names).toContain("subdir");
  });

  it("lists recursively", async () => {
    await writeTestFile("top.txt", "a");
    await writeTestFile("sub/nested.txt", "b");

    const result = await exec(tools.listFiles, { dirPath: ".", recursive: true });
    const names = result.entries.map((e: { name: string }) => e.name);
    expect(names).toContain("top.txt");
    expect(names.some((n: string) => n.includes("nested.txt"))).toBe(true);
  });
});

// ── grep ────────────────────────────────────────────────────────────

describe("grep", () => {
  it("finds matching lines", async () => {
    await writeTestFile("src/a.ts", 'const x = "hello";\nconst y = "world";');
    await writeTestFile("src/b.ts", "// no match here");

    const result = await exec(tools.grep, { pattern: "hello", dirPath: "." });
    expect(result.matchCount).toBe(1);
    expect(result.matches[0].content).toContain("hello");
  });

  it("supports case-insensitive search", async () => {
    await writeTestFile("file.txt", "Hello World");
    const result = await exec(tools.grep, { pattern: "hello", dirPath: ".", ignoreCase: true });
    expect(result.matchCount).toBe(1);
  });

  it("filters by glob suffix", async () => {
    await writeTestFile("code.ts", "match");
    await writeTestFile("code.js", "match");

    const result = await exec(tools.grep, { pattern: "match", dirPath: ".", glob: ".ts" });
    expect(result.matchCount).toBe(1);
    expect(result.matches[0].file).toContain(".ts");
  });
});

// ── deleteFile ──────────────────────────────────────────────────────

describe("deleteFile", () => {
  it("deletes a file", async () => {
    await writeTestFile("bye.txt", "content");
    const result = await exec(tools.deleteFile, { filePath: "bye.txt", recursive: false });
    expect(result.deleted).toBeTruthy();
    const exists = await fs.access(path.join(tmpDir, "bye.txt")).then(() => true, () => false);
    expect(exists).toBe(false);
  });

  it("returns error for directory without recursive flag", async () => {
    await fs.mkdir(path.join(tmpDir, "dir"));
    const result = await exec(tools.deleteFile, { filePath: "dir", recursive: false });
    expect(result.error).toContain("directory");
  });

  it("deletes directory recursively", async () => {
    await writeTestFile("dir/file.txt", "x");
    const result = await exec(tools.deleteFile, { filePath: "dir", recursive: true });
    expect(result.deleted).toBeTruthy();
  });
});
