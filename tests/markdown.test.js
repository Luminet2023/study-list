import assert from "node:assert/strict";
import test from "node:test";

import { countMarkdownCharacters, extractMarkdownText, renderMarkdown } from "../src/lib/markdown.js";

test("Markdown renders headings, lists and tables", () => {
  const html = renderMarkdown("## 今日\n\n- 完成复习\n\n| 项目 | 状态 |\n| --- | --- |\n| 数学 | 完成 |");

  assert.match(html, /<h2>今日<\/h2>/);
  assert.match(html, /<li>完成复习<\/li>/);
  assert.match(html, /<table>/);
});

test("Markdown escapes raw HTML", () => {
  const html = renderMarkdown('<script>alert("xss")</script>');

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("Markdown links open safely in a new tab", () => {
  const html = renderMarkdown("[资料](https://example.com)");

  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test("Markdown character count excludes formatting syntax and link destinations", () => {
  const source = "## 今日\n\n- **完成** [数学复习](https://example.com/math)\n- *整理* `错题`";

  assert.equal(extractMarkdownText(source).replace(/\s/gu, ""), "今日完成数学复习整理错题");
  assert.equal(countMarkdownCharacters(source), 12);
});

test("Markdown character count keeps meaningful code and image alternative text", () => {
  const source = "![**进度图**](progress.png)\n\n```js\nconst done = true;\n```\n\n---";

  assert.equal(countMarkdownCharacters(source), 18);
});
