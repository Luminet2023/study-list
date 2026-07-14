import assert from "node:assert/strict";
import test from "node:test";

import { useCampaignStore } from "../src/composables/useCampaignStore.js";
import { CAMPAIGN_START, createDefaultDay } from "../src/domain/campaign.js";

test("state replacement keeps the currently selected UI date", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  const store = useCampaignStore();
  console.warn = originalWarn;

  store.setSelectedDate("2026-07-30");
  const incoming = JSON.parse(JSON.stringify(store.mutableState));
  incoming.preferences.selectedDate = "2026-07-27";
  incoming.days["2026-07-30"].journal = "事务返回的新内容";

  await store.replaceFromSync(incoming);

  assert.equal(store.mutableState.preferences.selectedDate, "2026-07-30");
  assert.equal(store.mutableState.days["2026-07-30"].journal, "事务返回的新内容");
});

test("legacy page transition preferences are discarded", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  const store = useCampaignStore();
  console.warn = originalWarn;

  const incoming = JSON.parse(JSON.stringify(store.mutableState));
  incoming.preferences.dayPageTransition = "classic";

  await store.replaceFromSync(incoming);

  assert.equal(Object.hasOwn(store.mutableState.preferences, "dayPageTransition"), false);
  assert.equal(Object.hasOwn(
    store.createCleanSyncState().preferences,
    "dayPageTransition",
  ), false);
});

test("minimal mode relaxes journal and goal gates without weakening normal mode", () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  const store = useCampaignStore();
  console.warn = originalWarn;

  store.setMinimalMode(false);
  store.mutableState.days[CAMPAIGN_START] = createDefaultDay(CAMPAIGN_START);

  assert.equal(store.lockGoals(CAMPAIGN_START), false);
  assert.equal(store.updateJournal(CAMPAIGN_START, "普通模式不可写"), false);
  assert.equal(store.updateJournalDraft(CAMPAIGN_START, "普通模式草稿"), false);

  store.setMinimalMode(true);
  assert.equal(store.updateJournal(CAMPAIGN_START, "极简模式日记"), true);
  assert.equal(store.updateJournalDraft(CAMPAIGN_START, "极简模式草稿"), true);
  assert.equal(store.lockGoals(CAMPAIGN_START), true);
  assert.equal(store.cycleStatus(CAMPAIGN_START, 1), true);
  assert.equal(store.mutableState.days[CAMPAIGN_START].goalsLocked, true);

  store.setMinimalMode(false);
  assert.equal(store.mutableState.days[CAMPAIGN_START].goalsLocked, false);
  assert.equal(store.mutableState.days[CAMPAIGN_START].goalsLockedAt, null);
});

test("minimal mode remains local when a synchronized snapshot replaces state", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  const store = useCampaignStore();
  console.warn = originalWarn;

  store.setMinimalMode(true);
  const incoming = JSON.parse(JSON.stringify(store.mutableState));
  incoming.preferences.minimalMode = false;

  await store.replaceFromSync(incoming);

  assert.equal(store.mutableState.preferences.minimalMode, true);
  assert.equal(store.createCleanSyncState().preferences.minimalMode, true);
  store.setMinimalMode(false);
});
