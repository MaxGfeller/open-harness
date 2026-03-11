import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// ── Types ─────────────────────────────────────────────────────────────

export interface SkillInfo {
  /** Unique skill identifier (lowercase, hyphenated). */
  name: string;
  /** Short description of what the skill does. */
  description: string;
  /** Absolute path to the SKILL.md file. */
  location: string;
  /** Markdown body (after frontmatter). */
  content: string;
}

export interface SkillsConfig {
  /**
   * Directories to scan for `** /SKILL.md` files.
   * Supports absolute paths, relative paths (resolved from cwd), and `~/…` paths.
   * Later paths take precedence — a skill with the same name overwrites an earlier one.
   */
  paths?: string[];
}

// ── Discovery ─────────────────────────────────────────────────────────

const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Scan configured paths for `SKILL.md` files and return parsed skill info.
 * Later paths overwrite earlier ones when names collide.
 */
export async function discoverSkills(config: SkillsConfig): Promise<SkillInfo[]> {
  const skills = new Map<string, SkillInfo>();

  for (const raw of config.paths ?? []) {
    const resolved = resolvePath(raw);
    const matches = await findSkillFiles(resolved);

    for (const match of matches) {
      const info = await parseSkillFile(match);
      if (info) {
        skills.set(info.name, info);
      }
    }
  }

  return Array.from(skills.values());
}

// ── Frontmatter parsing ───────────────────────────────────────────────

interface ParsedFrontmatter {
  data: Record<string, string>;
  content: string;
}

/**
 * Minimal YAML frontmatter parser. Handles the simple `key: value` format
 * used by SKILL.md files without requiring an external dependency.
 */
function parseFrontmatter(raw: string): ParsedFrontmatter | null {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) return null;

  const endIndex = trimmed.indexOf("\n---", 3);
  if (endIndex === -1) return null;

  const yamlBlock = trimmed.slice(3, endIndex).trim();
  const content = trimmed.slice(endIndex + 4).trim();

  const data: Record<string, string> = {};
  for (const line of yamlBlock.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    // Take everything after the first colon so values containing colons are preserved
    const value = line.slice(colonIndex + 1).trim();
    if (key && value) {
      data[key] = value;
    }
  }

  return { data, content };
}

async function parseSkillFile(filePath: string): Promise<SkillInfo | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }

  const parsed = parseFrontmatter(raw);
  if (!parsed) {
    console.warn(`[skills] Could not parse frontmatter: ${filePath}`);
    return null;
  }

  const { name, description } = parsed.data;

  if (!name || !description) {
    console.warn(`[skills] Missing name or description in frontmatter: ${filePath}`);
    return null;
  }

  if (!SKILL_NAME_RE.test(name)) {
    console.warn(
      `[skills] Invalid skill name "${name}" in ${filePath}. ` +
        `Must be lowercase alphanumeric with single hyphens.`,
    );
    return null;
  }

  return {
    name,
    description,
    location: filePath,
    content: parsed.content,
  };
}

// ── File system helpers ───────────────────────────────────────────────

function resolvePath(raw: string): string {
  if (raw.startsWith("~/")) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return path.resolve(raw);
}

/**
 * Recursively find all `SKILL.md` files under `dir`.
 */
async function findSkillFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
  } catch {
    // Directory doesn't exist or isn't readable — silently skip
    return [];
  }

  const results: string[] = [];
  for (const entry of entries) {
    if (entry.name === "SKILL.md" && !entry.isDirectory()) {
      const parent = entry.parentPath ?? (entry as any).path ?? dir;
      results.push(path.join(parent, entry.name));
    }
  }
  return results;
}

/**
 * List auxiliary files in a skill directory (everything except SKILL.md).
 * Returns up to `limit` absolute paths.
 */
export async function scanSkillFiles(dir: string, limit = 10): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    if (entry.name === "SKILL.md") continue;

    const parent = entry.parentPath ?? (entry as any).path ?? dir;
    files.push(path.join(parent, entry.name));

    if (files.length >= limit) break;
  }
  return files;
}
