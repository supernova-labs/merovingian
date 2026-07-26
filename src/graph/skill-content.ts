import { parse as parseYaml } from "yaml";
import { z } from "zod";

export interface ParsedSkill {
  name: string;
  description: string;
  instructions: string;
  lintWarnings: string[];
}

const SkillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
}).passthrough();

function legacyField(frontmatter: string, field: string): string | undefined {
  const lines = frontmatter.split(/\r?\n/);
  const index = lines.findIndex((line) => new RegExp(`^${field}\\s*:`).test(line));
  if (index < 0) return undefined;
  const rawValue = lines[index]!.replace(new RegExp(`^${field}\\s*:\\s*`), "").trim();
  if (rawValue === ">" || rawValue === "|") {
    const continuation: string[] = [];
    for (const line of lines.slice(index + 1)) {
      if (!/^\s+/.test(line)) break;
      continuation.push(line.trim());
    }
    return rawValue === ">" ? continuation.join(" ") : continuation.join("\n");
  }
  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    return rawValue.slice(1, -1);
  }
  return rawValue;
}

/** Read the Agent Skills semantic fields permissively. Syntax conformance is a
 * lint concern: old tenants may contain recoverable YAML-like frontmatter that
 * Claude accepted before Merovingian parsed these files. */
export function parseSkillMarkdown(expectedName: string, raw: string): ParsedSkill {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`library skill "${expectedName}": SKILL.md requires YAML frontmatter with name and description`);
  }
  let metadata: { name: string; description: string };
  const lintWarnings: string[] = [];
  try {
    metadata = SkillFrontmatterSchema.parse(parseYaml(match[1]!));
  } catch {
    const name = legacyField(match[1]!, "name");
    const description = legacyField(match[1]!, "description");
    if (!name || !description) {
      throw new Error(`library skill "${expectedName}": SKILL.md has no readable name/description`);
    }
    metadata = { name, description };
    lintWarnings.push(
      "frontmatter is readable but not strict YAML; quote scalar values containing ':'",
    );
  }
  if (metadata.name !== expectedName) {
    throw new Error(`library skill "${expectedName}": SKILL.md name is "${metadata.name}"`);
  }
  return {
    name: metadata.name,
    description: metadata.description,
    instructions: match[2]!,
    lintWarnings,
  };
}
