import { parse as parseYaml } from "yaml";
import { z } from "zod";

export interface ParsedAgentMarkdown {
  content: string;
  description?: string;
  legacyFrontmatter: boolean;
}

/** Legacy library agents carried Claude frontmatter. New agents keep only their
 * instructions in Markdown and declare neutral metadata in graph.yaml. */
export function parseAgentMarkdown(raw: string): ParsedAgentMarkdown {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { content: raw, legacyFrontmatter: false };
  const schema = z.object({
    name: z.string().optional(),
    description: z.string().min(1).optional(),
  }).passthrough();
  let description: string | undefined;
  try {
    description = schema.parse(parseYaml(match[1]!)).description;
  } catch {
    // Claude-era agent files were historically opaque to Merovingian. Some real
    // tenants therefore carry useful but non-strict YAML scalars such as
    // `description: Routes work: sales and delivery`. Keep this compatibility
    // bridge lenient while graph.yaml's new neutral metadata remains strict.
    const lines = match[1]!.split(/\r?\n/);
    const index = lines.findIndex((line) => /^description\s*:/.test(line));
    if (index >= 0) {
      const rawValue = lines[index]!.replace(/^description\s*:\s*/, "").trim();
      if (rawValue === ">" || rawValue === "|") {
        const continuation: string[] = [];
        for (const line of lines.slice(index + 1)) {
          if (!/^\s+/.test(line)) break;
          continuation.push(line.trim());
        }
        description = rawValue === ">" ? continuation.join(" ") : continuation.join("\n");
      } else if (
        (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'"))
      ) {
        description = rawValue.slice(1, -1);
      } else {
        description = rawValue;
      }
    }
  }
  return {
    // The conventional blank line after legacy frontmatter is formatting, not
    // part of the agent prompt. Normalize it so native emitters receive exactly
    // the same instruction bytes.
    content: match[2]!.replace(/^\r?\n/, ""),
    ...(description ? { description } : {}),
    legacyFrontmatter: true,
  };
}
