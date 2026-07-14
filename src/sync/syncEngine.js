import { readonly, ref } from "vue";

import {
  loadCloudSyncState,
  replaceCampaignAndCloudSyncState,
  saveCloudSyncState,
} from "../persistence/indexedDb.js";
import {
  BASELINE_CHOICE,
  base64ToBytes,
  bytesToBase64,
  decodeResolveBaselineResponse,
  decodeJsonValue,
  decodeSyncResponse,
  encodeJsonValue,
  encodeResolveBaselineRequest,
  encodeSyncRequest,
} from "./protocol.js";
import { summarizeCampaignProgress } from "./baseline.js";
import {
  applyRecordValue,
  applyWireChanges,
  diffRecords,
  recordValuesEqual,
  recordsToSerializable,
  serializableToRecords,
  stateToRecords,
} from "./stateRecords.js";
import { isPageActive } from "../lib/pageActivity.js";

const syncing = ref(false);
const syncError = ref(null);
const lastSyncedAt = ref(null);
const conflictCount = ref(0);
const baselineConflict = ref(null);
const resolvingBaseline = ref(false);
const CLOUD_SYNC_INTERVAL_MS = 5_000;
const CLOUD_PULL_INTERVAL_MS = 10_000;
let store;
let syncState;
let activePromise;
let syncTimer;
let syncTimerDue = 0;
let syncPending = false;
let pullTimer;
let pullTimerDue = 0;
let pullPending = false;
let lastSyncStartedAt = 0;
let lastExchangeAt = 0;
let unsubscribeChanges;
let ownerId;
let observedSyncRecords;
let activeRequestController;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function newDeviceId() {
  return `device_${crypto.randomUUID().replaceAll("-", "")}`;
}

function defaultMeta() {
  return {
    deviceId: newDeviceId(),
    cursor: 0,
    clientSeq: 0,
    bootstrapDone: false,
    recordVersions: {},
    baseline: {},
    lastSyncAt: null,
    baselineId: null,
  };
}

function assertPageActive() {
  if (isPageActive()) return;
  const error = new Error("页面未聚焦，操作已暂停");
  error.code = "SYNC_PAUSED";
  throw error;
}

async function postProtobuf(path, protobuf) {
  assertPageActive();
  const controller = new AbortController();
  activeRequestController = controller;
  try {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ protobuf: bytesToBase64(protobuf) }),
      signal: controller.signal,
    });
    if (!isPageActive()) {
      const error = new Error("页面未聚焦，云同步已暂停");
      error.code = "SYNC_PAUSED";
      throw error;
    }
    if (response.status === 401) {
      const error = new Error("登录已失效");
      error.code = "AUTH_REQUIRED";
      throw error;
    }
    if (response.status === 429) {
      const error = new Error("云同步请求过于频繁");
      error.code = "RATE_LIMITED";
      error.retryAfterMs = Math.max(Number(response.headers.get("retry-after") ?? 10) * 1000, 1000);
      throw error;
    }
    if (!response.ok) throw new Error(`同步接口返回 ${response.status}`);
    const envelope = await response.json();
    if (path === "/api/v1/sync/exchange") lastExchangeAt = Date.now();
    return base64ToBytes(envelope.protobuf);
  } catch (error) {
    if (controller.signal.aborted) {
      const paused = new Error("页面未聚焦，云同步已暂停");
      paused.code = "SYNC_PAUSED";
      throw paused;
    }
    throw error;
  } finally {
    if (activeRequestController === controller) activeRequestController = undefined;
  }
}

function localProgressSummary() {
  return summarizeCampaignProgress(store.mutableState);
}

function setBaselineConflict(response) {
  const local = localProgressSummary();
  baselineConflict.value = {
    local,
    server: {
      baselineId: response.baselineId,
      version: response.serverVersion,
      updatedAtMs: response.serverUpdatedAtMs,
      updatedAt: response.serverUpdatedAtMs
        ? new Date(response.serverUpdatedAtMs).toISOString()
        : null,
      progressDay: response.serverProgressDay || "2026-07-13",
    },
  };
}

async function exchange(mutations, cursor) {
  const summary = localProgressSummary();
  const protobuf = encodeSyncRequest({
    deviceId: syncState.meta.deviceId,
    cursor,
    mutations: mutations.map((mutation) => ({
      ...mutation,
      valueJson: mutation.deleted ? new Uint8Array() : encodeJsonValue(mutation.value),
    })),
    pullLimit: 128,
    baselineId: store.mutableState.baselineId,
    localVersion: summary.version,
    localUpdatedAtMs: summary.updatedAtMs,
    localProgressDay: summary.progressDay,
  });
  const response = decodeSyncResponse(await postProtobuf("/api/v1/sync/exchange", protobuf));
  if (response.baselineMismatch) {
    setBaselineConflict(response);
    const error = new Error("本地与云端基线不一致");
    error.code = "BASELINE_MISMATCH";
    throw error;
  }
  syncState.meta.baselineId = response.baselineId;
  return response;
}

function updateRecordVersions(changes) {
  for (const change of changes) {
    syncState.meta.recordVersions[change.entityKey] = Math.max(
      syncState.meta.recordVersions[change.entityKey] ?? 0,
      change.cursor,
    );
  }
}

function applyChangesToBaseline(changes) {
  const baseline = serializableToRecords(syncState.meta.baseline);
  for (const change of [...changes].sort((left, right) => left.cursor - right.cursor)) {
    if (change.deleted) baseline.delete(change.entityKey);
    else baseline.set(change.entityKey, decodeJsonValue(change.valueJson));
  }
  syncState.meta.baseline = recordsToSerializable(baseline);
}

function reconcileOutbox() {
  const baseline = serializableToRecords(syncState.meta.baseline);
  const current = stateToRecords(store.mutableState);
  const differences = diffRecords(baseline, current);
  const prior = new Map(syncState.outbox.map((mutation) => [mutation.entityKey, mutation]));
  const next = [];
  for (const change of differences) {
    const existing = prior.get(change.entityKey);
    if (
      existing &&
      existing.deleted === change.deleted &&
      (change.deleted || recordValuesEqual(existing.value, change.value))
    ) {
      next.push(existing);
      continue;
    }
    syncState.meta.clientSeq += 1;
    next.push({
      opId: `op_${syncState.meta.deviceId}_${syncState.meta.clientSeq}_${crypto.randomUUID().replaceAll("-", "")}`,
      entityKey: change.entityKey,
      baseVersion: syncState.meta.recordVersions[change.entityKey] ?? 0,
      clientTimeMs: Date.now(),
      value: change.value,
      deleted: change.deleted,
      deviceId: syncState.meta.deviceId,
      clientSeq: syncState.meta.clientSeq,
    });
  }
  syncState.outbox = next;
}

async function bootstrapFromServer() {
  if (syncState.meta.bootstrapDone) return false;
  const initialState = clone(store.mutableState);
  const localRecords = stateToRecords(initialState);
  let cursor = 0;
  let received = false;
  syncState.meta.baseline = {};
  let response;
  do {
    response = await exchange([], cursor);
    if (response.resetRequired) cursor = 0;
    if (response.changes.length) {
      received = true;
      applyWireChanges(initialState, response.changes);
      applyChangesToBaseline(response.changes);
      updateRecordVersions(response.changes);
    }
    cursor = response.nextCursor;
  } while (response.hasMore);
  syncState.meta.cursor = cursor;
  syncState.meta.bootstrapDone = true;
  if (received && diffRecords(localRecords, stateToRecords(initialState)).length > 0) {
    await store.replaceFromSync(initialState);
    observedSyncRecords = stateToRecords(store.mutableState);
  }
  return true;
}

async function performSync({ allowEmptyPull = false } = {}) {
  if (!store || !isPageActive() || baselineConflict.value || globalThis.navigator?.onLine === false) return;
  syncing.value = true;
  let mergedConflictCount = 0;
  try {
    const bootstrappedNow = await bootstrapFromServer();
    reconcileOutbox();
    if (!syncState.outbox.length && (bootstrappedNow || !allowEmptyPull)) {
      if (bootstrappedNow) {
        syncState.meta.lastSyncAt = new Date().toISOString();
        lastSyncedAt.value = syncState.meta.lastSyncAt;
        assertPageActive();
        await saveCloudSyncState(ownerId, syncState.meta, syncState.outbox);
      }
      conflictCount.value = 0;
      syncError.value = null;
      return;
    }
    if (syncState.outbox.length) {
      assertPageActive();
      await saveCloudSyncState(ownerId, syncState.meta, syncState.outbox);
    }

    let response;
    do {
      const sentOutbox = syncState.outbox.slice(0, 180);
      const sentState = clone(store.mutableState);
      const sentRecords = stateToRecords(sentState);
      response = await exchange(sentOutbox, syncState.meta.cursor);

      const acknowledged = new Set(response.acks.map((ack) => ack.opId));
      syncState.outbox = syncState.outbox.filter((mutation) => !acknowledged.has(mutation.opId));
      // 只展示本轮中被服务端版本覆盖的过期写入；客户端正常覆盖服务端不算冲突。
      mergedConflictCount += response.acks.filter((ack) => ack.conflict && !ack.applied).length;

      const serverState = clone(sentState);
      applyWireChanges(serverState, response.changes);
      applyChangesToBaseline(response.changes);
      updateRecordVersions(response.changes);
      syncState.meta.cursor = response.resetRequired ? 0 : response.nextCursor;

      // 网络往返期间产生的本地编辑重新叠加，留给下一轮作为新 mutation 上传。
      const liveRecords = stateToRecords(store.mutableState);
      for (const localChange of diffRecords(sentRecords, liveRecords)) {
        applyRecordValue(serverState, localChange.entityKey, localChange.deleted ? undefined : localChange.value);
      }
      serverState.preferences.selectedDate = store.mutableState.preferences?.selectedDate;
      const serverRecords = stateToRecords(serverState);
      if (response.acks.length || response.changes.length || response.resetRequired) {
        assertPageActive();
        await saveCloudSyncState(ownerId, syncState.meta, syncState.outbox);
      }
      if (response.changes.length && diffRecords(liveRecords, serverRecords).length > 0) {
        await store.replaceFromSync(serverState);
        observedSyncRecords = stateToRecords(store.mutableState);
      }
    } while (response.hasMore || response.resetRequired || syncState.outbox.length);

    syncState.meta.lastSyncAt = new Date().toISOString();
    lastSyncedAt.value = syncState.meta.lastSyncAt;
    conflictCount.value = mergedConflictCount;
    syncError.value = null;
    assertPageActive();
    await saveCloudSyncState(ownerId, syncState.meta, syncState.outbox);
  } catch (error) {
    syncError.value = ["RATE_LIMITED", "BASELINE_MISMATCH", "SYNC_PAUSED"].includes(error.code)
      ? null
      : error;
    throw error;
  } finally {
    syncing.value = false;
  }
}

function clearSyncTimer() {
  if (syncTimer === undefined) return;
  globalThis.clearTimeout?.(syncTimer);
  syncTimer = undefined;
  syncTimerDue = 0;
}

function clearPullTimer() {
  if (pullTimer === undefined) return;
  globalThis.clearTimeout?.(pullTimer);
  pullTimer = undefined;
  pullTimerDue = 0;
}

function launchSync({ allowEmptyPull = false, source = "change" } = {}) {
  if (!store || activePromise) return false;
  lastSyncStartedAt = Date.now();
  activePromise = performSync({ allowEmptyPull })
    .catch((error) => {
      if (!["RATE_LIMITED", "SYNC_PAUSED"].includes(error.code)) return;
      if (source === "pull") pullPending = true;
      else syncPending = true;
    })
    .finally(() => {
      activePromise = null;
      if (!store) return;
      if (syncPending) scheduleCloudSync({ immediate: true });
      scheduleCloudPull();
    });
  return true;
}

function runScheduledSync() {
  clearSyncTimer();
  if (!store || activePromise) return;
  if (!isPageActive()) {
    syncPending = true;
    return;
  }
  syncPending = false;
  if (!launchSync({ source: "change" })) syncPending = true;
}

function scheduleCloudSync({ immediate = false } = {}) {
  if (!store || baselineConflict.value || resolvingBaseline.value) return Promise.resolve();
  syncPending = true;
  if (!isPageActive()) {
    clearSyncTimer();
    return Promise.resolve();
  }
  if (activePromise) return activePromise;

  const now = Date.now();
  const requestedAt = now + (immediate ? 0 : CLOUD_SYNC_INTERVAL_MS);
  const dueAt = Math.max(requestedAt, lastSyncStartedAt + CLOUD_SYNC_INTERVAL_MS);
  if (syncTimer !== undefined && syncTimerDue <= dueAt) return Promise.resolve();
  clearSyncTimer();
  syncTimerDue = dueAt;
  syncTimer = globalThis.setTimeout?.(runScheduledSync, Math.max(dueAt - now, 0));
  return Promise.resolve();
}

export function queueCloudSync() {
  return scheduleCloudSync({ immediate: true });
}

function runScheduledPull() {
  clearPullTimer();
  if (!store || baselineConflict.value || resolvingBaseline.value) return;
  if (!isPageActive() || globalThis.navigator?.onLine === false) {
    pullPending = true;
    return;
  }
  pullPending = false;
  if (!launchSync({ allowEmptyPull: true, source: "pull" })) pullPending = true;
}

function scheduleCloudPull({ immediate = false } = {}) {
  if (!store || baselineConflict.value || resolvingBaseline.value) return;
  pullPending = true;
  if (!isPageActive() || globalThis.navigator?.onLine === false || activePromise) {
    clearPullTimer();
    return;
  }
  const now = Date.now();
  const dueAt = immediate ? now : Math.max(now, lastExchangeAt + CLOUD_PULL_INTERVAL_MS);
  if (pullTimer !== undefined && pullTimerDue <= dueAt) return;
  clearPullTimer();
  pullTimerDue = dueAt;
  pullTimer = globalThis.setTimeout?.(runScheduledPull, Math.max(dueAt - now, 0));
}

function scheduleChangedStateSync() {
  const nextRecords = stateToRecords(store.mutableState);
  const syncableChanged = observedSyncRecords
    ? diffRecords(observedSyncRecords, nextRecords).length > 0
    : false;
  observedSyncRecords = nextRecords;
  if (!syncableChanged) return;
  void scheduleCloudSync({ immediate: false });
}

function pauseCloudSync() {
  const hadScheduledWork = syncTimer !== undefined || Boolean(activePromise);
  const hadScheduledPull = pullTimer !== undefined || Boolean(activePromise);
  clearSyncTimer();
  clearPullTimer();
  if (hadScheduledWork) syncPending = true;
  if (hadScheduledPull) pullPending = true;
  activeRequestController?.abort("page_not_focused");
}

function resumeCloudSync() {
  if (!isPageActive()) return;
  if (syncPending) void scheduleCloudSync({ immediate: true });
  scheduleCloudPull();
}

function onCloudVisibilityChange() {
  if (isPageActive()) resumeCloudSync();
  else pauseCloudSync();
}

export async function startCloudSync(campaignStore, authenticatedOwnerId) {
  if (store) {
    if (store === campaignStore && ownerId === String(authenticatedOwnerId)) return;
    stopCloudSync();
  }
  store = campaignStore;
  ownerId = String(authenticatedOwnerId);
  conflictCount.value = 0;
  baselineConflict.value = null;
  syncError.value = null;
  const loaded = await loadCloudSyncState(ownerId);
  syncState = { meta: loaded.meta ?? defaultMeta(), outbox: loaded.outbox ?? [] };
  syncState.meta.baselineId = campaignStore.mutableState.baselineId;
  observedSyncRecords = stateToRecords(campaignStore.mutableState);
  lastSyncedAt.value = syncState.meta.lastSyncAt ?? null;
  unsubscribeChanges = store.subscribeToChanges(scheduleChangedStateSync);
  globalThis.document?.addEventListener?.("visibilitychange", onCloudVisibilityChange);
  globalThis.addEventListener?.("online", resumeCloudSync);
  globalThis.addEventListener?.("focus", resumeCloudSync);
  globalThis.addEventListener?.("blur", pauseCloudSync);
  queueCloudSync();
}

function resolutionSnapshotMutations() {
  const mutations = [];
  const timestamp = Date.now();
  let sequence = syncState.meta.clientSeq;
  for (const [entityKey, value] of [...stateToRecords(store.mutableState).entries()].sort(([left], [right]) => left.localeCompare(right))) {
    sequence += 1;
    mutations.push({
      opId: `snapshot_${crypto.randomUUID().replaceAll("-", "")}_${sequence}`,
      entityKey,
      baseVersion: 0,
      clientTimeMs: timestamp,
      valueJson: encodeJsonValue(value),
      deleted: false,
      deviceId: syncState.meta.deviceId,
      clientSeq: sequence,
    });
  }
  syncState.meta.clientSeq = sequence;
  return mutations;
}

function recordVersionsFromChanges(changes) {
  const versions = {};
  for (const change of changes) {
    versions[change.entityKey] = Math.max(versions[change.entityKey] ?? 0, change.cursor);
  }
  return versions;
}

async function resolveBaseline(choice) {
  const conflict = baselineConflict.value;
  if (!conflict || resolvingBaseline.value) return false;
  resolvingBaseline.value = true;
  clearSyncTimer();
  try {
    const summary = localProgressSummary();
    const request = {
      requestId: `resolve_${crypto.randomUUID().replaceAll("-", "")}`,
      deviceId: syncState.meta.deviceId,
      localBaselineId: conflict.local.baselineId,
      expectedServerBaselineId: conflict.server.baselineId,
      expectedServerVersion: conflict.server.version,
      choice,
      localSnapshot: choice === BASELINE_CHOICE.USE_LOCAL ? resolutionSnapshotMutations() : [],
      localVersion: summary.version,
      localUpdatedAtMs: summary.updatedAtMs,
      localProgressDay: summary.progressDay,
    };
    const response = decodeResolveBaselineResponse(
      await postProtobuf("/api/v1/sync/resolve", encodeResolveBaselineRequest(request)),
    );
    if (response.stale) {
      baselineConflict.value = {
        ...conflict,
        server: {
          baselineId: response.baselineId,
          version: response.serverVersion,
          updatedAtMs: response.serverUpdatedAtMs,
          updatedAt: response.serverUpdatedAtMs
            ? new Date(response.serverUpdatedAtMs).toISOString()
            : null,
          progressDay: response.serverProgressDay || "2026-07-13",
        },
      };
      throw new Error("确认期间云端进度已更新，请重新选择");
    }

    const nextMeta = {
      ...syncState.meta,
      baselineId: response.baselineId,
      cursor: response.serverCursor,
      bootstrapDone: true,
      recordVersions: recordVersionsFromChanges(response.records),
      lastSyncAt: new Date().toISOString(),
    };
    let nextState;
    assertPageActive();
    if (choice === BASELINE_CHOICE.USE_SERVER) {
      nextState = store.createCleanSyncState(response.baselineId);
      applyWireChanges(nextState, response.records);
      nextState.baselineId = response.baselineId;
      nextMeta.baseline = recordsToSerializable(stateToRecords(nextState));
      const resolved = await replaceCampaignAndCloudSyncState(ownerId, nextState, nextMeta, []);
      store.replaceFromPersistedSync(resolved.state);
      nextState = resolved.state;
    } else {
      nextState = clone(store.mutableState);
      nextMeta.baseline = recordsToSerializable(stateToRecords(nextState));
      await saveCloudSyncState(ownerId, nextMeta, []);
    }
    syncState = { meta: nextMeta, outbox: [] };
    observedSyncRecords = stateToRecords(store.mutableState);
    lastSyncedAt.value = nextMeta.lastSyncAt;
    conflictCount.value = 0;
    baselineConflict.value = null;
    syncError.value = null;
    syncPending = false;
    return true;
  } finally {
    resolvingBaseline.value = false;
    if (!baselineConflict.value) scheduleCloudPull();
  }
}

export function resolveWithLocalProgress() {
  return resolveBaseline(BASELINE_CHOICE.USE_LOCAL);
}

export function resolveWithServerProgress() {
  return resolveBaseline(BASELINE_CHOICE.USE_SERVER);
}

export function stopCloudSync() {
  clearSyncTimer();
  clearPullTimer();
  activeRequestController?.abort("sync_stopped");
  activeRequestController = undefined;
  syncPending = false;
  pullPending = false;
  lastExchangeAt = 0;
  baselineConflict.value = null;
  resolvingBaseline.value = false;
  syncError.value = null;
  conflictCount.value = 0;
  unsubscribeChanges?.();
  unsubscribeChanges = undefined;
  globalThis.document?.removeEventListener?.("visibilitychange", onCloudVisibilityChange);
  globalThis.removeEventListener?.("online", resumeCloudSync);
  globalThis.removeEventListener?.("focus", resumeCloudSync);
  globalThis.removeEventListener?.("blur", pauseCloudSync);
  store = undefined;
  ownerId = undefined;
  syncState = undefined;
  observedSyncRecords = undefined;
}

export function useCloudSyncStatus() {
  return {
    syncing: readonly(syncing),
    error: readonly(syncError),
    lastSyncedAt: readonly(lastSyncedAt),
    conflictCount: readonly(conflictCount),
    baselineConflict: readonly(baselineConflict),
    resolvingBaseline: readonly(resolvingBaseline),
    syncNow: queueCloudSync,
    resolveWithLocalProgress,
    resolveWithServerProgress,
  };
}
