import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createAward, PRIZE_DEFINITIONS } from "../src/domain/raffle.js";
import {
  base64ToBytes,
  bytesToBase64,
  decodeDiffResponse,
  decodeJsonValue,
  decodeSyncResponse,
  encodeDiffRequest,
  encodeJsonValue,
} from "../src/sync/protocol.js";
import { createSseParser } from "../src/sync/sseTransport.js";
import { signJwt } from "../worker/jwt.js";
import { SESSION_ISSUER, apiRequest } from "./api-config.mjs";

// 用法：TARGET_LINUXDO_SUB=<数字 ID> node scripts/seed-raffle-account.mjs。
// API_BASE_URL 默认生产 Go API；FRONTEND_ORIGIN 可在两个获准的生产 origin 间切换。

const targetSub = String(process.env.TARGET_LINUXDO_SUB ?? "").trim();
if (!/^\d+$/u.test(targetSub)) throw new Error("TARGET_LINUXDO_SUB 必须是 Linux DO 数字 user.id");

const batchId = String(process.env.SEED_BATCH_ID ?? "all_prizes_v1").trim();
if (!/^[A-Za-z0-9_-]{8,48}$/u.test(batchId)) {
  throw new Error("SEED_BATCH_ID 仅允许 8-48 位字母、数字、下划线或连字符");
}

function parseDevVars(source) {
  return Object.fromEntries(source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1).replace(/^['"]|['"]$/gu, "")];
    }));
}

const devVars = parseDevVars(await readFile(new URL("../.dev.vars", import.meta.url), "utf8"));
if (!devVars.SESSION_JWT_SECRET) throw new Error(".dev.vars 缺少 SESSION_JWT_SECRET");

const nowSeconds = Math.floor(Date.now() / 1000);
const token = await signJwt({
  iss: SESSION_ISSUER,
  aud: "stellafortuna",
  sub: targetSub,
  username: "Luminet",
  name: "Luminet",
  iat: nowSeconds,
  nbf: nowSeconds - 5,
  exp: nowSeconds + 10 * 60,
}, devVars.SESSION_JWT_SECRET);

const deviceId = `device_raffle_seed_${batchId}`;
const probeBaseline = `baseline_${crypto.randomUUID().replaceAll("-", "")}`;
let clientSeq = 0;

async function diff({ baselineId, mutations = [], localVersion = 0 }) {
  const request = encodeDiffRequest({
    deviceId,
    mutations,
    baselineId,
    localVersion,
    localUpdatedAtMs: Date.now(),
    localProgressDay: "2026-07-13",
  });
  const response = await apiRequest("v1/sync/diff", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `stella_session=${encodeURIComponent(token)}`,
    },
    body: JSON.stringify({ protobuf: bytesToBase64(request) }),
  });
  const envelope = await response.json().catch(() => null);
  assert.equal(response.status, 200, `sync diff failed: ${response.status} ${JSON.stringify(envelope)}`);
  return decodeDiffResponse(base64ToBytes(envelope.protobuf));
}

async function readSseSnapshot(baselineId, cursor = 0) {
  const response = await apiRequest(
    `v1/sync/events?baselineId=${encodeURIComponent(baselineId)}&cursor=${cursor}`,
    {
      headers: {
        accept: "text/event-stream",
        cookie: `stella_session=${encodeURIComponent(token)}`,
      },
    },
  );
  assert.equal(response.status, 200, `sync events failed: ${response.status}`);
  assert.ok(response.body?.getReader, "sync events response is not a readable stream");
  const reader = response.body.getReader();
  const parser = createSseParser();
  const changes = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error("sync events closed before ready");
      for (const event of parser.feed(value)) {
        if (!["changes", "ready"].includes(event.type)) {
          throw new Error(`unexpected sync event: ${event.type}`);
        }
        const envelope = JSON.parse(event.data);
        assert.equal(envelope.version, 1);
        const message = decodeSyncResponse(base64ToBytes(envelope.protobuf));
        changes.push(...message.changes);
        cursor = message.nextCursor;
        if (event.type === "ready") return { changes, cursor };
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

const probe = await diff({ baselineId: probeBaseline });
const baselineId = probe.baselineId || probeBaseline;
const drawDate = "2026-07-13";
const createdAt = new Date().toISOString();
const prizes = PRIZE_DEFINITIONS.filter((prize) => prize.id !== "none");
const expectedKeys = new Set();
const mutations = [];

function addMutation(entityKey, value, suffix) {
  clientSeq += 1;
  expectedKeys.add(entityKey);
  mutations.push({
    opId: `seed_${batchId}_${suffix}`,
    entityKey,
    baseVersion: 0,
    clientTimeMs: Date.now() + clientSeq,
    valueJson: encodeJsonValue(value),
    deleted: false,
    deviceId,
    clientSeq,
  });
}

for (const prize of prizes) {
  const safePrizeId = prize.id.replaceAll(":", "_");
  const drawId = `seed:${batchId}:${prize.id}`;
  const awardId = `${drawId}:award`;
  const award = {
    ...createAward(prize.id, drawDate, awardId),
    drawId,
    redeemedAt: null,
  };
  const draw = {
    id: drawId,
    drawDate,
    prizeId: prize.id,
    label: prize.label,
    mode: "test-grant",
    createdAt,
    awardId,
    redeemedAt: null,
  };
  addMutation(
    `stella/v1/raffle/draw/${encodeURIComponent(drawId)}`,
    draw,
    `draw_${safePrizeId}`,
  );
  addMutation(
    `stella/v1/raffle/award/${encodeURIComponent(awardId)}`,
    award,
    `award_${safePrizeId}`,
  );
}

const seeded = await diff({
  baselineId,
  mutations,
  localVersion: probe.serverVersion,
});
assert.equal(seeded.baselineMismatch, false, "seed 时出现 baseline mismatch");
assert.equal(seeded.acks.length, mutations.length, "seed ack 数量不完整");
for (const ack of seeded.acks) {
  assert.equal(ack.conflict, false, `${ack.opId} 发生冲突`);
  assert.equal(ack.applied, true, `${ack.opId} 未写入`);
}

const pulled = new Map();
const snapshot = await readSseSnapshot(baselineId);
for (const change of snapshot.changes) {
  if (!change.deleted) pulled.set(change.entityKey, decodeJsonValue(change.valueJson));
}

for (const entityKey of expectedKeys) assert.equal(pulled.has(entityKey), true, `未拉回 ${entityKey}`);
console.log(JSON.stringify({
  status: "seeded",
  targetSub,
  baselineId,
  prizeCount: prizes.length,
  drawCount: prizes.length,
  awardCount: prizes.length,
  lifecycle: "pending-redemption",
}, null, 2));
