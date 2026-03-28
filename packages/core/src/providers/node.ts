import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import type { FsProvider, FileStat, DirEntry, ShellProvider, ShellResult } from "./types.js";

// ── NodeFsProvider ──────────────────────────────────────────────────

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export interface NodeFsProviderOptions {
  /** Working directory for resolving relative paths. Defaults to process.cwd(). */
  cwd?: string;
  /** Maximum file size in bytes that readFile will load. Defaults to 10 MB. */
  maxFileSize?: number;
}

export class NodeFsProvider implements FsProvider {
  private cwd: string;
  private maxFileSize: number;

  constructor(options?: NodeFsProviderOptions) {
    this.cwd = options?.cwd ?? process.cwd();
    this.maxFileSize = options?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  }

  resolvePath(filePath: string): string {
    return path.resolve(this.cwd, filePath);
  }

  async readFile(filePath: string): Promise<string> {
    const resolved = this.resolvePath(filePath);
    const stat = await fs.stat(resolved);
    if (stat.size > this.maxFileSize) {
      throw new FileTooLargeError(resolved, stat.size, this.maxFileSize);
    }
    return fs.readFile(resolved, "utf-8");
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const resolved = this.resolvePath(filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, "utf-8");
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePath(filePath));
      return true;
    } catch {
      return false;
    }
  }

  async stat(filePath: string): Promise<FileStat> {
    const stat = await fs.stat(this.resolvePath(filePath));
    return {
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      size: stat.size,
    };
  }

  async readdir(dirPath: string): Promise<DirEntry[]> {
    const entries = await fs.readdir(this.resolvePath(dirPath), { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      isFile: e.isFile(),
      isDirectory: e.isDirectory(),
    }));
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(this.resolvePath(dirPath), { recursive: options?.recursive });
  }

  async remove(filePath: string, options?: { recursive?: boolean }): Promise<void> {
    const resolved = this.resolvePath(filePath);
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      if (!options?.recursive) {
        throw new Error(`Path is a directory. Set recursive to true to delete it: ${resolved}`);
      }
      await fs.rm(resolved, { recursive: true });
    } else {
      await fs.unlink(resolved);
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await fs.rename(this.resolvePath(oldPath), this.resolvePath(newPath));
  }
}

// ── NodeShellProvider ───────────────────────────────────────────────

const MAX_STDOUT = 50_000;
const MAX_STDERR = 10_000;

export interface NodeShellProviderOptions {
  /** Default working directory for commands. Defaults to process.cwd(). */
  cwd?: string;
  /** Maximum stdout size in characters before truncation. Defaults to 50,000. */
  maxStdout?: number;
  /** Maximum stderr size in characters before truncation. Defaults to 10,000. */
  maxStderr?: number;
}

export class NodeShellProvider implements ShellProvider {
  private cwd: string;
  private maxStdout: number;
  private maxStderr: number;

  constructor(options?: NodeShellProviderOptions) {
    this.cwd = options?.cwd ?? process.cwd();
    this.maxStdout = options?.maxStdout ?? MAX_STDOUT;
    this.maxStderr = options?.maxStderr ?? MAX_STDERR;
  }

  exec(
    command: string,
    options?: { timeout?: number; cwd?: string; env?: Record<string, string> },
  ): Promise<ShellResult> {
    return new Promise((resolve) => {
      const child = execFile(
        "bash",
        ["-c", command],
        {
          timeout: options?.timeout ?? 30_000,
          maxBuffer: 1024 * 1024,
          cwd: options?.cwd ?? this.cwd,
          env: options?.env ? { ...process.env, ...options.env } : undefined,
        },
        (error, stdout, stderr) => {
          resolve({
            stdout: truncateOutput(stdout, this.maxStdout),
            stderr: truncateOutput(stderr, this.maxStderr),
            exitCode: child.exitCode ?? (error ? 1 : 0),
          });
        },
      );
    });
  }
}

// ── Errors ──────────────────────────────────────────────────────────

export class FileTooLargeError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly fileSize: number,
    public readonly maxSize: number,
  ) {
    super(
      `File too large: ${filePath} is ${formatBytes(fileSize)} (limit: ${formatBytes(maxSize)}). ` +
        `Use offset and limit parameters to read a portion of the file, or use grep to search it.`,
    );
    this.name = "FileTooLargeError";
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function truncateOutput(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n... (truncated, ${text.length - max} chars omitted)`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
