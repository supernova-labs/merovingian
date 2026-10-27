import { expect, test } from "bun:test";
import { journalMarkdown } from "../src/journal/markdown.ts";

test("journal Markdown renders headings, emphasis, lists, code, tables and safe links", () => {
  const html = journalMarkdown("# Update\n\n**Done** and *next*.\n\n- First\n- Second\n\n```ts\nconst x = '<tag>';\n```\n\n| Task | State |\n| --- | --- |\n| Work | Done |\n\n[Evidence](https://example.com/pr/1)");
  for (const tag of ["<h1>", "<strong>", "<em>", "<ul>", "<pre>", "<table>"]) expect(html).toContain(tag);
  expect(html).toContain('href="https://example.com/pr/1"');
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).not.toContain("<tag>");
});

test("journal Markdown removes active content, remote images, unsafe schemes and DOM attributes", () => {
  const html = journalMarkdown('<script>alert(1)</script><img src="https://example.com/track" onerror="alert(1)"><svg onload="alert(1)"></svg><iframe src="https://example.com"></iframe><p id="journal-detail" style="color:red" onclick="alert(1)">Text</p>\n\n[bad](javascript:alert%281%29) [relative](/journals) [protocol](//example.com)');
  for (const forbidden of ["<script", "<img", "<svg", "<iframe", "onerror", "onclick", "javascript:", 'href="/', "style=", "id="]) expect(html).not.toContain(forbidden);
  expect(html).toContain("Text");
});
