import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createAward, PRIZE_DEFINITIONS } from "../src/domain/raffle.js";
import {
  base64ToBytes,
  bytesToBase64,
  decodeJsonValue,
  decodeSyncResponse,
  encodeJsonValue,
  encodeSyncRequest,
} from "../src/sync/protocol.js";
import { signJwt } from "../worker/jwt.js";

const origin = new URL(process.env.WORKER_ORIGIN ?? "http://127.0.0.1:8787");
if (origin.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(origin.hostname)) {
  throw new Error("seed-raffle-account 仅允许写入 localhost Worker");
}

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
  iss: "http://localhost:5173",
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

async function exchange({ baselineId, cursor = 0, mutations = [], localVersion = 0 }) {
  const request = encodeSyncRequest({
    deviceId,
    cursor,
    mutations,
    pullLimit: 256,
    baselineId,
    localVersion,
    localUpdatedAtMs: Date.now(),
    localProgressDay: "2026-07-13",
  });
  const response = await fetch(new URL("/api/v1/sync/exchange", origin), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `stella_session=${encodeURIComponent(token)}`,
    },
    body: JSON.stringify({ protobuf: bytesToBase64(request) }),
  });
  const envelope = await response.json().catch(() => null);
  assert.equal(response.status, 200, `sync exchange failed: ${response.status} ${JSON.stringify(envelope)}`);
  return decodeSyncResponse(base64ToBytes(envelope.protobuf));
}

const probe = await exchange({ baselineId: probeBaseline });
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

const seeded = await exchange({
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
let cursor = 0;
for (let page = 0; page < 8; page += 1) {
  const response = await exchange({ baselineId, cursor, localVersion: seeded.serverVersion });
  for (const change of response.changes) {
    if (!change.deleted) pulled.set(change.entityKey, decodeJsonValue(change.valueJson));
  }
  cursor = response.nextCursor;
  if (!response.hasMore) break;
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
