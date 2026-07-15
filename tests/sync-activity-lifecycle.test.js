import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultState } from "../src/domain/campaign.js";
import {
  loadCloudSyncState,
  replaceCampaignAndCloudSyncState,
  saveCloudSyncState,
} from "../src/persistence/indexedDb.js";
import {
  BASELINE_CHOICE,
  bytesToBase64,
  decodeDiffRequest,
  decodeResolveBaselineRequest,
  encodeDiffResponse,
  encodeJsonValue,
  encodeResolveBaselineResponse,
  encodeSyncResponse,
} from "../src/sync/protocol.js";
import {
  queueCloudSync,
  resolveWithLocalProgress,
  resolveWithServerProgress,
  startCloudSync,
  stopCloudSync,
  useCloudSyncStatus,
} from "../src/sync/syncEngine.js";

const BASELINE_ID = "baseline_0123456789abcdef0123456789abcdef";
const BASELINE_B = "baseline_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const BASELINE_C = "baseline_cccccccccccccccccccccccccccccccc";
const BASELINE_D = "baseline_dddddddddddddddddddddddddddddddd";
const OWNER_ID = "sse-lifecycle-owner";

class MemoryStorage {
  #values = new Map();

  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  setItem(key, value) { this.#values.set(String(key), String(value)); }
}

function createState() {
  const state = createDefaultState();
  state.baselineId = BASELINE_ID;
  state.schemaVersion = 1;
  state.revision = 0;
  state.lastUpdatedAt = null;
  state.quoteLikes = {};
  state.preferences = {
    selectedDate: "2026-07-13",
    fontFamily: "lxgw-wenka",
    quoteSource: "native",
    hitokotoCategories: [],
    minimalMode: true,
    minimalModeOptOut: false,
  };
  state.raffle.paperClaims = [];
  return state;
}

function createStore() {
  let listener;
  return {
    mutableState: createState(),
    subscribeToChanges(next) {
      listener = next;
      return () => { listener = undefined; };
    },
    emitChange() { listener?.(); },
    createCleanSyncState(baselineId) {
      return { ...createState(), baselineId };
    },
    replaceFromPersistedSync(nextState) {
      this.mutableState = structuredClone(nextState);
    },
  };
}

function syncResponse(overrides = {}) {
  return {
    nextCursor: 0,
    acks: [],
    changes: [],
    hasMore: false,
    resetRequired: false,
    baselineId: BASELINE_ID,
    serverVersion: 0,
    serverUpdatedAtMs: 0,
    serverProgressDay: "2026-07-13",
    baselineMismatch: false,
    ...overrides,
  };
}

function jsonProtobuf(bytes, status = 200, extraHeaders = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(extraHeaders),
    async json() { return { protobuf: bytesToBase64(bytes) }; },
  };
}

class SseConnection {
  constructor(signal) {
    this.signal = signal;
    this.encoder = new TextEncoder();
    this.body = new ReadableStream({
      start: (controller) => { this.controller = controller; },
    });
    signal.addEventListener("abort", () => {
      try { this.controller.error(new DOMException("aborted", "AbortError")); } catch {}
    }, { once: true });
  }

  send(type, response, id) {
    const lines = [`event: ${type}`];
    if (id) lines.push(`id: ${id}`);
    lines.push(`data: ${JSON.stringify({
      version: 1,
      protobuf: bytesToBase64(encodeSyncResponse(response)),
    })}`);
    this.controller.enqueue(this.encoder.encode(`${lines.join("\n")}\n\n`));
  }

  close() {
    this.controller.close();
  }

  asResponse() {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/event-stream" }),
      body: this.body,
    };
  }
}

async function turns(count = 4) {
  for (let index = 0; index < count; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function readSyncState(storage, owner = OWNER_ID) {
  return JSON.parse(storage.getItem(`zako-study-list:cloud-sync:${owner}`));
}

function installEnvironment(fetchImpl) {
  const keys = [
    "document", "navigator", "localStorage", "location", "fetch",
    "addEventListener", "removeEventListener", "indexedDB",
  ];
  const descriptors = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const windowEvents = new EventTarget();
  const document = new EventTarget();
  const navigator = { onLine: true };
  const storage = new MemoryStorage();
  let focused = true;
  let visibilityState = "visible";
  Object.defineProperties(document, {
    visibilityState: { configurable: true, get: () => visibilityState },
    hasFocus: { configurable: true, value: () => focused },
  });
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: document },
    navigator: { configurable: true, value: navigator },
    localStorage: { configurable: true, value: storage },
    location: { configurable: true, value: new URL("https://stellafortuna.luminet.cn/") },
    fetch: { configurable: true, value: fetchImpl },
    addEventListener: { configurable: true, value: windowEvents.addEventListener.bind(windowEvents) },
    removeEventListener: { configurable: true, value: windowEvents.removeEventListener.bind(windowEvents) },
    indexedDB: { configurable: true, value: undefined },
  });
  return {
    document,
    navigator,
    storage,
    windowEvents,
    setFocused(value) { focused = value; },
    setVisibility(value) { visibilityState = value; },
    restore() {
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test("older SSE canonical before a rejected diff Ack converges and only SSE advances cursor", async () => {
  const streams = [];
  const diffRequests = [];
  let releaseFirstDiff;
  const environment = installEnvironment(async (url, options) => {
    if (options.method === "GET") {
      const connection = new SseConnection(options.signal);
      streams.push({ url: String(url), connection });
      return connection.asResponse();
    }
    const request = decodeDiffRequest(
      Uint8Array.from(Buffer.from(JSON.parse(options.body).protobuf, "base64")),
    );
    diffRequests.push(request);
    if (diffRequests.length === 1) {
      return new Promise((resolve) => { releaseFirstDiff = resolve; });
    }
    const mutation = request.mutations[0];
    return jsonProtobuf(encodeDiffResponse({
      acks: [{ opId: mutation.opId, serverCursor: 2, conflict: false, applied: true }],
      canonicalChanges: [{
        cursor: 2,
        entityKey: mutation.entityKey,
        valueJson: mutation.valueJson,
        deleted: mutation.deleted,
        deviceId: mutation.deviceId,
        clientTimeMs: mutation.clientTimeMs,
        opId: mutation.opId,
      }],
      baselineId: BASELINE_ID,
      serverCursor: 2,
      serverVersion: 2,
      serverUpdatedAtMs: Date.now(),
      serverProgressDay: "2026-07-13",
      baselineMismatch: false,
    }));
  });

  try {
    const store = createStore();
    await startCloudSync(store, OWNER_ID);
    await turns();
    streams[0].connection.send("ready", syncResponse());
    await turns(8);

    store.mutableState.preferences.fontFamily = "system";
    store.emitChange();
    await queueCloudSync();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await turns(8);
    assert.equal(diffRequests.length, 1);
    const mutation = diffRequests[0].mutations[0];

    const rejected = {
      cursor: 1,
      entityKey: mutation.entityKey,
      valueJson: encodeJsonValue("anthropic"),
      deleted: false,
      deviceId: mutation.deviceId,
      clientTimeMs: mutation.clientTimeMs,
      opId: "remote_old_operation",
    };
    streams[0].connection.send(
      "changes",
      syncResponse({ nextCursor: 1, changes: [rejected], serverVersion: 1 }),
      `${BASELINE_ID}:1`,
    );
    await turns(8);
    assert.equal(store.mutableState.preferences.fontFamily, "system");
    assert.equal(readSyncState(environment.storage).meta.cursor, 1);
    assert.equal(readSyncState(environment.storage).outbox.length, 1);

    releaseFirstDiff(jsonProtobuf(encodeDiffResponse({
      acks: [{ opId: mutation.opId, serverCursor: 1, conflict: true, applied: false }],
      canonicalChanges: [rejected],
      baselineId: BASELINE_ID,
      serverCursor: 1,
      serverVersion: 1,
      serverUpdatedAtMs: Date.now(),
      serverProgressDay: "2026-07-13",
      baselineMismatch: false,
    })));
    await turns(10);
    assert.equal(store.mutableState.preferences.fontFamily, "anthropic");
    assert.equal(readSyncState(environment.storage).outbox.length, 0);
    assert.equal(readSyncState(environment.storage).meta.cursor, 1);

    environment.setFocused(false);
    environment.windowEvents.dispatchEvent(new Event("blur"));
    assert.equal(streams[0].connection.signal.aborted, true);
    store.mutableState.days["2026-07-13"].journal = "离线期间的本地内容";
    store.emitChange();
    await turns();
    assert.equal(diffRequests.length, 1);

    environment.setFocused(true);
    environment.windowEvents.dispatchEvent(new Event("focus"));
    await turns();
    assert.match(streams[1].url, /cursor=1/u);
    assert.equal(diffRequests.length, 1, "focus 必须先等待 SSE ready");
    streams[1].connection.send("ready", syncResponse({ nextCursor: 1, serverVersion: 1 }));
    await turns(10);
    assert.equal(diffRequests.length, 2);
    assert.equal(diffRequests[1].mutations[0].entityKey, "stella/v1/day/2026-07-13/journal");
    assert.equal(readSyncState(environment.storage).meta.cursor, 1, "diff canonical 不推进全局 cursor");
  } finally {
    stopCloudSync();
    environment.restore();
  }
});

test("bootstrap and reset build a clean snapshot, preserve local overlay, and reject cursor gaps", async () => {
  const streams = [];
  const environment = installEnvironment(async (_url, options) => {
    if (options.method === "GET") {
      const connection = new SseConnection(options.signal);
      streams.push(connection);
      return connection.asResponse();
    }
    return jsonProtobuf(encodeDiffResponse({
      acks: [], canonicalChanges: [], baselineId: BASELINE_ID, serverCursor: 0,
      serverVersion: 0, serverUpdatedAtMs: 0, serverProgressDay: "2026-07-13",
      baselineMismatch: false,
    }));
  });
  try {
    const store = createStore();
    store.mutableState.preferences.fontFamily = "system";
    await startCloudSync(store, `${OWNER_ID}-reset`);
    await turns();
    const remoteFont = {
      cursor: 1,
      entityKey: "stella/v1/preference/fontFamily",
      valueJson: encodeJsonValue("anthropic"),
      deleted: false,
      deviceId: "remote",
      clientTimeMs: 1,
      opId: "remote_bootstrap",
    };
    streams[0].send(
      "changes",
      syncResponse({ nextCursor: 1, changes: [remoteFont] }),
      `${BASELINE_ID}:1`,
    );
    await turns();
    assert.equal(store.mutableState.preferences.fontFamily, "system", "bootstrap ready 前不得改 UI");
    streams[0].send("ready", syncResponse({ nextCursor: 1, serverVersion: 1 }));
    await turns(8);
    assert.equal(store.mutableState.preferences.fontFamily, "system", "本地 overlay 必须覆盖远端 snapshot");

    streams[0].send("reset_required", syncResponse({
      nextCursor: 1,
      resetRequired: true,
      serverVersion: 1,
    }));
    await turns();
    assert.equal(streams[0].signal.aborted, true);
    assert.equal(streams.length, 2);

    const remoteJournal = {
      cursor: 1,
      entityKey: "stella/v1/day/2026-07-13/journal",
      valueJson: encodeJsonValue("重建后的远端日记"),
      deleted: false,
      deviceId: "remote",
      clientTimeMs: 2,
      opId: "remote_reset",
    };
    streams[1].send(
      "changes",
      syncResponse({ nextCursor: 1, changes: [remoteJournal] }),
      `${BASELINE_ID}:1`,
    );
    await turns();
    assert.equal(store.mutableState.days["2026-07-13"].journal, "");
    streams[1].send("ready", syncResponse({ nextCursor: 1, serverVersion: 1 }));
    await turns(8);
    assert.equal(store.mutableState.days["2026-07-13"].journal, "重建后的远端日记");
    assert.equal(store.mutableState.preferences.fontFamily, "system");

    streams[1].send(
      "changes",
      syncResponse({ nextCursor: 1, changes: [remoteJournal], serverVersion: 1 }),
      `${BASELINE_ID}:1`,
    );
    await turns(4);
    assert.equal(store.mutableState.days["2026-07-13"].journal, "重建后的远端日记");
    assert.equal(readSyncState(environment.storage, `${OWNER_ID}-reset`).meta.cursor, 1);

    const gap = {
      ...remoteJournal,
      cursor: 3,
      valueJson: encodeJsonValue("不连续变更"),
      opId: "remote_gap",
    };
    streams[1].send(
      "changes",
      syncResponse({ nextCursor: 3, changes: [gap], serverVersion: 2 }),
      `${BASELINE_ID}:3`,
    );
    await turns(8);
    assert.equal(store.mutableState.days["2026-07-13"].journal, "重建后的远端日记");
  } finally {
    stopCloudSync();
    environment.restore();
  }
});

test("a delayed old start cannot create a stream after a new owner starts", async () => {
  const streams = [];
  const environment = installEnvironment(async (_url, options) => {
    const connection = new SseConnection(options.signal);
    streams.push(connection);
    return connection.asResponse();
  });
  let releaseOldLoad;
  const oldLoad = new Promise((resolve) => { releaseOldLoad = resolve; });
  const unusedPersistenceMethods = {
    async saveCloudSyncState() { throw new Error("unexpected save"); },
    async replaceCampaignAndCloudSyncState() { throw new Error("unexpected replace"); },
  };
  const oldPersistence = {
    ...unusedPersistenceMethods,
    loadCloudSyncState: () => oldLoad,
  };
  const newPersistence = {
    ...unusedPersistenceMethods,
    async loadCloudSyncState() { return { meta: null, outbox: [] }; },
  };
  try {
    const oldStart = startCloudSync(createStore(), "old-owner", {
      persistence: oldPersistence,
    });
    const newStore = createStore();
    assert.equal(await startCloudSync(newStore, "new-owner", {
      persistence: newPersistence,
    }), true);
    await turns();
    assert.equal(streams.length, 1);

    releaseOldLoad({ meta: null, outbox: [] });
    assert.equal(await oldStart, false);
    await turns();
    assert.equal(streams.length, 1, "旧 owner 的延迟 load 不得创建或替换新 SSE");
  } finally {
    stopCloudSync();
    environment.restore();
  }
});

test("an unexpected SSE disconnect blocks diff upload until a new ready checkpoint", async () => {
  const streams = [];
  const diffRequests = [];
  const originalRandom = Math.random;
  Math.random = () => 1;
  const environment = installEnvironment(async (url, options) => {
    if (options.method === "GET") {
      const connection = new SseConnection(options.signal);
      streams.push({ url: String(url), connection });
      return connection.asResponse();
    }
    const request = decodeDiffRequest(
      Uint8Array.from(Buffer.from(JSON.parse(options.body).protobuf, "base64")),
    );
    diffRequests.push(request);
    const mutation = request.mutations[0];
    return jsonProtobuf(encodeDiffResponse({
      acks: [{ opId: mutation.opId, serverCursor: 1, conflict: false, applied: true }],
      canonicalChanges: [{
        cursor: 1,
        entityKey: mutation.entityKey,
        valueJson: mutation.valueJson,
        deleted: mutation.deleted,
        deviceId: mutation.deviceId,
        clientTimeMs: mutation.clientTimeMs,
        opId: mutation.opId,
      }],
      baselineId: BASELINE_ID,
      serverCursor: 1,
      serverVersion: 1,
      serverUpdatedAtMs: Date.now(),
      serverProgressDay: "2026-07-13",
      baselineMismatch: false,
    }));
  });

  try {
    const store = createStore();
    await startCloudSync(store, `${OWNER_ID}-disconnect`);
    await turns();
    streams[0].connection.send("ready", syncResponse());
    await turns(8);

    streams[0].connection.close();
    await turns(4);
    store.mutableState.days["2026-07-13"].journal = "断线期间的本地内容";
    store.emitChange();
    await queueCloudSync();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await turns(4);
    assert.equal(diffRequests.length, 0, "断线 backoff 期间不得上传 diff");

    environment.setFocused(false);
    environment.windowEvents.dispatchEvent(new Event("blur"));
    environment.setFocused(true);
    environment.windowEvents.dispatchEvent(new Event("focus"));
    await turns();
    assert.equal(streams.length, 2);
    streams[1].connection.send("ready", syncResponse());
    await turns(10);
    assert.equal(diffRequests.length, 1, "只有新的 ready checkpoint 后才能恢复上传");
  } finally {
    stopCloudSync();
    environment.restore();
    Math.random = originalRandom;
  }
});

test("an edit during outbox persistence is not overwritten by the older diff Ack", async () => {
  const streams = [];
  const diffRequests = [];
  let releaseFirstSave;
  let markFirstSaveStarted;
  const firstSaveStarted = new Promise((resolve) => { markFirstSaveStarted = resolve; });
  const firstSaveGate = new Promise((resolve) => { releaseFirstSave = resolve; });
  let releaseReplace;
  let markReplaceStarted;
  const replaceStarted = new Promise((resolve) => { markReplaceStarted = resolve; });
  const replaceGate = new Promise((resolve) => { releaseReplace = resolve; });
  let shouldGateReplace = false;
  let replaceGated = false;
  let saveCalls = 0;
  const persistence = {
    loadCloudSyncState,
    async replaceCampaignAndCloudSyncState(...args) {
      if (shouldGateReplace && !replaceGated) {
        replaceGated = true;
        markReplaceStarted();
        await replaceGate;
      }
      return replaceCampaignAndCloudSyncState(...args);
    },
    async saveCloudSyncState(...args) {
      saveCalls += 1;
      if (saveCalls === 1) {
        markFirstSaveStarted();
        await firstSaveGate;
      }
      return saveCloudSyncState(...args);
    },
  };
  const environment = installEnvironment(async (_url, options) => {
    if (options.method === "GET") {
      const connection = new SseConnection(options.signal);
      streams.push(connection);
      return connection.asResponse();
    }
    const request = decodeDiffRequest(
      Uint8Array.from(Buffer.from(JSON.parse(options.body).protobuf, "base64")),
    );
    diffRequests.push(request);
    const mutation = request.mutations[0];
    return jsonProtobuf(encodeDiffResponse({
      acks: [{ opId: mutation.opId, serverCursor: 1, conflict: false, applied: true }],
      canonicalChanges: [{
        cursor: 1,
        entityKey: mutation.entityKey,
        valueJson: mutation.valueJson,
        deleted: mutation.deleted,
        deviceId: mutation.deviceId,
        clientTimeMs: mutation.clientTimeMs,
        opId: mutation.opId,
      }],
      baselineId: BASELINE_ID,
      serverCursor: 1,
      serverVersion: 1,
      serverUpdatedAtMs: Date.now(),
      serverProgressDay: "2026-07-13",
      baselineMismatch: false,
    }));
  });
  const owner = `${OWNER_ID}-persist-race`;

  try {
    const store = createStore();
    await startCloudSync(store, owner, { persistence });
    await turns();
    streams[0].send("ready", syncResponse());
    await turns(8);
    shouldGateReplace = true;

    store.mutableState.days["2026-07-13"].journal = "准备上传的旧内容";
    store.emitChange();
    await queueCloudSync();
    await firstSaveStarted;
    store.mutableState.days["2026-07-13"].journal = "持久化期间的新内容";
    store.emitChange();
    releaseFirstSave();
    await replaceStarted;
    store.mutableState.preferences.selectedDate = "2026-07-20";
    store.mutableState.preferences.minimalMode = false;
    store.mutableState.preferences.minimalModeOptOut = true;
    releaseReplace();
    await turns(16);

    assert.equal(diffRequests.length, 1);
    assert.equal(store.mutableState.days["2026-07-13"].journal, "持久化期间的新内容");
    const persisted = readSyncState(environment.storage, owner);
    assert.equal(persisted.outbox.length, 1);
    assert.equal(persisted.outbox[0].value, "持久化期间的新内容");
    const persistedCampaign = JSON.parse(
      environment.storage.getItem("zako-study-list:campaign:state"),
    );
    assert.equal(persistedCampaign.preferences.selectedDate, "2026-07-20");
    assert.equal(persistedCampaign.preferences.minimalMode, false);
    assert.equal(persistedCampaign.preferences.minimalModeOptOut, true);
  } finally {
    stopCloudSync();
    environment.restore();
  }
});

test("baseline resolve applies USE_SERVER and preserves edits made during USE_LOCAL", async () => {
  const streams = [];
  const resolveRequests = [];
  let releaseLocalResolve;
  let markLocalResolveStarted;
  const localResolveStarted = new Promise((resolve) => { markLocalResolveStarted = resolve; });
  const environment = installEnvironment(async (url, options) => {
    if (options.method === "GET") {
      const connection = new SseConnection(options.signal);
      streams.push({ url: String(url), connection });
      return connection.asResponse();
    }
    assert.match(String(url), /\/v1\/sync\/resolve$/u);
    const request = decodeResolveBaselineRequest(
      Uint8Array.from(Buffer.from(JSON.parse(options.body).protobuf, "base64")),
    );
    resolveRequests.push(request);
    if (request.choice === BASELINE_CHOICE.USE_SERVER) {
      return jsonProtobuf(encodeResolveBaselineResponse({
        baselineId: BASELINE_B,
        serverVersion: 2,
        serverUpdatedAtMs: Date.now(),
        serverProgressDay: "2026-07-13",
        records: [{
          cursor: 2,
          entityKey: "stella/v1/preference/fontFamily",
          valueJson: encodeJsonValue("anthropic"),
          deleted: false,
          deviceId: "remote_device",
          clientTimeMs: Date.now(),
          opId: "remote_server_choice",
        }],
        stale: false,
        serverCursor: 2,
      }));
    }
    markLocalResolveStarted();
    return new Promise((resolve) => {
      releaseLocalResolve = () => {
        const records = request.localSnapshot.map((mutation, index) => ({
          cursor: index + 1,
          entityKey: mutation.entityKey,
          valueJson: mutation.valueJson,
          deleted: mutation.deleted,
          deviceId: mutation.deviceId,
          clientTimeMs: mutation.clientTimeMs,
          opId: mutation.opId,
        }));
        resolve(jsonProtobuf(encodeResolveBaselineResponse({
          baselineId: BASELINE_D,
          serverVersion: records.length ? 1 : 0,
          serverUpdatedAtMs: Date.now(),
          serverProgressDay: "2026-07-13",
          records,
          stale: false,
          serverCursor: records.length,
        })));
      };
    });
  });
  const owner = `${OWNER_ID}-resolve`;

  try {
    const store = createStore();
    store.mutableState.preferences.selectedDate = "2026-07-20";
    await startCloudSync(store, owner);
    await turns();
    streams[0].connection.send("ready", syncResponse());
    await turns(8);

    streams[0].connection.send("baseline_mismatch", syncResponse({
      baselineId: BASELINE_B,
      serverVersion: 2,
      serverUpdatedAtMs: Date.now(),
      baselineMismatch: true,
    }));
    await turns(6);
    assert.equal(useCloudSyncStatus().baselineConflict.value.server.baselineId, BASELINE_B);
    assert.equal(await resolveWithServerProgress(), true);
    await turns(4);
    assert.equal(resolveRequests[0].choice, BASELINE_CHOICE.USE_SERVER);
    assert.equal(store.mutableState.baselineId, BASELINE_B);
    assert.equal(store.mutableState.preferences.fontFamily, "anthropic");
    assert.equal(store.mutableState.preferences.selectedDate, "2026-07-20");
    assert.match(streams[1].url, new RegExp(`baselineId=${BASELINE_B}.*cursor=2`, "u"));
    streams[1].connection.send("ready", syncResponse({
      baselineId: BASELINE_B,
      nextCursor: 2,
      serverVersion: 2,
    }));
    await turns(8);

    store.mutableState.preferences.fontFamily = "system";
    store.emitChange();
    streams[1].connection.send("baseline_mismatch", syncResponse({
      baselineId: BASELINE_C,
      nextCursor: 2,
      serverVersion: 3,
      serverUpdatedAtMs: Date.now(),
      baselineMismatch: true,
    }));
    await turns(6);
    const resolving = resolveWithLocalProgress();
    await localResolveStarted;
    store.mutableState.days["2026-07-13"].journal = "确认覆盖期间的新日记";
    store.emitChange();
    releaseLocalResolve();
    assert.equal(await resolving, true);
    await turns(8);

    assert.equal(resolveRequests[1].choice, BASELINE_CHOICE.USE_LOCAL);
    assert.equal(store.mutableState.baselineId, BASELINE_D);
    assert.equal(store.mutableState.preferences.fontFamily, "system");
    assert.equal(store.mutableState.days["2026-07-13"].journal, "确认覆盖期间的新日记");
    const persisted = readSyncState(environment.storage, owner);
    assert.equal(persisted.meta.cursor, resolveRequests[1].localSnapshot.length);
    assert.ok(persisted.outbox.some((mutation) => (
      mutation.entityKey === "stella/v1/day/2026-07-13/journal"
      && mutation.value === "确认覆盖期间的新日记"
    )));
    assert.match(streams[2].url, new RegExp(`baselineId=${BASELINE_D}`, "u"));
  } finally {
    stopCloudSync();
    environment.restore();
  }
});
