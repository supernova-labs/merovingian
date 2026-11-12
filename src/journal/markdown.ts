import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

/** Markdown is untrusted content, including raw HTML. Never load remote images. */
export function journalMarkdown(text: string): string {
  return sanitizeHtml(marked.parse(text, { async: false, gfm: true }), {
    allowedTags: ["p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "del", "blockquote", "ul", "ol", "li", "pre", "code", "a", "table", "thead", "tbody", "tr", "th", "td", "details", "summary"],
    allowedAttributes: { a: ["href", "target", "rel"], ol: ["start"] },
    allowedSchemes: ["http", "https", "mailto"], allowProtocolRelative: false,
    transformTags: { a: (_tag, attrs) => {
      const attribs: Record<string, string> = /^(https?:\/\/|mailto:)/i.test(attrs.href ?? "")
        ? { href: attrs.href!, target: "_blank", rel: "noopener noreferrer" } : {};
      return { tagName: "a", attribs };
    } },
  });
}
