import { readonly, ref } from "vue";

import {
  loadCloudSyncState,
  replaceCampaignAndCloudSyncState,
  saveCloudSyncState,
} from "../persistence/indexedDb.js";
import {
  BASELINE_CHOICE,
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
import { createSyncWebSocketTransport } from "./webSocketTransport.js";

const syncing = ref(false);
const syncError = ref(null);
const lastSyncedAt = ref(null);
const conflictCount = ref(0);
const baselineConflict = ref(null);
const resolvingBaseline = ref(false);
const connectionState = ref("stopped");
const CLOUD_SYNC_INTERVAL_MS = 5_000;
let store;
let syncState;
let activePromise;
let syncTimer;
let syncTimerDue = 0;
let syncPending = false;
let pullPending = false;
let lastSyncStartedAt = 0;
let unsubscribeChanges;
let ownerId;
let observedSyncRecords;
let transport;
let retryTimer;
let authRequiredHandler;
let pendingResolutionRequest;

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

async function sendProtobuf(type, protobuf, options) {
  assertPageActive();
  if (!transport?.isOpen()) {
    const error = new Error("云同步连接尚未建立");
    error.code = "CONNECTION_LOST";
    throw error;
  }
  const result = await transport.request(type, protobuf, options);
  assertPageActive();
  return result;
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
  const response = decodeSyncResponse(await sendProtobuf("exchange", protobuf));
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

function reconcileOutbox(currentState = store.mutableState) {
  const baseline = serializableToRecords(syncState.meta.baseline);
  const current = stateToRecords(currentState);
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

function recordsMatchAtKey(left, right, entityKey) {
  if (left.has(entityKey) !== right.has(entityKey)) return false;
  return !left.has(entityKey) || recordValuesEqual(left.get(entityKey), right.get(entityKey));
}

export function selectResetLocalOverlay(
  previousBaseline,
  liveRecords,
  sentRecords,
  rejectedEntityKeys,
) {
  return diffRecords(previousBaseline, liveRecords).filter((change) => (
    !rejectedEntityKeys.has(change.entityKey) ||
    !recordsMatchAtKey(liveRecords, sentRecords, change.entityKey)
  ));
}

async function rebuildRemoteBaseline({ sentRecords, rejectedEntityKeys }) {
  const previousBaseline = serializableToRecords(syncState.meta.baseline);
  const liveRecords = stateToRecords(store.mutableState);
  const localOverlay = selectResetLocalOverlay(
    previousBaseline,
    liveRecords,
    sentRecords,
    rejectedEntityKeys,
  );
  const rebuiltState = store.createCleanSyncState(store.mutableState.baselineId);
  syncState.meta.cursor = 0;
  syncState.meta.baseline = {};
  syncState.meta.recordVersions = {};
  syncState.meta.bootstrapDone = false;
  let cursor = 0;
  let response;
  do {
    response = await exchange([], cursor);
    if (response.resetRequired && cursor === 0) {
      const error = new Error("云端同步游标无法重建");
      error.code = "FAILED_PRECONDITION";
      throw error;
    }
    applyWireChanges(rebuiltState, response.changes);
    applyChangesToBaseline(response.changes);
    updateRecordVersions(response.changes);
    cursor = response.nextCursor;
  } while (response.hasMore);
  syncState.meta.cursor = cursor;
  syncState.meta.bootstrapDone = true;
  for (const localChange of localOverlay) {
    applyRecordValue(
      rebuiltState,
      localChange.entityKey,
      localChange.deleted ? undefined : localChange.value,
    );
  }
  rebuiltState.preferences.selectedDate = store.mutableState.preferences?.selectedDate;
  return rebuiltState;
}

async function performSync({ allowEmptyPull = false, uploadMutations = true } = {}) {
  if (!store || !isPageActive() || baselineConflict.value || globalThis.navigator?.onLine === false) return;
  syncing.value = true;
  let mergedConflictCount = 0;
  try {
    const bootstrappedNow = await bootstrapFromServer();
    reconcileOutbox();
    if (!uploadMutations && syncState.outbox.length) syncPending = true;
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
      const sentOutbox = uploadMutations ? syncState.outbox.slice(0, 180) : [];
      const sentState = clone(store.mutableState);
      const sentRecords = stateToRecords(sentState);
      const localOverlay = uploadMutations
        ? []
        : diffRecords(serializableToRecords(syncState.meta.baseline), sentRecords);
      response = await exchange(sentOutbox, syncState.meta.cursor);

      const acknowledged = new Set(response.acks.map((ack) => ack.opId));
      syncState.outbox = syncState.outbox.filter((mutation) => !acknowledged.has(mutation.opId));
      // 只展示本轮中被服务端版本覆盖的过期写入；客户端正常覆盖服务端不算冲突。
      mergedConflictCount += response.acks.filter((ack) => ack.conflict && !ack.applied).length;

      if (response.resetRequired) {
        const sentByOpId = new Map(sentOutbox.map((mutation) => [mutation.opId, mutation]));
        const rejectedEntityKeys = new Set(
          response.acks
            .filter((ack) => !ack.applied)
            .map((ack) => sentByOpId.get(ack.opId)?.entityKey)
            .filter(Boolean),
        );
        const rebuiltState = await rebuildRemoteBaseline({ sentRecords, rejectedEntityKeys });
        reconcileOutbox(rebuiltState);
        assertPageActive();
        const persisted = await replaceCampaignAndCloudSyncState(
          ownerId,
          rebuiltState,
          syncState.meta,
          syncState.outbox,
        );
        store.replaceFromPersistedSync(persisted.state);
        observedSyncRecords = stateToRecords(store.mutableState);
        continue;
      }

      const serverState = clone(sentState);
      applyWireChanges(serverState, response.changes);
      applyChangesToBaseline(response.changes);
      updateRecordVersions(response.changes);
      syncState.meta.cursor = response.nextCursor;

      // 聚焦恢复时只拉取远端变化；本地未上传的编辑继续覆盖在最新远端基线上。
      for (const localChange of localOverlay) {
        applyRecordValue(
          serverState,
          localChange.entityKey,
          localChange.deleted ? undefined : localChange.value,
        );
      }

      // 网络往返期间产生的本地编辑重新叠加，留给下一轮作为新 mutation 上传。
      const liveRecords = stateToRecords(store.mutableState);
      for (const localChange of diffRecords(sentRecords, liveRecords)) {
        applyRecordValue(serverState, localChange.entityKey, localChange.deleted ? undefined : localChange.value);
      }
      serverState.preferences.selectedDate = store.mutableState.preferences?.selectedDate;
      const serverRecords = stateToRecords(serverState);
      if (response.acks.length || response.changes.length) {
        assertPageActive();
        await saveCloudSyncState(ownerId, syncState.meta, syncState.outbox);
      }
      if (response.changes.length && diffRecords(liveRecords, serverRecords).length > 0) {
        await store.replaceFromSync(serverState);
        observedSyncRecords = stateToRecords(store.mutableState);
      }
    } while (
      response.hasMore ||
      response.resetRequired ||
      (uploadMutations && syncState.outbox.length)
    );

    syncState.meta.lastSyncAt = new Date().toISOString();
    lastSyncedAt.value = syncState.meta.lastSyncAt;
    conflictCount.value = mergedConflictCount;
    syncError.value = null;
    assertPageActive();
    await saveCloudSyncState(ownerId, syncState.meta, syncState.outbox);
  } catch (error) {
    syncError.value = [
      "RATE_LIMITED",
      "BASELINE_MISMATCH",
      "SYNC_PAUSED",
      "CONNECTION_LOST",
      "AUTH_REQUIRED",
    ].includes(error.code)
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

function clearRetryTimer() {
  if (retryTimer === undefined) return;
  globalThis.clearTimeout?.(retryTimer);
  retryTimer = undefined;
}

function scheduleRetry(delayMs) {
  clearRetryTimer();
  retryTimer = globalThis.setTimeout?.(() => {
    retryTimer = undefined;
    drainPendingSync();
  }, Math.max(Number(delayMs) || 0, 1000));
}

function drainPendingSync() {
  if (
    !store ||
    activePromise ||
    retryTimer !== undefined ||
    baselineConflict.value ||
    resolvingBaseline.value ||
    !isPageActive() ||
    globalThis.navigator?.onLine === false ||
    !transport?.isOpen()
  ) return;
  if (pullPending) {
    pullPending = false;
    if (!launchSync({ allowEmptyPull: true, source: "pull" })) pullPending = true;
    return;
  }
  if (syncPending) {
    void scheduleCloudSync({ immediate: true });
  }
}

function launchSync({ allowEmptyPull = false, source = "change" } = {}) {
  if (!store || activePromise || !transport?.isOpen()) return false;
  lastSyncStartedAt = Date.now();
  activePromise = performSync({
    allowEmptyPull,
    uploadMutations: source !== "pull",
  })
    .catch((error) => {
      if (!["RATE_LIMITED", "SYNC_PAUSED", "CONNECTION_LOST"].includes(error.code)) return;
      if (source === "pull") pullPending = true;
      else syncPending = true;
      if (error.code === "RATE_LIMITED") scheduleRetry(error.retryAfterMs);
    })
    .finally(() => {
      activePromise = null;
      drainPendingSync();
    });
  return true;
}

function runScheduledSync() {
  clearSyncTimer();
  if (!store || activePromise) return;
  if (!isPageActive() || globalThis.navigator?.onLine === false || !transport?.isOpen()) {
    syncPending = true;
    return;
  }
  syncPending = false;
  if (!launchSync({ source: "change" })) syncPending = true;
}

function scheduleCloudSync({ immediate = false } = {}) {
  if (!store || baselineConflict.value || resolvingBaseline.value) return Promise.resolve();
  syncPending = true;
  if (
    !isPageActive() ||
    globalThis.navigator?.onLine === false ||
    !transport?.isOpen() ||
    retryTimer !== undefined
  ) {
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

function queueCloudPull() {
  pullPending = true;
  drainPendingSync();
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

function suspendCloudSyncActivity() {
  const hadScheduledWork = syncTimer !== undefined || Boolean(activePromise);
  clearSyncTimer();
  if (hadScheduledWork) syncPending = true;
  if (activePromise) pullPending = true;
  transport?.setActivity(false);
}

function resumePendingResolution() {
  if (!pendingResolutionRequest || !baselineConflict.value) return false;
  if (!isPageActive() || !transport?.isOpen() || resolvingBaseline.value) return true;
  void resolveBaseline(pendingResolutionRequest.choice).catch((error) => {
    if (!["CONNECTION_LOST", "SYNC_PAUSED"].includes(error.code)) syncError.value = error;
  });
  return true;
}

function activateCloudSyncActivity() {
  if (!isPageActive()) {
    suspendCloudSyncActivity();
    return;
  }
  const wasActive = transport?.isActivityActive() ?? false;
  transport?.setActivity(true);
  transport?.resume();
  if (resumePendingResolution()) return;
  if (wasActive) return;
  pullPending = true;
  drainPendingSync();
}

function pauseCloudSyncOffline() {
  suspendCloudSyncActivity();
  transport?.pause();
}

function resumeCloudSyncOnline() {
  if (isPageActive()) {
    activateCloudSyncActivity();
    return;
  }
  transport?.setActivity(false);
  transport?.resume();
}

function onCloudVisibilityChange() {
  if (isPageActive()) activateCloudSyncActivity();
  else suspendCloudSyncActivity();
}

export async function startCloudSync(campaignStore, authenticatedOwnerId, options = {}) {
  if (store) {
    if (store === campaignStore && ownerId === String(authenticatedOwnerId)) return;
    stopCloudSync();
  }
  store = campaignStore;
  ownerId = String(authenticatedOwnerId);
  authRequiredHandler = options.onAuthRequired;
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
  globalThis.addEventListener?.("online", resumeCloudSyncOnline);
  globalThis.addEventListener?.("offline", pauseCloudSyncOffline);
  globalThis.addEventListener?.("focus", activateCloudSyncActivity);
  globalThis.addEventListener?.("blur", suspendCloudSyncActivity);
  transport = createSyncWebSocketTransport({
    isActive: () => Boolean(store && globalThis.navigator?.onLine !== false),
    initialActivity: isPageActive(),
    onStateChange: (nextState) => { connectionState.value = nextState; },
    onOpen: () => {
      if (!isPageActive()) {
        pullPending = true;
        return;
      }
      if (resumePendingResolution()) return;
      syncPending = false;
      pullPending = false;
      if (!launchSync({ allowEmptyPull: true, source: "reconnect" })) {
        syncPending = true;
      }
    },
    onHint: (hint) => {
      if (!syncState) return;
      if (
        hint.baselineId !== store.mutableState.baselineId ||
        hint.serverCursor > syncState.meta.cursor
      ) queueCloudPull();
    },
    onAuthRequired: (error) => {
      syncError.value = null;
      Promise.resolve(authRequiredHandler?.(error)).catch((callbackError) => {
        syncError.value = callbackError;
      });
    },
    onFatalError: (error) => { syncError.value = error; },
  });
  transport.start();
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
    const requestKey = [
      conflict.local.baselineId,
      conflict.server.baselineId,
      conflict.server.version,
      choice,
    ].join(":");
    let request = pendingResolutionRequest?.key === requestKey
      ? pendingResolutionRequest.request
      : null;
    if (!request) {
      const summary = localProgressSummary();
      request = {
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
      pendingResolutionRequest = { key: requestKey, choice, request };
    }
    const response = decodeResolveBaselineResponse(
      await sendProtobuf("resolve", encodeResolveBaselineRequest(request), {
        requestId: request.requestId,
      }),
    );
    if (response.stale) {
      pendingResolutionRequest = undefined;
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
      nextState.baselineId = response.baselineId;
      nextMeta.baseline = recordsToSerializable(stateToRecords(nextState));
      const resolved = await replaceCampaignAndCloudSyncState(ownerId, nextState, nextMeta, []);
      store.replaceFromPersistedSync(resolved.state);
      nextState = resolved.state;
    }
    syncState = { meta: nextMeta, outbox: [] };
    observedSyncRecords = stateToRecords(store.mutableState);
    lastSyncedAt.value = nextMeta.lastSyncAt;
    conflictCount.value = 0;
    baselineConflict.value = null;
    syncError.value = null;
    syncPending = false;
    pendingResolutionRequest = undefined;
    return true;
  } finally {
    resolvingBaseline.value = false;
    if (!baselineConflict.value) queueCloudPull();
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
  clearRetryTimer();
  transport?.stop();
  transport = undefined;
  syncPending = false;
  pullPending = false;
  lastSyncStartedAt = 0;
  baselineConflict.value = null;
  resolvingBaseline.value = false;
  syncError.value = null;
  conflictCount.value = 0;
  connectionState.value = "stopped";
  unsubscribeChanges?.();
  unsubscribeChanges = undefined;
  globalThis.document?.removeEventListener?.("visibilitychange", onCloudVisibilityChange);
  globalThis.removeEventListener?.("online", resumeCloudSyncOnline);
  globalThis.removeEventListener?.("offline", pauseCloudSyncOffline);
  globalThis.removeEventListener?.("focus", activateCloudSyncActivity);
  globalThis.removeEventListener?.("blur", suspendCloudSyncActivity);
  store = undefined;
  ownerId = undefined;
  syncState = undefined;
  observedSyncRecords = undefined;
  authRequiredHandler = undefined;
  pendingResolutionRequest = undefined;
}

export function useCloudSyncStatus() {
  return {
    syncing: readonly(syncing),
    error: readonly(syncError),
    lastSyncedAt: readonly(lastSyncedAt),
    conflictCount: readonly(conflictCount),
    baselineConflict: readonly(baselineConflict),
    resolvingBaseline: readonly(resolvingBaseline),
    connectionState: readonly(connectionState),
    syncNow: queueCloudSync,
    resolveWithLocalProgress,
    resolveWithServerProgress,
  };
}
