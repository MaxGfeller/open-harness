import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { discoverSkills, scanSkillFiles } from "../skills.js";
import { createSkillTool } from "../tools/skill.js";
import type { SkillInfo } from "../skills.js";

// ── Helpers ─────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oh-skills-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Write a SKILL.md file under `tmpDir/<name>/SKILL.md`. */
async function writeSkill(
  name: string,
  content: string,
  extraFiles?: Record<string, string>,
): Promise<string> {
  const dir = path.join(tmpDir, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), content, "utf-8");
  for (const [filePath, fileContent] of Object.entries(extraFiles ?? {})) {
    const full = path.join(dir, filePath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, fileContent, "utf-8");
  }
  return dir;
}

// ── discoverSkills ──────────────────────────────────────────────────

describe("discoverSkills", () => {
  it("discovers a single skill", async () => {
    await writeSkill(
      "my-skill",
      `---
name: my-skill
description: A test skill
---

# Instructions

Do the thing.`,
    );

    const skills = await discoverSkills({ paths: [tmpDir] });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("my-skill");
    expect(skills[0].description).toBe("A test skill");
    expect(skills[0].content).toBe("# Instructions\n\nDo the thing.");
    expect(skills[0].location).toBe(path.join(tmpDir, "my-skill", "SKILL.md"));
  });

  it("discovers multiple skills", async () => {
    await writeSkill(
      "skill-a",
      `---
name: skill-a
description: First skill
---

Content A`,
    );
    await writeSkill(
      "skill-b",
      `---
name: skill-b
description: Second skill
---

Content B`,
    );

    const skills = await discoverSkills({ paths: [tmpDir] });
    expect(skills).toHaveLength(2);

    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["skill-a", "skill-b"]);
  });

  it("discovers nested skills", async () => {
    const nestedDir = path.join(tmpDir, "deep", "nested", "my-skill");
    await fs.mkdir(nestedDir, { recursive: true });
    await fs.writeFile(
      path.join(nestedDir, "SKILL.md"),
      `---
name: nested-skill
description: Found deep
---

Nested content`,
      "utf-8",
    );

    const skills = await discoverSkills({ paths: [tmpDir] });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("nested-skill");
  });

  it("later paths overwrite earlier ones on name collision", async () => {
    const dir1 = path.join(tmpDir, "first");
    const dir2 = path.join(tmpDir, "second");

    await fs.mkdir(path.join(dir1, "my-skill"), { recursive: true });
    await fs.writeFile(
      path.join(dir1, "my-skill", "SKILL.md"),
      `---
name: my-skill
description: From first
---

First version`,
      "utf-8",
    );

    await fs.mkdir(path.join(dir2, "my-skill"), { recursive: true });
    await fs.writeFile(
      path.join(dir2, "my-skill", "SKILL.md"),
      `---
name: my-skill
description: From second
---

Second version`,
      "utf-8",
    );

    const skills = await discoverSkills({ paths: [dir1, dir2] });
    expect(skills).toHaveLength(1);
    expect(skills[0].description).toBe("From second");
    expect(skills[0].content).toBe("Second version");
  });

  it("returns empty array for empty paths", async () => {
    const skills = await discoverSkills({ paths: [] });
    expect(skills).toEqual([]);
  });

  it("returns empty array when paths is undefined", async () => {
    const skills = await discoverSkills({});
    expect(skills).toEqual([]);
  });

  it("silently skips non-existent directories", async () => {
    const skills = await discoverSkills({
      paths: [path.join(tmpDir, "does-not-exist")],
    });
    expect(skills).toEqual([]);
  });

  it("skips SKILL.md with missing frontmatter", async () => {
    await writeSkill("bad", "# No frontmatter here\n\nJust content.");

    const skills = await discoverSkills({ paths: [tmpDir] });
    expect(skills).toEqual([]);
  });

  it("skips SKILL.md with missing name", async () => {
    await writeSkill(
      "no-name",
      `---
description: Has description but no name
---

Content`,
    );

    const skills = await discoverSkills({ paths: [tmpDir] });
    expect(skills).toEqual([]);
  });

  it("skips SKILL.md with missing description", async () => {
    await writeSkill(
      "no-desc",
      `---
name: no-desc
---

Content`,
    );

    const skills = await discoverSkills({ paths: [tmpDir] });
    expect(skills).toEqual([]);
  });

  it("skips SKILL.md with invalid name format", async () => {
    await writeSkill(
      "bad-name",
      `---
name: UPPER_CASE
description: Invalid name
---

Content`,
    );

    const skills = await discoverSkills({ paths: [tmpDir] });
    expect(skills).toEqual([]);
  });

  it("rejects names starting with a hyphen", async () => {
    await writeSkill(
      "hyphen",
      `---
name: -leading
description: Bad
---

Content`,
    );

    const skills = await discoverSkills({ paths: [tmpDir] });
    expect(skills).toEqual([]);
  });

  it("rejects names with consecutive hyphens", async () => {
    await writeSkill(
      "double",
      `---
name: foo--bar
description: Bad
---

Content`,
    );

    const skills = await discoverSkills({ paths: [tmpDir] });
    expect(skills).toEqual([]);
  });

  it("preserves colons in description values", async () => {
    await writeSkill(
      "colon",
      `---
name: colon-test
description: Build AI agents: stateful workflows
---

Content`,
    );

    const skills = await discoverSkills({ paths: [tmpDir] });
    expect(skills).toHaveLength(1);
    expect(skills[0].description).toBe("Build AI agents: stateful workflows");
  });
});

// ── scanSkillFiles ──────────────────────────────────────────────────

describe("scanSkillFiles", () => {
  it("returns auxiliary files excluding SKILL.md", async () => {
    const dir = await writeSkill(
      "with-files",
      `---
name: with-files
description: Has extra files
---

Content`,
      {
        "references/api.md": "# API docs",
        "scripts/setup.sh": "#!/bin/bash\necho hi",
      },
    );

    const files = await scanSkillFiles(dir);
    expect(files).toHaveLength(2);

    const basenames = files.map((f) => path.relative(dir, f)).sort();
    expect(basenames).toEqual(["references/api.md", "scripts/setup.sh"]);
  });

  it("excludes SKILL.md from results", async () => {
    const dir = await writeSkill(
      "only-skill",
      `---
name: only-skill
description: Just the skill file
---

Content`,
    );

    const files = await scanSkillFiles(dir);
    expect(files).toEqual([]);
  });

  it("respects the limit parameter", async () => {
    const extras: Record<string, string> = {};
    for (let i = 0; i < 15; i++) {
      extras[`file-${String(i).padStart(2, "0")}.txt`] = `content ${i}`;
    }

    const dir = await writeSkill(
      "many-files",
      `---
name: many-files
description: Lots of files
---

Content`,
      extras,
    );

    const files = await scanSkillFiles(dir, 5);
    expect(files).toHaveLength(5);
  });

  it("returns empty array for non-existent directory", async () => {
    const files = await scanSkillFiles(path.join(tmpDir, "nope"));
    expect(files).toEqual([]);
  });
});

// ── createSkillTool ─────────────────────────────────────────────────

describe("createSkillTool", () => {
  const baseSkill: SkillInfo = {
    name: "test-skill",
    description: "A test skill",
    location: "/fake/test-skill/SKILL.md",
    content: "# Test\n\nDo the thing.",
  };

  it("creates a tool with available skills in description", () => {
    const skillTool = createSkillTool([baseSkill]);
    expect(skillTool.description).toContain("test-skill");
    expect(skillTool.description).toContain("A test skill");
    expect(skillTool.description).toContain("<available_skills>");
  });

  it("lists multiple skills in description", () => {
    const skills: SkillInfo[] = [
      baseSkill,
      { name: "other-skill", description: "Another one", location: "/fake/other/SKILL.md", content: "Other" },
    ];
    const skillTool = createSkillTool(skills);
    expect(skillTool.description).toContain("test-skill");
    expect(skillTool.description).toContain("other-skill");
  });

  it("executes and returns skill content", async () => {
    const dir = await writeSkill(
      "real-skill",
      `---
name: real-skill
description: Real
---

# Instructions

Follow these steps.`,
      { "ref.md": "# Reference" },
    );

    const skill: SkillInfo = {
      name: "real-skill",
      description: "Real",
      location: path.join(dir, "SKILL.md"),
      content: "# Instructions\n\nFollow these steps.",
    };

    const skillTool = createSkillTool([skill]);
    const result = await skillTool.execute!(
      { name: "real-skill" },
      { toolCallId: "test", messages: [], abortSignal: undefined as any },
    );

    expect(result).toContain("<skill_content name=\"real-skill\">");
    expect(result).toContain("# Skill: real-skill");
    expect(result).toContain("Follow these steps.");
    expect(result).toContain(`Base directory for this skill: ${dir}`);
    expect(result).toContain("<skill_files>");
    expect(result).toContain("ref.md</file>");
    expect(result).toContain("</skill_content>");
  });

  it("omits skill_files section when no auxiliary files exist", async () => {
    const dir = await writeSkill(
      "bare-skill",
      `---
name: bare-skill
description: Bare
---

Content only`,
    );

    const skill: SkillInfo = {
      name: "bare-skill",
      description: "Bare",
      location: path.join(dir, "SKILL.md"),
      content: "Content only",
    };

    const skillTool = createSkillTool([skill]);
    const result = await skillTool.execute!(
      { name: "bare-skill" },
      { toolCallId: "test", messages: [], abortSignal: undefined as any },
    );

    expect(result).not.toContain("<skill_files>");
  });

  it("throws for unknown skill name", async () => {
    const skillTool = createSkillTool([baseSkill]);

    await expect(
      skillTool.execute!({ name: "nope" }, { toolCallId: "test", messages: [], abortSignal: undefined as any }),
    ).rejects.toThrow('Skill "nope" not found');
  });
});
