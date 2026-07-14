import assert from "node:assert/strict";
import test from "node:test";

import { useCampaignStore } from "../src/composables/useCampaignStore.js";

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
