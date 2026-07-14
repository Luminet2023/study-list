import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const EDITOR_URL = new URL("../src/components/MarkdownEditorDialog.vue", import.meta.url);

test("journal editor remains a plain text surface with a cloud draft action", async () => {
  const source = await readFile(EDITOR_URL, "utf8");

  assert.match(source, /aria-label="日记内容"/u);
  assert.match(source, /cloud-draft-button/u);
  assert.match(source, /mdi-cloud-(?:upload|check)-outline/u);
  assert.doesNotMatch(source, /MarkdownContent|markdown-toolbar|mdi-format-|value="preview"/u);
});
