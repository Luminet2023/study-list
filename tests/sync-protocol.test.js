import assert from "node:assert/strict";
import test from "node:test";

import {
  base64ToBytes,
  BASELINE_CHOICE,
  bytesToBase64,
  decodeResolveBaselineRequest,
  decodeResolveBaselineResponse,
  decodeSyncRequest,
  decodeSyncResponse,
  encodeJsonValue,
  encodeResolveBaselineRequest,
  encodeResolveBaselineResponse,
  encodeSyncRequest,
  encodeSyncResponse,
} from "../src/sync/protocol.js";
import {
  applyWireChanges,
  diffRecords,
  stateToRecords,
} from "../src/sync/stateRecords.js";
import { createDefaultState } from "../src/domain/campaign.js";

test("protobuf transport uses a lossless Base64 envelope", () => {
  const bytes = Uint8Array.from([0, 1, 2, 127, 128, 254, 255]);
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
  assert.throws(() => base64ToBytes("not base64"), /invalid Base64/u);
});

test("protobuf sync request round-trips mutations", () => {
  const request = {
    deviceId: "device-a",
    cursor: 42,
    pullLimit: 128,
    baselineId: "baseline_0123456789abcdef0123456789abcdef",
    localVersion: 18,
    localUpdatedAtMs: 1_789_000_000_020,
    localProgressDay: "2026-07-18",
    mutations: [{
      opId: "op-1",
      entityKey: "stella/v1/preference/fontFamily",
      baseVersion: 12,
      clientTimeMs: 1_789_000_000_000,
      valueJson: encodeJsonValue("anthropic"),
      deleted: false,
      deviceId: "device-a",
      clientSeq: 7,
    }],
  };
  assert.deepEqual(decodeSyncRequest(encodeSyncRequest(request)), request);
});

test("baseline resolution protobuf round-trips the explicit overwrite decision", () => {
  const request = {
    requestId: "resolve_0123456789abcdef",
    deviceId: "device-a",
    localBaselineId: "baseline_0123456789abcdef0123456789abcdef",
    expectedServerBaselineId: "baseline_abcdef0123456789abcdef0123456789",
    expectedServerVersion: 21,
    choice: BASELINE_CHOICE.USE_LOCAL,
    localSnapshot: [],
    localVersion: 9,
    localUpdatedAtMs: 1_789_000_000_100,
    localProgressDay: "2026-07-20",
  };
  assert.deepEqual(decodeResolveBaselineRequest(encodeResolveBaselineRequest(request)), request);

  const response = {
    baselineId: request.localBaselineId,
    serverVersion: 24,
    serverUpdatedAtMs: 1_789_000_000_200,
    serverProgressDay: "2026-07-20",
    records: [],
    stale: false,
    serverCursor: 24,
  };
  assert.deepEqual(decodeResolveBaselineResponse(encodeResolveBaselineResponse(response)), response);
});

test("protobuf sync response round-trips changes and conflicts", () => {
  const response = {
    nextCursor: 9,
    acks: [{ opId: "op-2", serverCursor: 9, conflict: true, applied: false }],
    changes: [{
      cursor: 9,
      entityKey: "stella/v1/day/2026-07-13/journal",
      valueJson: encodeJsonValue("# 今天"),
      deleted: false,
      deviceId: "device-b",
      clientTimeMs: 1_789_000_000_010,
      opId: "op-remote",
    }],
    hasMore: true,
    resetRequired: false,
    baselineId: "baseline_0123456789abcdef0123456789abcdef",
    serverVersion: 9,
    serverUpdatedAtMs: 1_789_000_000_030,
    serverProgressDay: "2026-07-19",
    baselineMismatch: false,
  };
  assert.deepEqual(decodeSyncResponse(encodeSyncResponse(response)), response);
});

test("state records create field-level deltas and apply remote values", () => {
  const beforeState = createDefaultState();
  beforeState.preferences = { fontFamily: "lxgw-wenka" };
  beforeState.quoteLikes = {};
  beforeState.raffle.paperClaims = [];
  const afterState = structuredClone(beforeState);
  afterState.days["2026-07-13"].journal = "**完成**";
  afterState.preferences.fontFamily = "system";

  const changes = diffRecords(stateToRecords(beforeState), stateToRecords(afterState));
  assert.equal(changes.length, 2);

  applyWireChanges(beforeState, changes.map((change, index) => ({
    ...change,
    cursor: index + 1,
    valueJson: change.deleted ? new Uint8Array() : encodeJsonValue(change.value),
  })));
  assert.equal(beforeState.days["2026-07-13"].journal, "**完成**");
  assert.equal(beforeState.preferences.fontFamily, "system");
});

test("journal cloud drafts use a dedicated record and do not overwrite the journal", () => {
  const state = createDefaultState();
  state.days["2026-07-13"].journal = "正式日记";
  state.days["2026-07-13"].journalDraft = "尚未发布的草稿";

  const records = stateToRecords(state);
  assert.equal(records.get("stella/v1/day/2026-07-13/journal"), "正式日记");
  assert.equal(
    records.get("stella/v1/day/2026-07-13/journalDraft"),
    "尚未发布的草稿",
  );

  const restored = createDefaultState();
  applyWireChanges(restored, [{
    cursor: 1,
    entityKey: "stella/v1/day/2026-07-13/journalDraft",
    valueJson: encodeJsonValue("云端草稿"),
    deleted: false,
    deviceId: "device-test",
    clientTimeMs: Date.now(),
    opId: "op-draft",
  }]);
  assert.equal(restored.days["2026-07-13"].journal, "");
  assert.equal(restored.days["2026-07-13"].journalDraft, "云端草稿");
});

test("an untouched database produces no cloud records and deletions restore defaults", () => {
  const state = createDefaultState();
  assert.equal(stateToRecords(state).size, 0);

  const item = state.days["2026-07-13"].items[0];
  const original = structuredClone(item);
  item.input = "临时内容";
  const [change] = diffRecords(new Map(), stateToRecords(state));
  assert.equal(change.entityKey.includes("/item/"), true);

  applyWireChanges(state, [{
    cursor: 1,
    entityKey: change.entityKey,
    valueJson: new Uint8Array(),
    deleted: true,
    deviceId: "device-test",
    clientTimeMs: Date.now(),
    opId: "op-delete",
  }]);
  assert.deepEqual(state.days["2026-07-13"].items[0], original);
  assert.equal(stateToRecords(state).size, 0);
});

test("page navigation is local-only and does not create a cloud diff", () => {
  const state = createDefaultState();
  state.preferences = {
    selectedDate: "2026-07-13",
  };
  const before = stateToRecords(state);
  state.preferences.selectedDate = "2026-07-20";
  const after = stateToRecords(state);
  assert.deepEqual(diffRecords(before, after), []);
});

test("minimal mode is a local-only preference and does not change cloud records", () => {
  const state = createDefaultState();
  state.preferences = {
    fontFamily: "lxgw-wenka",
    minimalMode: true,
    minimalModeOptOut: false,
  };
  const before = stateToRecords(state);
  state.preferences.minimalMode = false;
  state.preferences.minimalModeOptOut = true;
  const after = stateToRecords(state);

  assert.deepEqual(diffRecords(before, after), []);
});

test("hitokoto preferences and per-day binding round-trip through cloud records", () => {
  const beforeState = createDefaultState();
  beforeState.preferences = {
    fontFamily: "lxgw-wenka",
    quoteSource: "native",
    hitokotoCategories: [],
  };
  const afterState = structuredClone(beforeState);
  afterState.preferences.quoteSource = "hitokoto";
  afterState.preferences.hitokotoCategories = ["d", "i"];
  afterState.days["2026-07-13"].blessing.hitokoto = {
    uuid: "quote-uuid",
    hitokoto: "山川异域，风月同天。",
    type: "i",
    from: "绣袈裟衣缘",
    fromWho: null,
    boundAt: "2026-07-13T08:00:00.000Z",
  };

  const changes = diffRecords(stateToRecords(beforeState), stateToRecords(afterState));
  assert.deepEqual(changes.map((change) => change.entityKey), [
    "stella/v1/day/2026-07-13/blessing",
    "stella/v1/preference/hitokotoCategories",
    "stella/v1/preference/quoteSource",
  ]);

  applyWireChanges(beforeState, changes.map((change, index) => ({
    ...change,
    cursor: index + 1,
    valueJson: encodeJsonValue(change.value),
  })));
  assert.equal(beforeState.preferences.quoteSource, "hitokoto");
  assert.deepEqual(beforeState.preferences.hitokotoCategories, ["d", "i"]);
  assert.equal(beforeState.days["2026-07-13"].blessing.hitokoto.uuid, "quote-uuid");
});

test("legacy blessing sync cannot erase an existing hitokoto binding", () => {
  const state = createDefaultState();
  state.days["2026-07-17"].blessing.hitokoto = {
    uuid: "stable-quote-uuid",
    hitokoto: "慢慢来，谁还没有一个努力的过程。",
    type: "j",
    from: "网易云音乐",
    fromWho: "pony",
    boundAt: "2026-07-17T08:00:00.000Z",
  };

  applyWireChanges(state, [{
    cursor: 12,
    entityKey: "stella/v1/day/2026-07-17/blessing",
    valueJson: encodeJsonValue({ liked: true, likedAt: "2026-07-17T09:00:00.000Z", hitokoto: null }),
    deleted: false,
    deviceId: "legacy-device",
    clientTimeMs: Date.now(),
    opId: "legacy-blessing-write",
  }]);

  assert.equal(state.days["2026-07-17"].blessing.liked, true);
  assert.equal(state.days["2026-07-17"].blessing.hitokoto.uuid, "stable-quote-uuid");
});
