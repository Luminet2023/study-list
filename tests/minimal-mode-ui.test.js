import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("minimal mode exposes a confirmed sidebar entry and settings exit", async () => {
  const [app, settings] = await Promise.all([
    readSource("../src/App.vue"),
    readSource("../src/components/SettingsView.vue"),
  ]);

  assert.match(app, /v-if="!minimalMode"[^>]+title="极简模式"[^>]+@click="requestMinimalMode"/u);
  assert.match(app, /<v-dialog v-model="minimalModeDialog"/u);
  assert.match(app, /进入极简模式/u);
  assert.match(settings, /aria-label="关闭极简模式"/u);
  assert.match(settings, /emit\("disable-minimal-mode"\)/u);
});

test("minimal mode hides statistics and cloud surfaces without gating sync startup", async () => {
  const [app, dayPage, editor] = await Promise.all([
    readSource("../src/App.vue"),
    readSource("../src/components/DayPage.vue"),
    readSource("../src/components/MarkdownEditorDialog.vue"),
  ]);

  assert.match(app, /v-if="!minimalMode"[^>]+title="本周统计"/u);
  assert.match(app, /v-if="!minimalMode"[^>]+title="总统计"/u);
  assert.match(app, /v-if="!mdAndUp && !minimalMode"/u);
  assert.match(app, /if \(user\) await startAuthenticatedSync\(user\)/u);
  assert.match(dayPage, /page\.dayType !== 'sunday' && !minimalMode/u);
  assert.match(editor, /<v-tooltip\s+v-if="!minimalMode"/u);
});

test("minimal mode hides the drawer brand, divider, and logged-out login action", async () => {
  const app = await readSource("../src/App.vue");

  assert.match(app, /<v-list-item v-if="!minimalMode" class="drawer-brand py-5"/u);
  assert.match(app, /<v-divider v-if="!minimalMode" \/>/u);
  assert.match(app, /<div v-else-if="!minimalMode" class="linuxdo-login-wrap">/u);
});

test("minimal mode removes the journal status chip", async () => {
  const workday = await readSource("../src/components/WorkdayView.vue");

  assert.match(workday, /<v-chip\s+v-if="!minimalMode"/u);
  assert.doesNotMatch(workday, /极简模式，可随时书写/u);
});

test("minimal mode hides the header seal and adjacent day buttons", async () => {
  const [app, dayPage, header] = await Promise.all([
    readSource("../src/App.vue"),
    readSource("../src/components/DayPage.vue"),
    readSource("../src/components/PoeticHeader.vue"),
  ]);

  assert.match(app, /<AdjacentDayEar\s+v-if="!minimalMode"\s+side="left"/u);
  assert.match(app, /<AdjacentDayEar\s+v-if="!minimalMode"\s+side="right"/u);
  assert.equal((app.match(/<AdjacentDayEar/gu) ?? []).length, 2);
  assert.match(app, /<DayPage\s+v-memo="\[[\s\S]+?minimalMode,/u);
  assert.match(dayPage, /<PoeticHeader[\s\S]+?:minimal-mode="minimalMode"/u);
  assert.match(header, /<v-img\s+v-if="!minimalMode"\s+class="seal-mark"/u);
  assert.equal((header.match(/seal-mark\.png/gu) ?? []).length, 1);
});

test("minimal mode removes the goal lock gate while keeping tasks editable", async () => {
  const [store, workday] = await Promise.all([
    readSource("../src/composables/useCampaignStore.js"),
    readSource("../src/components/WorkdayView.vue"),
  ]);

  assert.match(store, /minimalMode: true,[\s\S]+?minimalModeOptOut: false/u);
  assert.match(store, /const minimalMode = !minimalModeOptOut/u);
  assert.match(workday, /<v-fade-transition v-if="!minimalMode" mode="out-in">/u);
  assert.match(workday, /:readonly="goalsLocked && !minimalMode"/u);
  assert.match(workday, /:disabled="\(!minimalMode && !goalsLocked\)/u);
});

test("minimal mode hides the favorites copy hint only through its prop", async () => {
  const [app, favorites] = await Promise.all([
    readSource("../src/App.vue"),
    readSource("../src/components/FavoritesView.vue"),
  ]);

  assert.match(app, /<FavoritesView[\s\S]+?:minimal-mode="minimalMode"/u);
  assert.match(favorites, /<p v-if="!minimalMode"[^>]*>[\s\S]*?轻触复制，让它陪你去往别处。/u);
});

test("minimal mode hides the month selected-day detail card", async () => {
  const [app, month] = await Promise.all([
    readSource("../src/App.vue"),
    readSource("../src/components/MonthOverview.vue"),
  ]);

  assert.match(app, /<MonthOverview[\s\S]+?:minimal-mode="minimalMode"/u);
  assert.match(month, /v-if="selectedDay && !minimalMode"/u);
  assert.match(month, /<v-chip v-if="!minimalMode"[^>]*>[\s\S]*?\{\{ monthRate \}\}%/u);
});
