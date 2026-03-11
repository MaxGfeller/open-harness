import { tool } from "ai";
import { z } from "zod";
import path from "node:path";
import { type SkillInfo, scanSkillFiles } from "../skills.js";

/**
 * Create a `skill` tool that lets the LLM load skill instructions into the conversation.
 *
 * The tool description includes an XML listing of available skills so the model
 * knows what it can invoke. When called, it returns the skill's markdown body
 * along with a list of auxiliary files in the skill directory.
 */
export function createSkillTool(skills: SkillInfo[]) {
  const byName = new Map(skills.map((s) => [s.name, s]));

  const listing = skills
    .map((s) => `  <skill><name>${s.name}</name><description>${s.description}</description></skill>`)
    .join("\n");

  const examples = skills
    .slice(0, 3)
    .map((s) => `'${s.name}'`)
    .join(", ");

  return tool({
    description: [
      "Load a skill to get specialized instructions for a task.",
      "",
      "<available_skills>",
      listing,
      "</available_skills>",
    ].join("\n"),
    inputSchema: z.object({
      name: z.string().describe(`The skill name to load (e.g., ${examples})`),
    }),
    execute: async ({ name }: { name: string }) => {
      const skill = byName.get(name);
      if (!skill) {
        const available = skills.map((s) => s.name).join(", ");
        throw new Error(`Skill "${name}" not found. Available skills: ${available}`);
      }

      const dir = path.dirname(skill.location);
      const files = await scanSkillFiles(dir);

      const parts = [
        `<skill_content name="${skill.name}">`,
        `# Skill: ${skill.name}`,
        "",
        skill.content.trim(),
        "",
        `Base directory for this skill: ${dir}`,
        "Relative paths in this skill are relative to this base directory.",
      ];

      if (files.length > 0) {
        parts.push("", "<skill_files>");
        for (const f of files) {
          parts.push(`<file>${f}</file>`);
        }
        parts.push("</skill_files>");
      }

      parts.push("</skill_content>");

      return parts.join("\n");
    },
  });
}
