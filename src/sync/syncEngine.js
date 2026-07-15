import { readonly, ref } from "vue";

import {
  loadCloudSyncState,
  replaceCampaignAndCloudSyncState,
  saveCloudSyncState,
} from "../persistence/indexedDb.js";
import { isPageActive, isPageVisible } from "../lib/pageActivity.js";
import { summarizeCampaignProgress } from "./baseline.js";
import { postSyncProtobuf } from "./httpTransport.js";
import {
  BASELINE_CHOICE,
  decodeDiffResponse,
  decodeJsonValue,
  decodeResolveBaselineResponse,
  encodeDiffRequest,
  encodeJsonValue,
  encodeResolveBaselineRequest,
} from "./protocol.js";
import { createSyncSseTransport } from "./sseTransport.js";
import {
  applyRecordValue,
  diffRecords,
  recordValuesEqual,
  recordsToSerializable,
  serializableToRecords,
  stateToRecords,
} from "./stateRecords.js";

const syncing = ref(false);
const syncError = ref(null);
const lastSyncedAt = ref(null);
const conflictCount = ref(0);
const baselineConflict = ref(null);
const resolvingBaseline = ref(false);
const connectionState = ref("stopped");

const CLOUD_SYNC_INTERVAL_MS = 5_000;
const MAX_DIFF_BATCH_SIZE = 180;
const DIFF_PATH = "v1/sync/diff";
const RESOLVE_PATH = "v1/sync/resolve";
const LOCAL_ONLY_PREFERENCE_KEYS = ["selectedDate", "minimalMode", "minimalModeOptOut"];

let store;
let ownerId;
let syncState;
let observedSyncRecords;
let unsubscribeChanges;
let stream;
let streamReady = false;
let streamBuffer;
let streamCursorOverride;
let rebuildingSnapshot = false;
let activeUploadPromise;
let activeRequestController;
let commitQueue = Promise.resolve();
let syncTimer;
let syncTimerDue = 0;
let retryTimer;
let syncPending = false;
let lastSuccessfulUploadAt = 0;
let diffBatchSize = MAX_DIFF_BATCH_SIZE;
let authRequiredHandler;
let pendingResolutionRequest;
const defaultPersistenceApi = {
  loadCloudSyncState,
  replaceCampaignAndCloudSyncState,
  saveCloudSyncState,
};
let persistenceApi = defaultPersistenceApi;
let sessionGeneration = 0;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
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

function syncFailure(message, code, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

function assertPageActive() {
  if (isPageActive()) return;
  throw syncFailure("页面未聚焦，操作已暂停", "SYNC_PAUSED");
}

function assertCurrentSession(expectedGeneration) {
  if (!store || !syncState || expectedGeneration !== sessionGeneration) {
    throw syncFailure("同步会话已切换", "STALE_SYNC_SESSION");
  }
}

function isCurrentSession(expectedGeneration) {
  return Boolean(store && syncState && expectedGeneration === sessionGeneration);
}

function enqueueCommit(action, expectedGeneration = sessionGeneration) {
  const result = commitQueue.then(() => {
    assertCurrentSession(expectedGeneration);
    return Promise.resolve(action()).then((value) => {
      assertCurrentSession(expectedGeneration);
      return value;
    });
  });
  commitQueue = result.catch(() => {});
  return result;
}

function localProgressSummary(state = store.mutableState) {
  return summarizeCampaignProgress(state);
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
  streamReady = false;
  stream?.pause();
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
    !rejectedEntityKeys.has(change.entityKey)
    || !recordsMatchAtKey(liveRecords, sentRecords, change.entityKey)
  ));
}

function mutationMatchesRecords(mutation, records) {
  if (mutation.deleted) return !records.has(mutation.entityKey);
  return records.has(mutation.entityKey)
    && recordValuesEqual(records.get(mutation.entityKey), mutation.value);
}

function applyChangeToRecords(records, change) {
  if (change.deleted) records.delete(change.entityKey);
  else records.set(change.entityKey, decodeJsonValue(change.valueJson));
}

function applyChangeToState(state, change) {
  applyRecordValue(
    state,
    change.entityKey,
    change.deleted ? undefined : decodeJsonValue(change.valueJson),
  );
}

function sortedChanges(changes) {
  return [...changes].sort((left, right) => left.cursor - right.cursor);
}

function assertContinuousChanges(changes, currentCursor, nextCursor) {
  if (!changes.length) {
    if (nextCursor !== currentCursor) {
      throw syncFailure("SSE 空批次不得跳过 cursor", "INVALID_RESPONSE");
    }
    return;
  }
  let expected = currentCursor + 1;
  for (const change of changes) {
    if (change.cursor !== expected) {
      throw syncFailure("SSE changes cursor 不连续", "INVALID_RESPONSE");
    }
    expected += 1;
  }
  if (nextCursor !== expected - 1) {
    throw syncFailure("SSE nextCursor 与 changes 不一致", "INVALID_RESPONSE");
  }
}

function reconcileSnapshot(meta, outbox, currentState = store.mutableState) {
  const nextMeta = clone(meta);
  const baseline = serializableToRecords(nextMeta.baseline);
  const current = stateToRecords(currentState);
  const differences = diffRecords(baseline, current);
  const prior = new Map(outbox.map((mutation) => [mutation.entityKey, mutation]));
  const next = [];
  for (const change of differences) {
    const existing = prior.get(change.entityKey);
    if (
      existing
      && existing.deleted === change.deleted
      && (change.deleted || recordValuesEqual(existing.value, change.value))
    ) {
      next.push(existing);
      continue;
    }
    nextMeta.clientSeq += 1;
    next.push({
      opId: `op_${nextMeta.deviceId}_${nextMeta.clientSeq}_${crypto.randomUUID().replaceAll("-", "")}`,
      entityKey: change.entityKey,
      baseVersion: nextMeta.recordVersions[change.entityKey] ?? 0,
      clientTimeMs: Date.now(),
      value: change.value,
      deleted: change.deleted,
      deviceId: nextMeta.deviceId,
      clientSeq: nextMeta.clientSeq,
    });
  }
  return { meta: nextMeta, outbox: next };
}

async function persistCombinedState(
  nextState,
  nextMeta,
  nextOutbox,
  expectedGeneration = sessionGeneration,
) {
  assertCurrentSession(expectedGeneration);
  const sessionStore = store;
  const sessionOwnerId = ownerId;
  const sessionPersistence = persistenceApi;
  let candidateState = clone(nextState);
  let candidateMeta = clone(nextMeta);
  let candidateOutbox = clone(nextOutbox);
  while (true) {
    const localPreferencesBeforePersist = localOnlyPreferences(sessionStore.mutableState);
    applyLocalOnlyPreferences(candidateState, localPreferencesBeforePersist);
    const liveBeforePersist = stateToRecords(sessionStore.mutableState);
    const persisted = await sessionPersistence.replaceCampaignAndCloudSyncState(
      sessionOwnerId,
      candidateState,
      candidateMeta,
      candidateOutbox,
    );
    assertCurrentSession(expectedGeneration);
    const concurrentEdits = diffRecords(
      liveBeforePersist,
      stateToRecords(sessionStore.mutableState),
    );
    const localPreferencesAfterPersist = localOnlyPreferences(sessionStore.mutableState);
    const localPreferencesChanged = !recordValuesEqual(
      localPreferencesBeforePersist,
      localPreferencesAfterPersist,
    );
    if (!concurrentEdits.length && !localPreferencesChanged) {
      syncState = { meta: clone(candidateMeta), outbox: clone(candidateOutbox) };
      sessionStore.replaceFromPersistedSync(persisted.state);
      observedSyncRecords = stateToRecords(sessionStore.mutableState);
      return persisted.state;
    }
    candidateState = clone(persisted.state);
    applyLocalOnlyPreferences(candidateState, localPreferencesAfterPersist);
    applyEdits(candidateState, concurrentEdits);
    const reconciled = reconcileSnapshot(candidateMeta, candidateOutbox, candidateState);
    candidateMeta = reconciled.meta;
    candidateOutbox = reconciled.outbox;
  }
}

function applyEdits(state, changes) {
  for (const change of changes) {
    applyRecordValue(state, change.entityKey, change.deleted ? undefined : change.value);
  }
}

function localOnlyPreferences(state) {
  return Object.fromEntries(LOCAL_ONLY_PREFERENCE_KEYS.map((key) => [
    key,
    clone(state?.preferences?.[key]),
  ]));
}

function applyLocalOnlyPreferences(state, preferences) {
  state.preferences ??= {};
  for (const key of LOCAL_ONLY_PREFERENCE_KEYS) state.preferences[key] = clone(preferences[key]);
}

function createStreamBuffer(mode) {
  const liveState = clone(store.mutableState);
  const liveRecords = stateToRecords(liveState);
  const previousBaseline = serializableToRecords(syncState.meta.baseline);
  return {
    mode,
    state: store.createCleanSyncState(store.mutableState.baselineId),
    baseline: new Map(),
    recordVersions: {},
    cursor: 0,
    startLiveRecords: liveRecords,
    localOverlay: diffRecords(previousBaseline, liveRecords),
  };
}

function applyChangesToBuffer(response) {
  if (response.nextCursor <= streamBuffer.cursor) return;
  assertContinuousChanges(response.changes, streamBuffer.cursor, response.nextCursor);
  for (const change of response.changes) {
    if (change.cursor <= (streamBuffer.recordVersions[change.entityKey] ?? 0)) continue;
    applyChangeToState(streamBuffer.state, change);
    applyChangeToRecords(streamBuffer.baseline, change);
    streamBuffer.recordVersions[change.entityKey] = change.cursor;
  }
  streamBuffer.cursor = response.nextCursor;
}

async function finalizeStreamBuffer(response, expectedGeneration) {
  if (!streamBuffer) streamBuffer = createStreamBuffer("bootstrap");
  if (streamBuffer.cursor !== response.nextCursor) {
    throw syncFailure("SSE ready cursor 与已接收批次不连续", "INVALID_RESPONSE");
  }
  let nextState = streamBuffer.state;
  applyEdits(nextState, streamBuffer.localOverlay);
  applyEdits(
    nextState,
    diffRecords(streamBuffer.startLiveRecords, stateToRecords(store.mutableState)),
  );
  nextState.preferences.selectedDate = store.mutableState.preferences?.selectedDate;
  nextState.baselineId = response.baselineId;
  const nextMeta = {
    ...syncState.meta,
    baselineId: response.baselineId,
    cursor: response.nextCursor,
    bootstrapDone: true,
    recordVersions: streamBuffer.recordVersions,
    baseline: recordsToSerializable(streamBuffer.baseline),
    lastSyncAt: new Date().toISOString(),
  };
  const reconciled = reconcileSnapshot(nextMeta, syncState.outbox, nextState);
  await persistCombinedState(
    nextState,
    reconciled.meta,
    reconciled.outbox,
    expectedGeneration,
  );
  assertCurrentSession(expectedGeneration);
  lastSyncedAt.value = reconciled.meta.lastSyncAt;
  streamBuffer = undefined;
  streamCursorOverride = undefined;
  rebuildingSnapshot = false;
}

function consumeMatchingEchoes(outbox, changes, liveRecords) {
  const byOperation = new Map(outbox.map((mutation) => [mutation.opId, mutation]));
  const acknowledged = new Set();
  const preserveLocalKeys = new Set();
  for (const change of changes) {
    const mutation = byOperation.get(change.opId);
    if (!mutation) continue;
    acknowledged.add(mutation.opId);
    if (!mutationMatchesRecords(mutation, liveRecords)) preserveLocalKeys.add(mutation.entityKey);
  }
  return {
    acknowledged,
    preserveLocalKeys,
    outbox: outbox.filter((mutation) => !acknowledged.has(mutation.opId)),
  };
}

async function applyIncrementalStreamResponse(response, expectedGeneration) {
  if (response.baselineId !== store.mutableState.baselineId) {
    setBaselineConflict(response);
    return;
  }
  if (response.nextCursor <= syncState.meta.cursor) return;
  assertContinuousChanges(response.changes, syncState.meta.cursor, response.nextCursor);
  const previousBaseline = serializableToRecords(syncState.meta.baseline);
  const nextMeta = clone(syncState.meta);
  const liveState = clone(store.mutableState);
  const liveRecords = stateToRecords(liveState);
  const fresh = response.changes.filter(
    (change) => change.cursor > (nextMeta.recordVersions[change.entityKey] ?? 0),
  );
  const echoResult = consumeMatchingEchoes(syncState.outbox, fresh, liveRecords);
  const { acknowledged, preserveLocalKeys } = echoResult;
  const localOverlay = diffRecords(previousBaseline, liveRecords).filter((change) => (
    preserveLocalKeys.has(change.entityKey)
    || !fresh.some((remote) => (
      acknowledged.has(remote.opId) && remote.entityKey === change.entityKey
    ))
  ));
  const nextState = clone(liveState);
  const nextBaseline = new Map(previousBaseline);
  for (const change of fresh) {
    applyChangeToState(nextState, change);
    applyChangeToRecords(nextBaseline, change);
    nextMeta.recordVersions[change.entityKey] = change.cursor;
  }
  applyEdits(nextState, localOverlay);
  applyEdits(nextState, diffRecords(liveRecords, stateToRecords(store.mutableState)));
  nextState.preferences.selectedDate = store.mutableState.preferences?.selectedDate;
  nextMeta.baseline = recordsToSerializable(nextBaseline);
  nextMeta.cursor = response.nextCursor;
  nextMeta.baselineId = response.baselineId;
  nextMeta.lastSyncAt = new Date().toISOString();
  const reconciled = reconcileSnapshot(nextMeta, echoResult.outbox, nextState);
  await persistCombinedState(
    nextState,
    reconciled.meta,
    reconciled.outbox,
    expectedGeneration,
  );
  assertCurrentSession(expectedGeneration);
  lastSyncedAt.value = reconciled.meta.lastSyncAt;
}

async function handleStreamEvent(event, expectedGeneration = sessionGeneration) {
  return enqueueCommit(async () => {
    const { response } = event;
    if (event.type === "baseline_mismatch" || response.baselineMismatch) {
      setBaselineConflict(response);
      return;
    }
    if (event.type === "reset_required" || response.resetRequired) {
      rebuildingSnapshot = true;
      streamCursorOverride = 0;
      streamBuffer = undefined;
      streamReady = false;
      stream?.restart();
      return;
    }
    if (event.type === "changes") {
      if (!syncState.meta.bootstrapDone || rebuildingSnapshot || streamBuffer) {
        streamBuffer ??= createStreamBuffer(rebuildingSnapshot ? "reset" : "bootstrap");
        applyChangesToBuffer(response);
      } else {
        await applyIncrementalStreamResponse(response, expectedGeneration);
      }
      return;
    }
    if (event.type === "ready") {
      if (response.baselineId !== store.mutableState.baselineId) {
        setBaselineConflict(response);
        return;
      }
      if (!syncState.meta.bootstrapDone || rebuildingSnapshot || streamBuffer) {
        if (!streamBuffer) streamBuffer = createStreamBuffer(rebuildingSnapshot ? "reset" : "bootstrap");
        if (response.changes.length) applyChangesToBuffer(response);
        await finalizeStreamBuffer(response, expectedGeneration);
      } else if (response.nextCursor !== syncState.meta.cursor) {
        throw syncFailure("SSE ready 前缺少连续 changes 批次", "INVALID_RESPONSE");
      }
      syncError.value = null;
    }
  }, expectedGeneration);
}

async function postProtobuf(path, protobuf, expectedGeneration = sessionGeneration) {
  assertCurrentSession(expectedGeneration);
  assertPageActive();
  if (globalThis.navigator?.onLine === false) {
    throw syncFailure("当前处于离线状态", "CONNECTION_LOST");
  }
  const controller = new AbortController();
  activeRequestController = controller;
  try {
    const result = await postSyncProtobuf(path, protobuf, { signal: controller.signal });
    assertCurrentSession(expectedGeneration);
    assertPageActive();
    return result;
  } finally {
    if (activeRequestController === controller) activeRequestController = undefined;
  }
}

function wireMutations(mutations) {
  return mutations.map((mutation) => ({
    ...mutation,
    valueJson: mutation.deleted ? new Uint8Array() : encodeJsonValue(mutation.value),
  }));
}

async function prepareDiffBatch(limit, expectedGeneration = sessionGeneration) {
  return enqueueCommit(async () => {
    const sentState = clone(store.mutableState);
    const reconciled = reconcileSnapshot(syncState.meta, syncState.outbox, sentState);
    if (!reconciled.outbox.length) return null;
    await persistenceApi.saveCloudSyncState(ownerId, reconciled.meta, reconciled.outbox);
    assertCurrentSession(expectedGeneration);
    syncState = { meta: reconciled.meta, outbox: reconciled.outbox };
    return {
      sentOutbox: clone(reconciled.outbox.slice(0, limit)),
      sentState,
      summary: localProgressSummary(sentState),
    };
  }, expectedGeneration);
}

async function applyDiffResponse(
  response,
  sentOutbox,
  sentState,
  expectedGeneration = sessionGeneration,
) {
  return enqueueCommit(async () => {
    if (response.baselineMismatch) {
      setBaselineConflict(response);
      return false;
    }
    if (response.acks.length !== sentOutbox.length || response.canonicalChanges.length !== response.acks.length) {
      throw syncFailure("diff 响应未逐项确认本批 mutation", "INVALID_RESPONSE");
    }
    const sentById = new Map(sentOutbox.map((mutation) => [mutation.opId, mutation]));
    const seenAcks = new Set();
    const usedCanonical = new Set();
    const associations = [];
    for (const ack of response.acks) {
      const mutation = sentById.get(ack.opId);
      if (!mutation || seenAcks.has(ack.opId)) {
        throw syncFailure("diff 响应包含未知或重复 Ack", "INVALID_RESPONSE");
      }
      seenAcks.add(ack.opId);
      const canonicalIndex = response.canonicalChanges.findIndex((change, index) => (
        !usedCanonical.has(index)
        && change.cursor === ack.serverCursor
        && change.entityKey === mutation.entityKey
        && (!ack.applied || change.opId === ack.opId)
      ));
      if (canonicalIndex < 0) {
        throw syncFailure("Ack 与 canonical change 无法精确关联", "INVALID_RESPONSE");
      }
      usedCanonical.add(canonicalIndex);
      associations.push({ ack, mutation, change: response.canonicalChanges[canonicalIndex] });
    }
    if (seenAcks.size !== sentById.size || usedCanonical.size !== response.canonicalChanges.length) {
      throw syncFailure("diff 响应与本批 mutation 不完整对应", "INVALID_RESPONSE");
    }
    const acknowledged = new Set(response.acks.map((ack) => ack.opId));
    const nextOutbox = syncState.outbox.filter((mutation) => !acknowledged.has(mutation.opId));
    conflictCount.value = response.acks.filter((ack) => ack.conflict && !ack.applied).length;

    const nextMeta = clone(syncState.meta);
    const liveState = clone(store.mutableState);
    const liveRecords = stateToRecords(liveState);
    const sentRecords = stateToRecords(sentState);
    const nextState = clone(liveState);
    const nextBaseline = serializableToRecords(nextMeta.baseline);
    for (const { ack, change } of associations.sort((left, right) => left.change.cursor - right.change.cursor)) {
      const fresh = change.cursor > (nextMeta.recordVersions[change.entityKey] ?? 0);
      if (fresh) {
        applyChangeToRecords(nextBaseline, change);
        nextMeta.recordVersions[change.entityKey] = change.cursor;
      }
      if (
        recordsMatchAtKey(liveRecords, sentRecords, change.entityKey)
        && (fresh || !ack.applied)
      ) {
        applyChangeToState(nextState, change);
      }
    }
    applyEdits(nextState, diffRecords(liveRecords, stateToRecords(store.mutableState)));
    nextState.preferences.selectedDate = store.mutableState.preferences?.selectedDate;
    nextMeta.baseline = recordsToSerializable(nextBaseline);
    nextMeta.baselineId = response.baselineId;
    const reconciled = reconcileSnapshot(nextMeta, nextOutbox, nextState);
    await persistCombinedState(nextState, reconciled.meta, reconciled.outbox, expectedGeneration);
    return true;
  }, expectedGeneration);
}

async function performUpload(expectedGeneration) {
  if (
    !store
    || !streamReady
    || !isPageActive()
    || baselineConflict.value
    || globalThis.navigator?.onLine === false
  ) return;
  assertCurrentSession(expectedGeneration);
  syncing.value = true;
  try {
    let prepared = await prepareDiffBatch(diffBatchSize, expectedGeneration);
    if (prepared) {
      let response;
      while (true) {
        const request = encodeDiffRequest({
          deviceId: syncState.meta.deviceId,
          mutations: wireMutations(prepared.sentOutbox),
          baselineId: store.mutableState.baselineId,
          localVersion: prepared.summary.version,
          localUpdatedAtMs: prepared.summary.updatedAtMs,
          localProgressDay: prepared.summary.progressDay,
        });
        try {
          response = decodeDiffResponse(
            await postProtobuf(DIFF_PATH, request, expectedGeneration),
          );
          lastSuccessfulUploadAt = Date.now();
          break;
        } catch (error) {
          if (
            ["SYNC_RESPONSE_TOO_LARGE", "REQUEST_TOO_LARGE"].includes(error.code)
            && prepared.sentOutbox.length > 1
          ) {
            diffBatchSize = Math.max(1, Math.floor(prepared.sentOutbox.length / 2));
            prepared = await prepareDiffBatch(diffBatchSize, expectedGeneration);
            continue;
          }
          throw error;
        }
      }
      assertCurrentSession(expectedGeneration);
      const applied = await applyDiffResponse(
        response,
        prepared.sentOutbox,
        prepared.sentState,
        expectedGeneration,
      );
      if (!applied) return;
    }
    await enqueueCommit(async () => {
      const nextMeta = { ...syncState.meta, lastSyncAt: new Date().toISOString() };
      await persistenceApi.saveCloudSyncState(ownerId, nextMeta, syncState.outbox);
      assertCurrentSession(expectedGeneration);
      syncState = { meta: nextMeta, outbox: syncState.outbox };
      lastSyncedAt.value = nextMeta.lastSyncAt;
      const hasRemainingDiff = diffRecords(
        serializableToRecords(nextMeta.baseline),
        stateToRecords(store.mutableState),
      ).length > 0;
      syncPending = syncState.outbox.length > 0 || hasRemainingDiff;
    }, expectedGeneration);
    syncError.value = null;
  } catch (error) {
    if (!isCurrentSession(expectedGeneration) || error.code === "STALE_SYNC_SESSION") return;
    if (error.code === "AUTH_REQUIRED") {
      Promise.resolve(authRequiredHandler?.(error)).catch((callbackError) => {
        syncError.value = callbackError;
      });
    }
    syncError.value = [
      "AUTH_REQUIRED",
      "RATE_LIMITED",
      "BASELINE_MISMATCH",
      "SYNC_PAUSED",
      "CONNECTION_LOST",
    ].includes(error.code) ? null : error;
    throw error;
  } finally {
    if (isCurrentSession(expectedGeneration)) syncing.value = false;
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

function scheduleRetry(delayMs, expectedGeneration = sessionGeneration) {
  clearRetryTimer();
  retryTimer = globalThis.setTimeout?.(() => {
    if (!isCurrentSession(expectedGeneration)) return;
    retryTimer = undefined;
    drainPendingSync(expectedGeneration);
  }, Math.max(Number(delayMs) || 0, 1000));
}

function launchUpload() {
  if (!store || activeUploadPromise || !streamReady) return false;
  const expectedGeneration = sessionGeneration;
  let uploadPromise;
  uploadPromise = performUpload(expectedGeneration)
    .catch((error) => {
      if (!isCurrentSession(expectedGeneration)) return;
      syncPending = true;
      if (error.code === "RATE_LIMITED") {
        scheduleRetry(error.retryAfterMs, expectedGeneration);
      }
    })
    .finally(() => {
      if (
        !isCurrentSession(expectedGeneration)
        || activeUploadPromise !== uploadPromise
      ) return;
      activeUploadPromise = undefined;
      if (syncPending && retryTimer === undefined) void scheduleCloudSync({ immediate: false });
    });
  activeUploadPromise = uploadPromise;
  return true;
}

function drainPendingSync(expectedGeneration = sessionGeneration) {
  if (
    !isCurrentSession(expectedGeneration)
    || !syncPending
    || activeUploadPromise
    || retryTimer !== undefined
    || baselineConflict.value
    || resolvingBaseline.value
    || !streamReady
    || !isPageActive()
    || globalThis.navigator?.onLine === false
  ) return;
  syncPending = false;
  if (!launchUpload()) syncPending = true;
}

function runScheduledSync(expectedGeneration) {
  if (!isCurrentSession(expectedGeneration)) return;
  clearSyncTimer();
  if (!store || activeUploadPromise) return;
  if (!isPageActive() || !streamReady || globalThis.navigator?.onLine === false) {
    syncPending = true;
    return;
  }
  syncPending = false;
  if (!launchUpload()) syncPending = true;
}

function scheduleCloudSync({ immediate = false } = {}) {
  if (!store || baselineConflict.value || resolvingBaseline.value) return Promise.resolve();
  syncPending = true;
  if (
    !isPageActive()
    || !streamReady
    || globalThis.navigator?.onLine === false
    || retryTimer !== undefined
  ) {
    clearSyncTimer();
    return Promise.resolve();
  }
  if (activeUploadPromise) return activeUploadPromise;
  const now = Date.now();
  const requestedAt = now + (immediate ? 0 : CLOUD_SYNC_INTERVAL_MS);
  const dueAt = Math.max(
    requestedAt,
    lastSuccessfulUploadAt + CLOUD_SYNC_INTERVAL_MS,
  );
  if (syncTimer !== undefined && syncTimerDue <= dueAt) return Promise.resolve();
  clearSyncTimer();
  syncTimerDue = dueAt;
  const expectedGeneration = sessionGeneration;
  syncTimer = globalThis.setTimeout?.(
    () => runScheduledSync(expectedGeneration),
    Math.max(dueAt - now, 0),
  );
  return Promise.resolve();
}

export function queueCloudSync() {
  return scheduleCloudSync({ immediate: true });
}

function scheduleChangedStateSync() {
  const nextRecords = stateToRecords(store.mutableState);
  const changed = observedSyncRecords
    ? diffRecords(observedSyncRecords, nextRecords).length > 0
    : false;
  observedSyncRecords = nextRecords;
  if (changed) void scheduleCloudSync({ immediate: false });
}

function pauseCloudUpload() {
  const hadWork = syncTimer !== undefined || retryTimer !== undefined || Boolean(activeUploadPromise);
  clearSyncTimer();
  clearRetryTimer();
  if (hadWork) syncPending = true;
  activeRequestController?.abort();
}

function pauseCloudSync() {
  pauseCloudUpload();
  streamReady = false;
  streamBuffer = undefined;
  stream?.pause();
}

function resumeCloudSync() {
  if (!isPageVisible() || globalThis.navigator?.onLine === false) return;
  streamReady = false;
  stream?.resume();
}

function onCloudVisibilityChange() {
  if (isPageVisible()) resumeCloudSync();
  else pauseCloudSync();
}

function resumeCloudUpload() {
  if (!isPageActive() || globalThis.navigator?.onLine === false || !streamReady) return;
  drainPendingSync();
}

function handleStreamState(nextState) {
  connectionState.value = nextState;
  if (nextState !== "open") streamReady = false;
  if (nextState === "connecting") {
    streamBuffer = undefined;
  }
}

export async function startCloudSync(campaignStore, authenticatedOwnerId, options = {}) {
  if (store) {
    if (store === campaignStore && ownerId === String(authenticatedOwnerId)) return;
    stopCloudSync();
  }
  const expectedGeneration = ++sessionGeneration;
  const sessionStore = campaignStore;
  const sessionOwnerId = String(authenticatedOwnerId);
  const sessionPersistence = options.persistence ?? defaultPersistenceApi;
  store = sessionStore;
  ownerId = sessionOwnerId;
  authRequiredHandler = options.onAuthRequired;
  persistenceApi = sessionPersistence;
  conflictCount.value = 0;
  baselineConflict.value = null;
  syncError.value = null;
  let loaded;
  try {
    loaded = await sessionPersistence.loadCloudSyncState(sessionOwnerId);
  } catch (error) {
    if (expectedGeneration !== sessionGeneration) return false;
    stopCloudSync();
    throw error;
  }
  if (
    expectedGeneration !== sessionGeneration
    || store !== sessionStore
    || ownerId !== sessionOwnerId
  ) return false;
  syncState = { meta: loaded.meta ?? defaultMeta(), outbox: loaded.outbox ?? [] };
  syncState.meta.baselineId = sessionStore.mutableState.baselineId;
  observedSyncRecords = stateToRecords(sessionStore.mutableState);
  lastSyncedAt.value = syncState.meta.lastSyncAt ?? null;
  unsubscribeChanges = store.subscribeToChanges(scheduleChangedStateSync);
  globalThis.document?.addEventListener?.("visibilitychange", onCloudVisibilityChange);
  globalThis.addEventListener?.("online", resumeCloudSync);
  globalThis.addEventListener?.("offline", pauseCloudSync);
  globalThis.addEventListener?.("focus", resumeCloudUpload);
  globalThis.addEventListener?.("blur", pauseCloudUpload);
  const sessionStream = createSyncSseTransport({
    isActive: () => Boolean(
      expectedGeneration === sessionGeneration
      && store === sessionStore
      && isPageVisible()
      && globalThis.navigator?.onLine !== false
    ),
    getConnectionParams: () => ({
      baselineId: sessionStore.mutableState.baselineId,
      cursor: streamCursorOverride
        ?? (syncState.meta.bootstrapDone ? syncState.meta.cursor : 0),
    }),
    onStateChange: (nextState) => {
      if (expectedGeneration === sessionGeneration) handleStreamState(nextState);
    },
    onEvent: (event) => {
      if (expectedGeneration !== sessionGeneration) return undefined;
      return handleStreamEvent(event, expectedGeneration);
    },
    onReady: () => {
      if (!isCurrentSession(expectedGeneration)) return;
      streamReady = true;
      const hasLocalDiff = diffRecords(
        serializableToRecords(syncState.meta.baseline),
        stateToRecords(store.mutableState),
      ).length > 0;
      if (syncState.outbox.length || hasLocalDiff || syncPending) {
        syncPending = true;
        drainPendingSync(expectedGeneration);
      }
    },
    onAuthRequired: async (error) => {
      if (!isCurrentSession(expectedGeneration)) return;
      syncError.value = null;
      await authRequiredHandler?.(error);
    },
    onUnavailable: (error) => {
      if (isCurrentSession(expectedGeneration)) syncError.value = error;
    },
    onError: (error) => {
      if (!isCurrentSession(expectedGeneration)) return;
      if (!["CONNECTION_LOST", "RATE_LIMITED"].includes(error.code)) syncError.value = error;
    },
  });
  if (expectedGeneration !== sessionGeneration) return false;
  stream = sessionStream;
  sessionStream.start();
  return true;
}

function resolutionSnapshotMutations() {
  const mutations = [];
  const timestamp = Date.now();
  let sequence = syncState.meta.clientSeq;
  for (const [entityKey, value] of [...stateToRecords(store.mutableState).entries()]
    .sort(([left], [right]) => left.localeCompare(right))) {
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
  return { mutations, clientSeq: sequence };
}

function recordVersionsFromChanges(changes) {
  const versions = {};
  for (const change of changes) {
    versions[change.entityKey] = Math.max(versions[change.entityKey] ?? 0, change.cursor);
  }
  return versions;
}

async function resolveBaseline(choice) {
  const expectedGeneration = sessionGeneration;
  const conflict = baselineConflict.value;
  if (!conflict || resolvingBaseline.value) return false;
  assertCurrentSession(expectedGeneration);
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
      const snapshot = choice === BASELINE_CHOICE.USE_LOCAL
        ? resolutionSnapshotMutations()
        : { mutations: [], clientSeq: syncState.meta.clientSeq };
      request = {
        requestId: `resolve_${crypto.randomUUID().replaceAll("-", "")}`,
        deviceId: syncState.meta.deviceId,
        localBaselineId: conflict.local.baselineId,
        expectedServerBaselineId: conflict.server.baselineId,
        expectedServerVersion: conflict.server.version,
        choice,
        localSnapshot: snapshot.mutations,
        localVersion: summary.version,
        localUpdatedAtMs: summary.updatedAtMs,
        localProgressDay: summary.progressDay,
      };
      pendingResolutionRequest = {
        key: requestKey,
        choice,
        request,
        clientSeq: snapshot.clientSeq,
      };
    }
    const response = decodeResolveBaselineResponse(
      await postProtobuf(
        RESOLVE_PATH,
        encodeResolveBaselineRequest(request),
        expectedGeneration,
      ),
    );
    assertCurrentSession(expectedGeneration);
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
      clientSeq: pendingResolutionRequest?.clientSeq ?? syncState.meta.clientSeq,
      baselineId: response.baselineId,
      cursor: response.serverCursor,
      bootstrapDone: true,
      recordVersions: recordVersionsFromChanges(response.records),
      lastSyncAt: new Date().toISOString(),
    };
    const serverState = store.createCleanSyncState(response.baselineId);
    for (const change of sortedChanges(response.records)) applyChangeToState(serverState, change);
    serverState.preferences.selectedDate = store.mutableState.preferences?.selectedDate;
    serverState.baselineId = response.baselineId;
    nextMeta.baseline = recordsToSerializable(stateToRecords(serverState));
    let nextState;
    let nextOutbox;
    assertPageActive();
    if (choice === BASELINE_CHOICE.USE_SERVER) {
      nextState = serverState;
      nextOutbox = [];
    } else {
      nextState = clone(store.mutableState);
      nextState.baselineId = response.baselineId;
      const reconciled = reconcileSnapshot(nextMeta, [], nextState);
      Object.assign(nextMeta, reconciled.meta);
      nextOutbox = reconciled.outbox;
    }
    nextState.baselineId = response.baselineId;
    await persistCombinedState(nextState, nextMeta, nextOutbox, expectedGeneration);
    assertCurrentSession(expectedGeneration);
    lastSyncedAt.value = nextMeta.lastSyncAt;
    conflictCount.value = 0;
    baselineConflict.value = null;
    syncError.value = null;
    syncPending = false;
    pendingResolutionRequest = undefined;
    streamReady = false;
    stream?.restart();
    return true;
  } catch (error) {
    if (!isCurrentSession(expectedGeneration) || error.code === "STALE_SYNC_SESSION") return false;
    if (error.code === "AUTH_REQUIRED") await authRequiredHandler?.(error);
    throw error;
  } finally {
    if (isCurrentSession(expectedGeneration)) resolvingBaseline.value = false;
  }
}

export function resolveWithLocalProgress() {
  return resolveBaseline(BASELINE_CHOICE.USE_LOCAL);
}

export function resolveWithServerProgress() {
  return resolveBaseline(BASELINE_CHOICE.USE_SERVER);
}

export function stopCloudSync() {
  sessionGeneration += 1;
  clearSyncTimer();
  clearRetryTimer();
  activeRequestController?.abort();
  activeRequestController = undefined;
  stream?.stop();
  stream = undefined;
  streamReady = false;
  streamBuffer = undefined;
  streamCursorOverride = undefined;
  rebuildingSnapshot = false;
  syncPending = false;
  lastSuccessfulUploadAt = 0;
  diffBatchSize = MAX_DIFF_BATCH_SIZE;
  baselineConflict.value = null;
  resolvingBaseline.value = false;
  syncError.value = null;
  conflictCount.value = 0;
  syncing.value = false;
  connectionState.value = "stopped";
  unsubscribeChanges?.();
  unsubscribeChanges = undefined;
  globalThis.document?.removeEventListener?.("visibilitychange", onCloudVisibilityChange);
  globalThis.removeEventListener?.("online", resumeCloudSync);
  globalThis.removeEventListener?.("offline", pauseCloudSync);
  globalThis.removeEventListener?.("focus", resumeCloudUpload);
  globalThis.removeEventListener?.("blur", pauseCloudUpload);
  store = undefined;
  ownerId = undefined;
  syncState = undefined;
  observedSyncRecords = undefined;
  authRequiredHandler = undefined;
  pendingResolutionRequest = undefined;
  activeUploadPromise = undefined;
  persistenceApi = defaultPersistenceApi;
  commitQueue = Promise.resolve();
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
