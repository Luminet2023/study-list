import {
  computed,
  onBeforeUnmount,
  reactive,
  readonly,
  ref,
  toRaw,
  watch,
} from "vue";

import {
  CAMPAIGN_END,
  CAMPAIGN_START,
  ITEM_STATUS,
  appendSaturdayItem,
  clampCampaignDate,
  createDefaultState,
  cycleItemStatus,
  getEffectiveItemState,
  getItemText,
  isCountedPlanItem,
  removeSaturdayItem,
  updateItemInput,
} from "../domain/campaign.js";
import {
  canDrawDaily,
  drawRaffle,
  getAwardPreparation,
  getRafflePreparation,
  recordRaffleDraw,
} from "../domain/raffle.js";
import {
  createCampaignChannel,
  loadCampaignState,
  requestPersistentStorage,
  saveCampaignState,
  transactCampaignState,
} from "../persistence/indexedDb.js";

function shanghaiDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function defaultState() {
  const base = createDefaultState();
  return {
    ...base,
    schemaVersion: 1,
    revision: 0,
    lastUpdatedAt: null,
    quoteLikes: {},
    preferences: {
      selectedDate: clampCampaignDate(shanghaiDateKey()),
    },
    raffle: {
      ...base.raffle,
      paperClaims: [],
    },
  };
}

function mergeDay(baseDay, storedDay) {
  if (!storedDay || typeof storedDay !== "object") return baseDay;
  const storedItems = Array.isArray(storedDay.items) ? storedDay.items : [];
  const items = baseDay.items.map((baseItem) => {
    const storedItem = storedItems.find((item) => item.slot === baseItem.slot);
    return storedItem ? { ...baseItem, ...storedItem } : baseItem;
  });
  for (const storedItem of storedItems) {
    if (!items.some((item) => item.slot === storedItem.slot)) items.push(storedItem);
  }
  return {
    ...baseDay,
    ...storedDay,
    items: items.sort((left, right) => left.slot - right.slot),
    blessing: { ...baseDay.blessing, ...(storedDay.blessing ?? {}) },
  };
}

function normalizeState(input) {
  const base = defaultState();
  const incoming = input && typeof input === "object" ? input : {};
  const days = Object.fromEntries(
    Object.entries(base.days).map(([date, day]) => [
      date,
      mergeDay(day, incoming.days?.[date]),
    ]),
  );
  return {
    ...base,
    ...incoming,
    schemaVersion: 1,
    revision: Number.isSafeInteger(incoming.revision) ? incoming.revision : 0,
    lastUpdatedAt: incoming.lastUpdatedAt ?? null,
    days,
    quoteLikes: incoming.quoteLikes ?? {},
    preferences: { ...base.preferences, ...(incoming.preferences ?? {}) },
    raffle: {
      ...base.raffle,
      ...(incoming.raffle ?? {}),
      draws: [...(incoming.raffle?.draws ?? [])],
      awards: [...(incoming.raffle?.awards ?? [])],
      paperClaims: [...(incoming.raffle?.paperClaims ?? [])],
    },
  };
}

const state = reactive(defaultState());
const ready = ref(false);
const saving = ref(false);
const saveError = ref(null);
const today = ref(shanghaiDateKey());
let suppressPersistence = false;
let dirty = false;
let flushScheduled = false;
let flushPromise = Promise.resolve();
let channel;
let initialized = false;
let todayTimer;

function replaceState(nextState) {
  suppressPersistence = true;
  const normalized = normalizeState(nextState);
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, normalized);
  suppressPersistence = false;
}

async function flushPersistence() {
  if (!dirty || suppressPersistence || !ready.value) return flushPromise;
  dirty = false;
  saving.value = true;
  const snapshot = JSON.parse(JSON.stringify(toRaw(state)));
  flushPromise = saveCampaignState(snapshot)
    .then((saved) => {
      suppressPersistence = true;
      state.revision = saved.revision;
      state.lastUpdatedAt = saved.lastUpdatedAt;
      suppressPersistence = false;
      saveError.value = null;
    })
    .catch((error) => {
      dirty = true;
      saveError.value = error;
      throw error;
    })
    .finally(() => {
      saving.value = false;
      if (dirty) schedulePersistence();
    });
  return flushPromise;
}

function schedulePersistence() {
  if (suppressPersistence || !ready.value) return;
  dirty = true;
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    void flushPersistence().catch(() => {});
  });
}

watch(state, schedulePersistence, { deep: true, flush: "sync" });

async function reloadFromStorage() {
  const loaded = await loadCampaignState(defaultState);
  replaceState(loaded);
}

export async function initializeCampaignStore() {
  if (initialized) return;
  initialized = true;
  todayTimer = globalThis.setInterval?.(() => {
    today.value = shanghaiDateKey();
  }, 30_000);
  try {
    await reloadFromStorage();
    await requestPersistentStorage().catch(() => false);
    channel = createCampaignChannel(async (revision) => {
      if (revision <= (state.revision ?? 0) || saving.value) return;
      try {
        await reloadFromStorage();
      } catch (error) {
        saveError.value = error;
      }
    });
  } catch (error) {
    saveError.value = error;
  } finally {
    ready.value = true;
  }
}

function getDay(date) {
  return state.days[date];
}

function setSelectedDate(date) {
  state.preferences.selectedDate = clampCampaignDate(date);
}

function cycleStatus(date, slot) {
  const day = getDay(date);
  const item = day?.items?.find((candidate) => candidate.slot === slot);
  if (!day || !item) return false;
  if (getEffectiveItemState(item, day, state).exempt) return false;
  state.days[date] = cycleItemStatus(day, slot);
  return true;
}

function updateItem(date, slot, value) {
  const day = getDay(date);
  if (!day) return;
  const existing = day.items.find((item) => item.slot === slot);
  const wasBlank = slot === 6 && !getItemText(existing).trim();
  let next = updateItemInput(day, slot, value);
  if (wasBlank && slot === 6 && String(value).trim()) {
    next = {
      ...next,
      items: next.items.map((item) =>
        item.slot === 6 ? { ...item, status: ITEM_STATUS.PENDING } : item,
      ),
    };
  }
  state.days[date] = next;
}

function updateJournal(date, value) {
  const day = getDay(date);
  if (!day) return;
  state.days[date] = { ...day, journal: String(value ?? "") };
}

function updateSaturdayItem(date, id, value) {
  const day = getDay(date);
  const item = day?.items?.find((candidate) => candidate.id === id);
  if (item) state.days[date] = updateItemInput(day, item.slot, value);
}

function addSaturdayItem(date, value) {
  const day = getDay(date);
  if (!day) return;
  const blank = day.items.find((item) => !getItemText(item).trim());
  state.days[date] = blank
    ? updateItemInput(day, blank.slot, value)
    : appendSaturdayItem(day, value);
}

function addSaturdayItems(date, values) {
  for (const value of values) addSaturdayItem(date, value);
}

function removeSaturday(date, id) {
  const day = getDay(date);
  const item = day?.items?.find((candidate) => candidate.id === id);
  if (item) state.days[date] = removeSaturdayItem(day, item.slot);
}

function toggleQuoteLike(quote) {
  if (!quote) return;
  if (state.quoteLikes[quote.id]) {
    delete state.quoteLikes[quote.id];
    return;
  }
  state.quoteLikes[quote.id] = {
    quoteId: quote.id,
    date: quote.date,
    textSnapshot: quote.text,
    likedAt: new Date().toISOString(),
  };
}

function unlikeQuote(quoteId) {
  delete state.quoteLikes[quoteId];
}

const favorites = computed(() =>
  Object.values(state.quoteLikes).sort(
    (left, right) => left.likedAt.localeCompare(right.likedAt) || left.date.localeCompare(right.date),
  ),
);

async function commitTransaction(mutator) {
  await flushPersistence();
  const saved = await transactCampaignState(defaultState, mutator);
  replaceState(saved);
  return saved;
}

async function claimPaper(date) {
  return commitTransaction((draft) => {
    draft.raffle ??= {};
    draft.raffle.paperClaims ??= [];
    if (draft.raffle.paperClaims.some((claim) => claim.date === date)) {
      throw new Error("今天已经登记过试卷");
    }
    if (draft.raffle.paperClaims.length >= 3) {
      throw new Error("整个假期最多登记三次试卷");
    }
    draft.raffle.paperClaims.push({
      id: `${date}:paper:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
      date,
      confirmedAt: new Date().toISOString(),
      consumedByDrawId: null,
    });
  });
}

function paperClaimForDate(date) {
  return state.raffle?.paperClaims?.find(
    (claim) => claim.date === date && !claim.consumedByDrawId,
  );
}

async function performDraw(date, mode, redistributeSlot6 = false) {
  await flushPersistence();
  const result = drawRaffle(date, { redistributeSlot6 });
  const drawId = `${date}:${mode}:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
  const drawRecord = {
    id: drawId,
    drawDate: date,
    prizeId: result.prize.id,
    label: result.prize.label,
    mode: mode === "paper" ? "paper-bonus" : "daily",
    createdAt: new Date().toISOString(),
    poolSnapshot: result.pool.entries.map(({ id, label, weight }) => ({ id, label, weight })),
  };

  const saved = await transactCampaignState(defaultState, (draft) => {
    if (mode === "paper") {
      const claim = draft.raffle?.paperClaims?.find(
        (candidate) => candidate.date === date && !candidate.consumedByDrawId,
      );
      if (!claim) throw new Error("今天没有可用的试卷额外机会");
      claim.consumedByDrawId = drawId;
    }
    return recordRaffleDraw(draft, drawRecord);
  });
  replaceState(saved);
  return {
    ...result,
    drawRecord,
    awardPreparation: getAwardPreparation(saved, date, result.prize.id),
  };
}

function rafflePreparation(date) {
  return getRafflePreparation(state, date);
}

function isDailyDrawAvailable(date) {
  return canDrawDaily(state, date);
}

function isPaperDrawAvailable(date) {
  return Boolean(paperClaimForDate(date));
}

function workdayViewItems(date) {
  const day = getDay(date);
  return (day?.items ?? []).map((item) => {
    const effective = getEffectiveItemState(item, day, state);
    return {
      ...item,
      editableValue: item.input,
      isExempt: effective.exempt,
      status: effective.exempt ? ITEM_STATUS.COMPLETED : item.status,
      isPlanned: isCountedPlanItem(day, item),
    };
  });
}

function saturdayViewItems(date) {
  const day = getDay(date);
  return (day?.items ?? [])
    .filter((item) => getItemText(item).trim())
    .map((item) => {
      const effective = getEffectiveItemState(item, day, state);
      return {
        ...item,
        text: getItemText(item),
        isExempt: effective.exempt,
        status: effective.exempt ? ITEM_STATUS.COMPLETED : item.status,
      };
    });
}

export function useCampaignStore() {
  onBeforeUnmount(() => {
    channel?.close?.();
    if (todayTimer) globalThis.clearInterval?.(todayTimer);
  });
  return {
    state: readonly(state),
    mutableState: state,
    ready: readonly(ready),
    saving: readonly(saving),
    saveError: readonly(saveError),
    favorites,
    today: readonly(today),
    setSelectedDate,
    cycleStatus,
    updateItem,
    updateJournal,
    updateSaturdayItem,
    addSaturdayItem,
    addSaturdayItems,
    removeSaturday,
    toggleQuoteLike,
    unlikeQuote,
    claimPaper,
    paperClaimForDate,
    performDraw,
    rafflePreparation,
    isDailyDrawAvailable,
    isPaperDrawAvailable,
    workdayViewItems,
    saturdayViewItems,
    flushPersistence,
  };
}

export { CAMPAIGN_START, CAMPAIGN_END };
