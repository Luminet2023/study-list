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
  DAY_TYPE,
  ITEM_STATUS,
  areWorkdayGoalInputsComplete,
  appendSaturdayItem,
  clampCampaignDate,
  createDefaultState,
  cycleItemStatus,
  getEffectiveItemState,
  getItemText,
  isCountedPlanItem,
  isWorkdayJournalUnlocked,
  lockWorkdayGoals,
  removeSaturdayItem,
  unlockWorkdayGoals,
  updateItemInput,
} from "../domain/campaign.js";
import {
  canDrawDaily,
  drawRaffle,
  getAwardPreparation,
  getRaffleProbabilitySummary,
  getRafflePreparation,
  getUtc8DateKey,
  millisecondsUntilUtc8Midnight,
  recordRaffleDraw,
  redeemRaffleAward,
} from "../domain/raffle.js";
import {
  createCampaignChannel,
  loadCampaignState,
  requestPersistentStorage,
  saveCampaignState,
  transactCampaignState,
} from "../persistence/indexedDb.js";
import { createBaselineId, isBaselineId } from "../sync/baseline.js";
import { isPageActive } from "../lib/pageActivity.js";
import { normalizeHitokotoCategories, normalizeHitokotoPayload } from "../services/hitokoto.js";

const QUOTE_SOURCES = new Set(["native", "hitokoto"]);

function normalizeQuoteSource(value) {
  return QUOTE_SOURCES.has(value) ? value : "native";
}

function shanghaiDateKey(now = new Date()) {
  return getUtc8DateKey(now);
}

function defaultState(baselineId = createBaselineId()) {
  const base = createDefaultState();
  return {
    ...base,
    baselineId,
    schemaVersion: 1,
    revision: 0,
    lastUpdatedAt: null,
    quoteLikes: {},
    preferences: {
      selectedDate: clampCampaignDate(shanghaiDateKey()),
      fontFamily: "lxgw-wenka",
      quoteSource: "native",
      hitokotoCategories: [],
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
  const merged = {
    ...baseDay,
    ...storedDay,
    items: items.sort((left, right) => left.slot - right.slot),
    blessing: { ...baseDay.blessing, ...(storedDay.blessing ?? {}) },
  };
  if (
    merged.type === DAY_TYPE.WORKDAY &&
    merged.goalsLocked &&
    !areWorkdayGoalInputsComplete(merged)
  ) {
    return { ...merged, goalsLocked: false, goalsLockedAt: null };
  }
  return merged;
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
    baselineId: isBaselineId(incoming.baselineId) ? incoming.baselineId : base.baselineId,
    schemaVersion: 1,
    revision: Number.isSafeInteger(incoming.revision) ? incoming.revision : 0,
    lastUpdatedAt: incoming.lastUpdatedAt ?? null,
    days,
    quoteLikes: incoming.quoteLikes ?? {},
    preferences: {
      ...base.preferences,
      ...(incoming.preferences ?? {}),
      quoteSource: normalizeQuoteSource(incoming.preferences?.quoteSource),
      hitokotoCategories: normalizeHitokotoCategories(incoming.preferences?.hitokotoCategories),
    },
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
const pendingSave = ref(false);
const saveError = ref(null);
const today = ref(shanghaiDateKey());
const PERSISTENCE_BATCH_MS = 1_000;
let suppressPersistence = false;
let dirty = false;
let flushTimer;
let flushPromise = Promise.resolve();
let channel;
let initialized = false;
let todayTimer;
const persistenceListeners = new Set();
const changeListeners = new Set();

function notifyPersistenceListeners(saved) {
  for (const listener of persistenceListeners) {
    queueMicrotask(() => listener(saved));
  }
}

function notifyChangeListeners() {
  for (const listener of changeListeners) listener();
}

function replaceState(nextState) {
  const selectedDate = state.preferences?.selectedDate;
  suppressPersistence = true;
  const normalized = normalizeState(nextState);
  if (selectedDate) normalized.preferences.selectedDate = clampCampaignDate(selectedDate);
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, normalized);
  suppressPersistence = false;
  dirty = false;
  pendingSave.value = false;
}

async function flushPersistence() {
  clearScheduledFlush();
  if (!dirty || suppressPersistence || !ready.value) return flushPromise;
  if (!isPageActive()) {
    pendingSave.value = true;
    return flushPromise;
  }
  if (saving.value) {
    await flushPromise;
    return dirty ? flushPersistence() : flushPromise;
  }
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
      pendingSave.value = dirty;
      notifyPersistenceListeners(saved);
    })
    .catch((error) => {
      dirty = true;
      pendingSave.value = true;
      saveError.value = error;
      throw error;
    })
    .finally(() => {
      saving.value = false;
      if (dirty) schedulePersistence();
    });
  return flushPromise;
}

function clearScheduledFlush() {
  if (flushTimer === undefined) return;
  globalThis.clearTimeout?.(flushTimer);
  flushTimer = undefined;
}

function schedulePersistence() {
  if (suppressPersistence || !ready.value) return;
  notifyChangeListeners();
  dirty = true;
  pendingSave.value = true;
  if (!isPageActive()) {
    clearScheduledFlush();
    return;
  }
  if (flushTimer !== undefined || saving.value) return;
  flushTimer = globalThis.setTimeout?.(() => {
    flushTimer = undefined;
    void flushPersistence().catch(() => {});
  }, PERSISTENCE_BATCH_MS);
}

function pausePersistence() {
  clearScheduledFlush();
}

function onVisibilityChange() {
  if (!isPageActive()) return pausePersistence();
  resumePersistence();
}

function resumePersistence() {
  refreshTodayAndSchedule();
  if (dirty) schedulePersistence();
}

function clearTodayTimer() {
  if (todayTimer === undefined) return;
  globalThis.clearTimeout?.(todayTimer);
  todayTimer = undefined;
}

function refreshTodayAndSchedule() {
  clearTodayTimer();
  today.value = shanghaiDateKey();
  todayTimer = globalThis.setTimeout?.(() => {
    refreshTodayAndSchedule();
  }, millisecondsUntilUtc8Midnight());
}

watch(
  () => ({
    baselineId: state.baselineId,
    days: state.days,
    quoteLikes: state.quoteLikes,
    fontFamily: state.preferences?.fontFamily,
    quoteSource: state.preferences?.quoteSource,
    hitokotoCategories: state.preferences?.hitokotoCategories,
    raffle: state.raffle,
  }),
  schedulePersistence,
  { deep: true, flush: "sync" },
);

async function reloadFromStorage() {
  const loaded = await loadCampaignState(defaultState);
  const baselineWasMissing = !isBaselineId(loaded.baselineId);
  replaceState(loaded);
  return baselineWasMissing;
}

export async function initializeCampaignStore() {
  if (initialized) return;
  initialized = true;
  let baselineWasMissing = false;
  refreshTodayAndSchedule();
  try {
    baselineWasMissing = await reloadFromStorage();
    await requestPersistentStorage().catch(() => false);
    channel = createCampaignChannel(async (revision) => {
      if (revision <= (state.revision ?? 0)) return;
      try {
        if (dirty || saving.value) await flushPersistence();
        if (revision <= (state.revision ?? 0)) return;
        await reloadFromStorage();
      } catch (error) {
        saveError.value = error;
      }
    });
    globalThis.document?.addEventListener?.("visibilitychange", onVisibilityChange);
    globalThis.addEventListener?.("focus", resumePersistence);
    globalThis.addEventListener?.("blur", pausePersistence);
    globalThis.addEventListener?.("pagehide", pausePersistence);
  } catch (error) {
    saveError.value = error;
  } finally {
    ready.value = true;
    if (baselineWasMissing) {
      dirty = true;
      pendingSave.value = true;
      await flushPersistence().catch((error) => {
        saveError.value = error;
      });
    }
  }
}

async function replaceFromSync(nextState) {
  replaceState(nextState);
  dirty = true;
  pendingSave.value = true;
  return flushPersistence();
}

function createCleanSyncState(baselineId) {
  const clean = defaultState(baselineId);
  clean.preferences.selectedDate = state.preferences?.selectedDate ?? clean.preferences.selectedDate;
  return normalizeState(clean);
}

function replaceFromPersistedSync(nextState) {
  replaceState(nextState);
}

function subscribeToPersistence(listener) {
  if (typeof listener !== "function") throw new TypeError("listener must be a function");
  persistenceListeners.add(listener);
  return () => persistenceListeners.delete(listener);
}

function subscribeToChanges(listener) {
  if (typeof listener !== "function") throw new TypeError("listener must be a function");
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function getDay(date) {
  return state.days[date];
}

function setSelectedDate(date) {
  state.preferences.selectedDate = clampCampaignDate(date);
}

function setFontFamily(fontFamily) {
  const allowed = new Set(["system", "lxgw-wenka", "anthropic"]);
  state.preferences.fontFamily = allowed.has(fontFamily) ? fontFamily : "lxgw-wenka";
}

function setQuoteSource(source) {
  state.preferences.quoteSource = normalizeQuoteSource(source);
}

function setHitokotoCategories(categories) {
  state.preferences.hitokotoCategories = normalizeHitokotoCategories(categories);
}

function boundHitokotoUuids(excludeDate = null) {
  return new Set(
    Object.entries(state.days ?? {})
      .filter(([date]) => date !== excludeDate)
      .map(([, day]) => day?.blessing?.hitokoto?.uuid)
      .filter(Boolean),
  );
}

function cycleStatus(date, slot) {
  const day = getDay(date);
  const item = day?.items?.find((candidate) => candidate.slot === slot);
  if (!day || !item) return false;
  if (
    day.type === DAY_TYPE.WORKDAY &&
    (!day.goalsLocked || !areWorkdayGoalInputsComplete(day))
  ) {
    return false;
  }
  if (day.type === DAY_TYPE.WORKDAY && !isCountedPlanItem(day, item)) return false;
  if (getEffectiveItemState(item, day, state).exempt) return false;
  state.days[date] = cycleItemStatus(day, slot);
  return true;
}

function updateItem(date, slot, value) {
  const day = getDay(date);
  const lockIsValid =
    day?.type !== DAY_TYPE.WORKDAY ||
    (day.goalsLocked && areWorkdayGoalInputsComplete(day));
  if (
    !day ||
    (day.type === DAY_TYPE.WORKDAY && lockIsValid)
  ) {
    return false;
  }
  const editableDay =
    day.type === DAY_TYPE.WORKDAY && day.goalsLocked
      ? { ...day, goalsLocked: false, goalsLockedAt: null }
      : day;
  const existing = editableDay.items.find((item) => item.slot === slot);
  const wasBlank = slot === 6 && !getItemText(existing).trim();
  let next = updateItemInput(editableDay, slot, value);
  if (wasBlank && slot === 6 && String(value).trim()) {
    next = {
      ...next,
      items: next.items.map((item) =>
        item.slot === 6 ? { ...item, status: ITEM_STATUS.PENDING } : item,
      ),
    };
  }
  state.days[date] = next;
  return true;
}

function updateJournal(date, value) {
  const day = getDay(date);
  if (!day) return false;
  if (day.type === DAY_TYPE.WORKDAY && !isWorkdayJournalUnlocked(day, state)) {
    return false;
  }
  state.days[date] = { ...day, journal: String(value ?? "") };
  return true;
}

function lockGoals(date) {
  const day = getDay(date);
  if (!day || day.type !== DAY_TYPE.WORKDAY) return false;
  if (!areWorkdayGoalInputsComplete(day)) return false;
  state.days[date] = lockWorkdayGoals(day, new Date().toISOString());
  return true;
}

function unlockGoals(date) {
  const day = getDay(date);
  if (!day || day.type !== DAY_TYPE.WORKDAY || !day.goalsLocked) return false;
  state.days[date] = unlockWorkdayGoals(day);
  return true;
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
    source: quote.source ?? "native",
    uuid: quote.uuid ?? null,
    from: quote.from ?? null,
    fromWho: quote.fromWho ?? null,
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
  notifyPersistenceListeners(saved);
  notifyChangeListeners();
  return saved;
}

async function bindHitokoto(date, payload) {
  const hitokoto = normalizeHitokotoPayload(payload);
  return commitTransaction((draft) => {
    const day = draft.days?.[date];
    if (!day) throw new RangeError(`date is outside campaign: ${date}`);
    if (day.blessing?.hitokoto?.uuid) return;
    const duplicateDate = Object.entries(draft.days ?? {}).find(
      ([candidateDate, candidateDay]) =>
        candidateDate !== date && candidateDay?.blessing?.hitokoto?.uuid === hitokoto.uuid,
    )?.[0];
    if (duplicateDate) {
      const error = new Error(`一言已绑定到 ${duplicateDate}`);
      error.code = "DUPLICATE_HITOKOTO_UUID";
      throw error;
    }
    day.blessing = {
      ...(day.blessing ?? {}),
      hitokoto: {
        ...hitokoto,
        boundAt: new Date().toISOString(),
      },
    };
  });
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
  notifyPersistenceListeners(saved);
  notifyChangeListeners();
  return {
    ...result,
    drawRecord,
  };
}

async function redeemRaffleDraw(drawId) {
  const redeemedAt = new Date().toISOString();
  const saved = await commitTransaction((draft) =>
    redeemRaffleAward(draft, drawId, redeemedAt),
  );
  const draw = saved.raffle?.draws?.find((candidate) => candidate.id === drawId);
  const award = saved.raffle?.awards?.find(
    (candidate) => candidate?.drawId === drawId || candidate?.id === draw?.awardId,
  );
  if (!draw || !award) throw new Error("奖励记录不存在");
  return {
    draw,
    award,
    awardPreparation: getAwardPreparation(saved, draw.drawDate, draw.prizeId),
  };
}

function rafflePreparation(date) {
  return getRafflePreparation(state, date);
}

function raffleProbabilitySummary(date, options = {}) {
  return getRaffleProbabilitySummary(date, options);
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
    clearScheduledFlush();
    globalThis.document?.removeEventListener?.("visibilitychange", onVisibilityChange);
    globalThis.removeEventListener?.("focus", resumePersistence);
    globalThis.removeEventListener?.("blur", pausePersistence);
    globalThis.removeEventListener?.("pagehide", pausePersistence);
    channel?.close?.();
    clearTodayTimer();
  });
  return {
    state: readonly(state),
    mutableState: state,
    ready: readonly(ready),
    saving: readonly(saving),
    pendingSave: readonly(pendingSave),
    saveError: readonly(saveError),
    favorites,
    today: readonly(today),
    setSelectedDate,
    setFontFamily,
    setQuoteSource,
    setHitokotoCategories,
    boundHitokotoUuids,
    bindHitokoto,
    cycleStatus,
    updateItem,
    updateJournal,
    lockGoals,
    unlockGoals,
    updateSaturdayItem,
    addSaturdayItem,
    addSaturdayItems,
    removeSaturday,
    toggleQuoteLike,
    unlikeQuote,
    claimPaper,
    paperClaimForDate,
    performDraw,
    redeemRaffleDraw,
    rafflePreparation,
    raffleProbabilitySummary,
    isDailyDrawAvailable,
    isPaperDrawAvailable,
    workdayViewItems,
    saturdayViewItems,
    flushPersistence,
    replaceFromSync,
    createCleanSyncState,
    replaceFromPersistedSync,
    subscribeToPersistence,
    subscribeToChanges,
  };
}

export { CAMPAIGN_START, CAMPAIGN_END };
