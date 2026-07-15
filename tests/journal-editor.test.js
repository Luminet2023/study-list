import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const EDITOR_URL = new URL("../src/components/MarkdownEditorDialog.vue", import.meta.url);
const APP_URL = new URL("../src/App.vue", import.meta.url);
const WORKDAY_URL = new URL("../src/components/WorkdayView.vue", import.meta.url);

test("journal editor restores Markdown tools in normal mode and remains plain text in minimal mode", async () => {
  const [source, app, workday] = await Promise.all([
    readFile(EDITOR_URL, "utf8"),
    readFile(APP_URL, "utf8"),
    readFile(WORKDAY_URL, "utf8"),
  ]);

  assert.match(source, /import MarkdownContent from "\.\/MarkdownContent\.vue"/u);
  assert.match(source, /v-if="!minimalMode" class="editor-mode-row"/u);
  assert.match(source, /v-if="!minimalMode"\s+class="markdown-toolbar"/u);
  assert.match(source, /v-show="minimalMode \|\| mode === 'edit'"/u);
  assert.match(source, /v-if="!minimalMode && mode === 'preview'"/u);
  assert.match(source, /aria-label="Markdown 预览"/u);
  assert.match(source, /if \(props\.minimalMode\) return/u);
  assert.match(source, /cloud-draft-button/u);
  assert.match(source, /mdi-cloud-(?:upload|check)-outline/u);
  assert.match(app, /内容支持 Markdown，并自动保存在本地/u);
  assert.match(workday, /minimalMode \? '打开日记编辑器' : '打开 Markdown 日记编辑器'/u);
  assert.match(workday, /用 Markdown 写下今天的日结或日记/u);
});
