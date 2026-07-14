import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import { signJwt, sha256Hex } from "../../worker/jwt.js";
import {
  BASELINE_CHOICE,
  base64ToBytes,
  bytesToBase64,
  decodeResolveBaselineResponse,
  decodeSyncResponse,
  encodeJsonValue,
  encodeResolveBaselineRequest,
  encodeSyncRequest,
} from "../../src/sync/protocol.js";
import {
  MAX_WEBSOCKET_FRAME_BYTES,
  SYNC_WEBSOCKET_PROTOCOL,
  decodeServerFrame,
  encodeActivityFrame,
  encodeClientFrame,
} from "../../src/sync/webSocketFrames.js";

const ORIGIN = "https://study.example.test";
const WS_URL = `${ORIGIN}/api/v1/sync/ws`;
const BASELINE_ID = "baseline_0123456789abcdef0123456789abcdef";
const ALTERNATE_BASELINE_ID = "baseline_abcdef0123456789abcdef0123456789";
const SESSION_SECRET = "test-session-secret-0123456789abcdef0123456789abcdef";
const openSockets = new Set();

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sessionCookie(subject, options = {}) {
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt({
    iss: ORIGIN,
    aud: "stellafortuna",
    sub: subject,
    username: subject,
    iat: now,
    nbf: now - 1,
    exp: options.exp ?? now + 300,
  }, SESSION_SECRET);
  return `stella_session=${encodeURIComponent(token)}`;
}

async function handshake(subject, options = {}) {
  const headers = new Headers(options.headers);
  if (options.origin !== null) headers.set("origin", options.origin ?? ORIGIN);
  if (options.upgrade !== null) headers.set("upgrade", options.upgrade ?? "websocket");
  if (options.protocol !== null) {
    headers.set("sec-websocket-protocol", options.protocol ?? SYNC_WEBSOCKET_PROTOCOL);
  }
  if (options.cookie !== null) {
    headers.set("cookie", options.cookie ?? await sessionCookie(subject, { exp: options.exp }));
  }
  return SELF.fetch(WS_URL, {
    method: options.method ?? "GET",
    headers,
  });
}

async function openWebSocket(subject, options = {}) {
  const response = await handshake(subject, options);
  expect(response.status).toBe(101);
  expect(response.headers.get("sec-websocket-protocol")).toBe(SYNC_WEBSOCKET_PROTOCOL);
  expect(response.webSocket).not.toBeNull();
  const webSocket = response.webSocket;
  webSocket.accept();
  openSockets.add(webSocket);
  return webSocket;
}

function socketInbox(webSocket) {
  const messages = [];
  const waiters = new Set();

  function settle() {
    for (const waiter of waiters) {
      const index = messages.findIndex(waiter.predicate);
      if (index < 0) continue;
      const [frame] = messages.splice(index, 1);
      waiters.delete(waiter);
      clearTimeout(waiter.timeout);
      waiter.resolve(frame);
    }
  }

  webSocket.addEventListener("message", (event) => {
    messages.push(decodeServerFrame(event.data));
    settle();
  });

  return {
    next(predicate = () => true, timeoutMs = 2_000) {
      const queuedIndex = messages.findIndex(predicate);
      if (queuedIndex >= 0) {
        const [frame] = messages.splice(queuedIndex, 1);
        return Promise.resolve(frame);
      }
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          timeout: setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error("timed out waiting for WebSocket frame"));
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
    async expectNoMessage(predicate = () => true, timeoutMs = 150) {
      await expect(this.next(predicate, timeoutMs)).rejects.toThrow("timed out");
    },
  };
}

function waitForClose(webSocket, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timed out waiting for WebSocket close")), timeoutMs);
    webSocket.addEventListener("close", (event) => {
      clearTimeout(timeout);
      openSockets.delete(webSocket);
      resolve(event);
    }, { once: true });
  });
}

function syncRequest({
  deviceId = "device_alpha",
  cursor = 0,
  mutations = [],
  baselineId = BASELINE_ID,
  pullLimit = 128,
} = {}) {
  return encodeSyncRequest({
    deviceId,
    cursor,
    mutations,
    pullLimit,
    baselineId,
    localVersion: 0,
    localUpdatedAtMs: 0,
    localProgressDay: "2026-07-13",
  });
}

function mutation({
  deviceId = "device_alpha",
  opId = "operation_alpha_0001",
  entityKey = "stella/v1/day/2026-07-13/journal",
  value = "runtime-test",
  baseVersion = 0,
  clientSeq = 1,
} = {}) {
  return {
    opId,
    entityKey,
    baseVersion,
    clientTimeMs: Date.now(),
    valueJson: encodeJsonValue(value),
    deleted: false,
    deviceId,
    clientSeq,
  };
}

function sendExchange(webSocket, bytes, requestId) {
  webSocket.send(encodeClientFrame("exchange", bytes, requestId));
}

function sendResolve(webSocket, bytes, requestId) {
  webSocket.send(encodeClientFrame("resolve", bytes, requestId));
}

function sendActivity(webSocket, active) {
  webSocket.send(encodeActivityFrame(active));
}

afterEach(() => {
  for (const webSocket of openSockets) {
    try {
      webSocket.close(1000, "test complete");
    } catch {
      // The peer may already have closed the connection under test.
    }
  }
  openSockets.clear();
});

describe("sync WebSocket handshake", () => {
  it("rejects method, upgrade, origin, session, and subprotocol violations before upgrade", async () => {
    // workerd normalizes a request carrying Upgrade: websocket to GET, so omit
    // Upgrade here to exercise the Worker's method guard itself.
    const method = await handshake("handshake-method", { method: "POST", upgrade: null });
    expect(method.status).toBe(405);
    expect(method.headers.get("allow")).toBe("GET");

    const upgrade = await handshake("handshake-upgrade", { upgrade: null });
    expect(upgrade.status).toBe(426);
    expect(upgrade.headers.get("upgrade")).toBe("websocket");

    const origin = await handshake("handshake-origin", { origin: "https://evil.example" });
    expect(origin.status).toBe(403);

    const missingOrigin = await handshake("handshake-origin-missing", { origin: null });
    expect(missingOrigin.status).toBe(403);

    const session = await handshake("handshake-session", { cookie: null });
    expect(session.status).toBe(401);

    const protocol = await handshake("handshake-protocol", { protocol: "other-protocol" });
    expect(protocol.status).toBe(400);

    const missingProtocol = await handshake("handshake-protocol-missing", { protocol: null });
    expect(missingProtocol.status).toBe(400);
  });

  it("accepts a valid session and negotiates stella-sync-v1", async () => {
    const webSocket = await openWebSocket("handshake-success");
    expect(webSocket.readyState).toBe(WebSocket.OPEN);
  });

  it("limits one user's coordinator to eight simultaneous connections", async () => {
    const subject = "connection-limit";
    for (let index = 0; index < 8; index += 1) {
      await openWebSocket(subject);
    }
    const response = await handshake(subject);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("5");
  });
});

describe("sync WebSocket transport", () => {
  it("pushes a hint to a sibling connection, then lets it pull the durable change", async () => {
    const writer = await openWebSocket("same-user");
    const reader = await openWebSocket("same-user");
    const writerInbox = socketInbox(writer);
    const readerInbox = socketInbox(reader);

    sendExchange(writer, syncRequest({ mutations: [mutation()] }), "request_write_0001");
    const result = await writerInbox.next((frame) => frame.requestId === "request_write_0001");
    const hint = await readerInbox.next((frame) => frame.type === "sync_hint");

    expect(result.type).toBe("exchange_result");
    const writeResponse = decodeSyncResponse(result.protobuf);
    expect(writeResponse.acks).toMatchObject([{ opId: "operation_alpha_0001", applied: true }]);
    expect(hint).toMatchObject({
      type: "sync_hint",
      baselineId: BASELINE_ID,
      serverCursor: 1,
      serverVersion: 1,
    });

    sendExchange(
      reader,
      syncRequest({ deviceId: "device_beta", cursor: 0 }),
      "request_pull_00001",
    );
    const pull = await readerInbox.next((frame) => frame.requestId === "request_pull_00001");
    const pullResponse = decodeSyncResponse(pull.protobuf);
    expect(pullResponse.nextCursor).toBe(1);
    expect(pullResponse.changes).toHaveLength(1);
    expect(pullResponse.changes[0]).toMatchObject({
      entityKey: "stella/v1/day/2026-07-13/journal",
      opId: "operation_alpha_0001",
    });
  });

  it("isolates hints and records between different users", async () => {
    const writer = await openWebSocket("isolated-user-a");
    const other = await openWebSocket("isolated-user-b");
    const writerInbox = socketInbox(writer);
    const otherInbox = socketInbox(other);

    sendExchange(writer, syncRequest({ mutations: [mutation()] }), "request_isolate_a1");
    await writerInbox.next((frame) => frame.requestId === "request_isolate_a1");
    await otherInbox.expectNoMessage((frame) => frame.type === "sync_hint");

    sendExchange(
      other,
      syncRequest({ deviceId: "device_beta", cursor: 0 }),
      "request_isolate_b1",
    );
    const pull = await otherInbox.next((frame) => frame.requestId === "request_isolate_b1");
    const response = decodeSyncResponse(pull.protobuf);
    expect(response.nextCursor).toBe(0);
    expect(response.changes).toEqual([]);
  });

  it("keeps inactive connections open without hints and resumes hints when active", async () => {
    const subject = "activity-user";
    const reader = await openWebSocket(subject);
    const writer = await openWebSocket(subject);
    const readerInbox = socketInbox(reader);
    const writerInbox = socketInbox(writer);

    sendActivity(reader, false);
    sendExchange(
      reader,
      syncRequest({ deviceId: "device_reader" }),
      "request_inactive_barrier",
    );
    await readerInbox.next((frame) => frame.requestId === "request_inactive_barrier");

    sendExchange(
      writer,
      syncRequest({ mutations: [mutation({ opId: "operation_inactive_0001" })] }),
      "request_inactive_write_1",
    );
    await writerInbox.next((frame) => frame.requestId === "request_inactive_write_1");
    await readerInbox.expectNoMessage((frame) => frame.type === "sync_hint");
    expect(reader.readyState).toBe(WebSocket.OPEN);

    sendActivity(reader, true);
    sendExchange(
      reader,
      syncRequest({ deviceId: "device_reader", cursor: 0 }),
      "request_resume_pull_0001",
    );
    const resumedPullFrame = await readerInbox.next(
      (frame) => frame.requestId === "request_resume_pull_0001",
    );
    const resumedPull = decodeSyncResponse(resumedPullFrame.protobuf);
    expect(resumedPull.nextCursor).toBe(1);
    expect(resumedPull.changes).toMatchObject([{ opId: "operation_inactive_0001" }]);

    sendExchange(
      writer,
      syncRequest({
        mutations: [mutation({
          opId: "operation_active_0002",
          entityKey: "stella/v1/preference/fontFamily",
          value: "system",
          clientSeq: 2,
        })],
      }),
      "request_active_write_02",
    );
    await writerInbox.next((frame) => frame.requestId === "request_active_write_02");
    const hint = await readerInbox.next((frame) => frame.type === "sync_hint");
    expect(hint).toMatchObject({
      type: "sync_hint",
      serverCursor: 2,
    });
    expect(reader.readyState).toBe(WebSocket.OPEN);
  });

  it("preserves hibernatable connections and attachments across Durable Object eviction", async () => {
    const subject = "hibernation-user";
    const writer = await openWebSocket(subject);
    const reader = await openWebSocket(subject);
    const writerInbox = socketInbox(writer);
    const readerInbox = socketInbox(reader);
    const ownerKey = await sha256Hex(`linuxdo:${subject}`);
    const coordinator = env.USER_SYNC.getByName(ownerKey);

    await evictDurableObject(coordinator, { webSockets: "hibernate" });

    sendExchange(
      writer,
      syncRequest({ mutations: [mutation({ opId: "operation_after_evict" })] }),
      "request_evict_0001",
    );
    const result = await writerInbox.next((frame) => frame.requestId === "request_evict_0001");
    const hint = await readerInbox.next((frame) => frame.type === "sync_hint");
    expect(decodeSyncResponse(result.protobuf).acks[0]).toMatchObject({
      opId: "operation_after_evict",
      applied: true,
    });
    expect(hint).toMatchObject({ serverCursor: 1, serverVersion: 1 });
  });

  it("preserves inactive hint suppression across Durable Object eviction", async () => {
    const subject = "inactive-hibernation-user";
    const reader = await openWebSocket(subject);
    const writer = await openWebSocket(subject);
    const readerInbox = socketInbox(reader);
    const writerInbox = socketInbox(writer);
    const ownerKey = await sha256Hex(`linuxdo:${subject}`);
    const coordinator = env.USER_SYNC.getByName(ownerKey);

    sendActivity(reader, false);
    sendExchange(
      reader,
      syncRequest({ deviceId: "device_reader" }),
      "request_inactive_evict_barrier",
    );
    await readerInbox.next((frame) => frame.requestId === "request_inactive_evict_barrier");
    await evictDurableObject(coordinator, { webSockets: "hibernate" });

    sendExchange(
      writer,
      syncRequest({ mutations: [mutation({ opId: "operation_inactive_evict" })] }),
      "request_inactive_evict_write",
    );
    await writerInbox.next((frame) => frame.requestId === "request_inactive_evict_write");
    await readerInbox.expectNoMessage((frame) => frame.type === "sync_hint");
    expect(reader.readyState).toBe(WebSocket.OPEN);

    sendActivity(reader, true);
    sendExchange(
      reader,
      syncRequest({ deviceId: "device_reader", cursor: 0 }),
      "request_evict_resume_pull",
    );
    const resumedPullFrame = await readerInbox.next(
      (frame) => frame.requestId === "request_evict_resume_pull",
    );
    const resumedPull = decodeSyncResponse(resumedPullFrame.protobuf);
    expect(resumedPull.nextCursor).toBe(1);
    expect(resumedPull.changes).toMatchObject([{ opId: "operation_inactive_evict" }]);
  });

  it("broadcasts legacy HTTP writes and returns byte-equivalent results for WebSocket replay", async () => {
    const subject = "transport-equivalence";
    const webSocket = await openWebSocket(subject);
    const inbox = socketInbox(webSocket);
    const cookie = await sessionCookie(subject);
    const requestBytes = syncRequest({
      mutations: [mutation({ opId: "operation_equivalent" })],
    });

    const legacyResponse = await SELF.fetch(`${ORIGIN}/api/v1/sync/exchange`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: ORIGIN,
      },
      body: JSON.stringify({ protobuf: bytesToBase64(requestBytes) }),
    });
    expect(legacyResponse.status).toBe(200);
    const legacyBytes = base64ToBytes((await legacyResponse.json()).protobuf);
    const legacyHint = await inbox.next((message) => message.type === "sync_hint");
    expect(legacyHint).toMatchObject({
      baselineId: BASELINE_ID,
      serverCursor: 1,
      serverVersion: 1,
    });

    sendExchange(webSocket, requestBytes, "request_equiv_0001");
    const frame = await inbox.next((message) => message.requestId === "request_equiv_0001");
    expect([...frame.protobuf]).toEqual([...legacyBytes]);
  });
});

describe("sync WebSocket durable state semantics", () => {
  it("replays an acknowledged opId without advancing the durable head", async () => {
    const webSocket = await openWebSocket("op-replay-user");
    const inbox = socketInbox(webSocket);
    const requestBytes = syncRequest({
      mutations: [mutation({ opId: "operation_replay_0001" })],
    });

    sendExchange(webSocket, requestBytes, "request_replay_001");
    const firstFrame = await inbox.next((frame) => frame.requestId === "request_replay_001");
    const first = decodeSyncResponse(firstFrame.protobuf);

    sendExchange(webSocket, requestBytes, "request_replay_002");
    const replayFrame = await inbox.next((frame) => frame.requestId === "request_replay_002");
    const replay = decodeSyncResponse(replayFrame.protobuf);

    expect(first.acks[0]).toMatchObject({
      opId: "operation_replay_0001",
      serverCursor: 1,
      applied: true,
      conflict: false,
    });
    expect(replay.acks[0]).toEqual(first.acks[0]);
    expect(replay.nextCursor).toBe(1);
    expect(replay.serverVersion).toBe(1);
    expect(replay.changes).toHaveLength(1);
  });

  it("rejects a stale baseVersion as a conflict and returns the server record", async () => {
    const webSocket = await openWebSocket("conflict-user");
    const inbox = socketInbox(webSocket);

    sendExchange(
      webSocket,
      syncRequest({
        mutations: [mutation({ opId: "operation_conflict_first", value: "server-value" })],
      }),
      "request_conflict_01",
    );
    await inbox.next((frame) => frame.requestId === "request_conflict_01");

    sendExchange(
      webSocket,
      syncRequest({
        deviceId: "device_beta",
        cursor: 1,
        mutations: [mutation({
          deviceId: "device_beta",
          opId: "operation_conflict_stale",
          value: "stale-client-value",
          baseVersion: 0,
        })],
      }),
      "request_conflict_02",
    );
    const conflictFrame = await inbox.next((frame) => frame.requestId === "request_conflict_02");
    const conflict = decodeSyncResponse(conflictFrame.protobuf);

    expect(conflict.acks[0]).toMatchObject({
      opId: "operation_conflict_stale",
      serverCursor: 1,
      applied: false,
      conflict: true,
    });
    expect(conflict.serverVersion).toBe(1);
    expect(conflict.changes).toHaveLength(1);
    expect(conflict.changes[0].opId).toBe("operation_conflict_first");
  });

  it("paginates pulls by pullLimit and marks a cursor beyond head for reset", async () => {
    const webSocket = await openWebSocket("pagination-user");
    const inbox = socketInbox(webSocket);
    const mutations = [
      mutation({
        opId: "operation_page_0001",
        entityKey: "stella/v1/day/2026-07-13/journal",
        clientSeq: 1,
      }),
      mutation({
        opId: "operation_page_0002",
        entityKey: "stella/v1/preference/fontFamily",
        value: "system",
        clientSeq: 2,
      }),
      mutation({
        opId: "operation_page_0003",
        entityKey: "stella/v1/day/2026-07-13/blessing",
        value: { liked: true },
        clientSeq: 3,
      }),
    ];

    sendExchange(webSocket, syncRequest({ mutations }), "request_page_write");
    await inbox.next((frame) => frame.requestId === "request_page_write");

    const pages = [];
    for (const [cursor, requestId] of [
      [0, "request_page_0001"],
      [1, "request_page_0002"],
      [2, "request_page_0003"],
    ]) {
      sendExchange(
        webSocket,
        syncRequest({ deviceId: "device_beta", cursor, pullLimit: 1 }),
        requestId,
      );
      const frame = await inbox.next((message) => message.requestId === requestId);
      pages.push(decodeSyncResponse(frame.protobuf));
    }

    expect(pages.map((page) => page.nextCursor)).toEqual([1, 2, 3]);
    expect(pages.map((page) => page.hasMore)).toEqual([true, true, false]);
    expect(pages.flatMap((page) => page.changes.map((change) => change.opId))).toEqual([
      "operation_page_0001",
      "operation_page_0002",
      "operation_page_0003",
    ]);

    sendExchange(
      webSocket,
      syncRequest({ deviceId: "device_beta", cursor: 99, pullLimit: 1 }),
      "request_reset_0001",
    );
    const resetFrame = await inbox.next((frame) => frame.requestId === "request_reset_0001");
    const resetResponse = decodeSyncResponse(resetFrame.protobuf);
    expect(resetResponse.resetRequired).toBe(true);
    expect(resetResponse.changes).toEqual([]);
    expect(resetResponse.serverVersion).toBe(1);
  });

  it("reports the durable server lineage when the requested baseline mismatches", async () => {
    const webSocket = await openWebSocket("baseline-mismatch-user");
    const inbox = socketInbox(webSocket);

    sendExchange(webSocket, syncRequest(), "request_lineage_001");
    await inbox.next((frame) => frame.requestId === "request_lineage_001");

    sendExchange(
      webSocket,
      syncRequest({ baselineId: ALTERNATE_BASELINE_ID }),
      "request_lineage_002",
    );
    const mismatchFrame = await inbox.next((frame) => frame.requestId === "request_lineage_002");
    const mismatch = decodeSyncResponse(mismatchFrame.protobuf);
    expect(mismatch).toMatchObject({
      baselineMismatch: true,
      baselineId: BASELINE_ID,
      serverVersion: 0,
      nextCursor: 0,
    });
  });

  it("applies USE_SERVER only for the expected server version and reports stale CAS", async () => {
    const webSocket = await openWebSocket("resolve-server-user");
    const inbox = socketInbox(webSocket);
    sendExchange(
      webSocket,
      syncRequest({ mutations: [mutation({ opId: "operation_server_record" })] }),
      "request_server_seed",
    );
    await inbox.next((frame) => frame.requestId === "request_server_seed");

    const useServerBytes = encodeResolveBaselineRequest({
      requestId: "resolution_server_0001",
      deviceId: "device_alpha",
      localBaselineId: ALTERNATE_BASELINE_ID,
      expectedServerBaselineId: BASELINE_ID,
      expectedServerVersion: 1,
      choice: BASELINE_CHOICE.USE_SERVER,
      localSnapshot: [],
      localVersion: 8,
      localUpdatedAtMs: Date.now(),
      localProgressDay: "2026-07-14",
    });
    sendResolve(webSocket, useServerBytes, "request_use_server_01");
    const serverFrame = await inbox.next((frame) => frame.requestId === "request_use_server_01");
    const serverResult = decodeResolveBaselineResponse(serverFrame.protobuf);
    expect(serverResult).toMatchObject({
      baselineId: BASELINE_ID,
      serverVersion: 1,
      serverCursor: 1,
      stale: false,
    });
    expect(serverResult.records[0].opId).toBe("operation_server_record");

    const staleBytes = encodeResolveBaselineRequest({
      requestId: "resolution_server_stale",
      deviceId: "device_alpha",
      localBaselineId: ALTERNATE_BASELINE_ID,
      expectedServerBaselineId: BASELINE_ID,
      expectedServerVersion: 0,
      choice: BASELINE_CHOICE.USE_SERVER,
      localSnapshot: [],
      localVersion: 8,
      localUpdatedAtMs: Date.now(),
      localProgressDay: "2026-07-14",
    });
    sendResolve(webSocket, staleBytes, "request_use_server_02");
    const staleFrame = await inbox.next((frame) => frame.requestId === "request_use_server_02");
    const staleResult = decodeResolveBaselineResponse(staleFrame.protobuf);
    expect(staleResult).toMatchObject({
      baselineId: BASELINE_ID,
      serverVersion: 1,
      serverCursor: 1,
      stale: true,
      records: [],
    });
  });

  it("applies USE_LOCAL with CAS and replays the same business requestId idempotently", async () => {
    const webSocket = await openWebSocket("resolve-local-user");
    const inbox = socketInbox(webSocket);
    sendExchange(
      webSocket,
      syncRequest({ mutations: [mutation({ opId: "operation_old_server" })] }),
      "request_local_seed",
    );
    await inbox.next((frame) => frame.requestId === "request_local_seed");

    const resolutionBytes = encodeResolveBaselineRequest({
      requestId: "resolution_local_0001",
      deviceId: "device_alpha",
      localBaselineId: ALTERNATE_BASELINE_ID,
      expectedServerBaselineId: BASELINE_ID,
      expectedServerVersion: 1,
      choice: BASELINE_CHOICE.USE_LOCAL,
      localSnapshot: [mutation({
        opId: "operation_local_snapshot",
        entityKey: "stella/v1/day/2026-07-14/journal",
        value: "local-wins",
      })],
      localVersion: 3,
      localUpdatedAtMs: Date.now(),
      localProgressDay: "2026-07-14",
    });

    sendResolve(webSocket, resolutionBytes, "request_use_local_001");
    const firstFrame = await inbox.next((frame) => frame.requestId === "request_use_local_001");
    const first = decodeResolveBaselineResponse(firstFrame.protobuf);
    expect(first).toMatchObject({
      baselineId: ALTERNATE_BASELINE_ID,
      serverVersion: 1,
      serverCursor: 1,
      stale: false,
    });
    expect(first.records).toHaveLength(1);
    expect(first.records[0].opId).toBe("operation_local_snapshot");

    sendResolve(webSocket, resolutionBytes, "request_use_local_002");
    const replayFrame = await inbox.next((frame) => frame.requestId === "request_use_local_002");
    const replay = decodeResolveBaselineResponse(replayFrame.protobuf);
    expect(replay).toEqual(first);
  });

  it("returns RATE_LIMITED with retryAfterMs without closing the connection", async () => {
    const subject = "rate-limit-user";
    const webSocket = await openWebSocket(subject);
    const inbox = socketInbox(webSocket);

    for (let index = 0; index < 8; index += 1) {
      const requestId = `request_rate_${String(index).padStart(4, "0")}`;
      sendExchange(webSocket, syncRequest(), requestId);
      const frame = await inbox.next((message) => message.requestId === requestId);
      expect(frame.type).toBe("exchange_result");
    }

    sendExchange(webSocket, syncRequest(), "request_rate_limited");
    const limited = await inbox.next((frame) => frame.requestId === "request_rate_limited");
    expect(limited).toMatchObject({ type: "error", code: "RATE_LIMITED" });
    expect(limited.retryAfterMs).toBeGreaterThan(0);
    expect(webSocket.readyState).toBe(WebSocket.OPEN);

    const ownerKey = await sha256Hex(`linuxdo:${subject}`);
    const coordinator = env.USER_SYNC.getByName(ownerKey);
    await runInDurableObject(coordinator, (_instance, state) => {
      state.storage.sql.exec("DELETE FROM request_rate_limit");
    });

    sendExchange(webSocket, syncRequest(), "request_rate_recovered");
    const recovered = await inbox.next((frame) => frame.requestId === "request_rate_recovered");
    expect(recovered.type).toBe("exchange_result");
    expect(webSocket.readyState).toBe(WebSocket.OPEN);
  });
});

describe("sync WebSocket close and error semantics", () => {
  it.each([
    { label: "malformed JSON", payload: "{", expectedCode: 1007 },
    { label: "binary data", payload: new Uint8Array([1, 2, 3]), expectedCode: 1003 },
    {
      label: "an oversized frame",
      payload: "x".repeat(MAX_WEBSOCKET_FRAME_BYTES + 1),
      expectedCode: 1009,
    },
  ])("closes $label with code $expectedCode", async ({ payload, expectedCode }) => {
    const webSocket = await openWebSocket(`invalid-frame-${expectedCode}`);
    const closed = waitForClose(webSocket);
    webSocket.send(payload);
    expect((await closed).code).toBe(expectedCode);
  });

  it("reports AUTH_REQUIRED and closes with 4001 after the accepted session expires", async () => {
    const exp = Math.floor(Date.now() / 1000) + 2;
    const webSocket = await openWebSocket("expiring-session", { exp });
    const inbox = socketInbox(webSocket);
    const closed = waitForClose(webSocket, 4_000);

    await delay(2_100);
    sendExchange(webSocket, syncRequest(), "request_expired_01");

    const error = await inbox.next((frame) => frame.type === "error", 3_000);
    expect(error).toMatchObject({ type: "error", code: "AUTH_REQUIRED" });
    expect((await closed).code).toBe(4001);
  });
});
