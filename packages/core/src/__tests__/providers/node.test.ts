import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { NodeFsProvider, NodeShellProvider, FileTooLargeError } from "../../providers/node.js";

// ── Helpers ─────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oh-node-provider-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── NodeFsProvider ──────────────────────────────────────────────────

describe("NodeFsProvider", () => {
  it("resolves paths relative to cwd option", () => {
    const provider = new NodeFsProvider({ cwd: "/some/dir" });
    expect(provider.resolvePath("foo.txt")).toBe("/some/dir/foo.txt");
    expect(provider.resolvePath("/absolute/path.txt")).toBe("/absolute/path.txt");
  });

  it("reads and writes files", async () => {
    const provider = new NodeFsProvider({ cwd: tmpDir });
    await provider.writeFile("test.txt", "hello world");
    const content = await provider.readFile("test.txt");
    expect(content).toBe("hello world");
  });

  it("creates parent directories on write", async () => {
    const provider = new NodeFsProvider({ cwd: tmpDir });
    await provider.writeFile("a/b/c.txt", "nested");
    const content = await provider.readFile("a/b/c.txt");
    expect(content).toBe("nested");
  });

  it("throws FileTooLargeError for oversized files", async () => {
    const provider = new NodeFsProvider({ cwd: tmpDir, maxFileSize: 10 });
    await fs.writeFile(path.join(tmpDir, "big.txt"), "a".repeat(100));

    await expect(provider.readFile("big.txt")).rejects.toThrow(FileTooLargeError);
    await expect(provider.readFile("big.txt")).rejects.toThrow(/File too large/);
  });

  it("checks file existence", async () => {
    const provider = new NodeFsProvider({ cwd: tmpDir });
    expect(await provider.exists("nope.txt")).toBe(false);
    await provider.writeFile("yep.txt", "hi");
    expect(await provider.exists("yep.txt")).toBe(true);
  });

  it("returns stat information", async () => {
    const provider = new NodeFsProvider({ cwd: tmpDir });
    await provider.writeFile("file.txt", "content");
    await provider.mkdir("dir");

    const fileStat = await provider.stat("file.txt");
    expect(fileStat.isFile).toBe(true);
    expect(fileStat.isDirectory).toBe(false);
    expect(fileStat.size).toBe(7);

    const dirStat = await provider.stat("dir");
    expect(dirStat.isFile).toBe(false);
    expect(dirStat.isDirectory).toBe(true);
  });

  it("lists directory entries", async () => {
    const provider = new NodeFsProvider({ cwd: tmpDir });
    await provider.writeFile("a.txt", "a");
    await provider.writeFile("b.txt", "b");
    await provider.mkdir("subdir");

    const entries = await provider.readdir(".");
    const names = entries.map((e) => e.name).sort();
    expect(names).toContain("a.txt");
    expect(names).toContain("b.txt");
    expect(names).toContain("subdir");

    const subdir = entries.find((e) => e.name === "subdir")!;
    expect(subdir.isDirectory).toBe(true);
    expect(subdir.isFile).toBe(false);
  });

  it("creates directories recursively", async () => {
    const provider = new NodeFsProvider({ cwd: tmpDir });
    await provider.mkdir("a/b/c", { recursive: true });
    const stat = await provider.stat("a/b/c");
    expect(stat.isDirectory).toBe(true);
  });

  it("removes files", async () => {
    const provider = new NodeFsProvider({ cwd: tmpDir });
    await provider.writeFile("delete-me.txt", "bye");
    expect(await provider.exists("delete-me.txt")).toBe(true);
    await provider.remove("delete-me.txt");
    expect(await provider.exists("delete-me.txt")).toBe(false);
  });

  it("removes directories recursively", async () => {
    const provider = new NodeFsProvider({ cwd: tmpDir });
    await provider.writeFile("dir/a.txt", "a");
    await provider.writeFile("dir/b.txt", "b");
    await provider.remove("dir", { recursive: true });
    expect(await provider.exists("dir")).toBe(false);
  });

  it("throws when removing directory without recursive", async () => {
    const provider = new NodeFsProvider({ cwd: tmpDir });
    await provider.mkdir("dir");
    await expect(provider.remove("dir")).rejects.toThrow(/directory/i);
  });

  it("renames files", async () => {
    const provider = new NodeFsProvider({ cwd: tmpDir });
    await provider.writeFile("old.txt", "content");
    await provider.rename("old.txt", "new.txt");
    expect(await provider.exists("old.txt")).toBe(false);
    expect(await provider.readFile("new.txt")).toBe("content");
  });
});

// ── NodeShellProvider ───────────────────────────────────────────────

describe("NodeShellProvider", () => {
  it("executes commands and returns output", async () => {
    const provider = new NodeShellProvider();
    const result = await provider.exec("echo hello");
    expect(result.stdout.trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
  });

  it("captures stderr", async () => {
    const provider = new NodeShellProvider();
    const result = await provider.exec("echo error >&2");
    expect(result.stderr.trim()).toBe("error");
  });

  it("returns non-zero exit codes", async () => {
    const provider = new NodeShellProvider();
    const result = await provider.exec("exit 42");
    expect(result.exitCode).toBe(42);
  });

  it("respects cwd option", async () => {
    const provider = new NodeShellProvider({ cwd: tmpDir });
    await fs.writeFile(path.join(tmpDir, "marker.txt"), "found");
    const result = await provider.exec("cat marker.txt");
    expect(result.stdout.trim()).toBe("found");
  });

  it("truncates long output", async () => {
    const provider = new NodeShellProvider({ maxStdout: 20 });
    const result = await provider.exec("echo " + "a".repeat(100));
    expect(result.stdout.length).toBeLessThan(100);
    expect(result.stdout).toContain("truncated");
  });
});
