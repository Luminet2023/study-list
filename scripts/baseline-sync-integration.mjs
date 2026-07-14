import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { signJwt } from "../worker/jwt.js";
import {
  BASELINE_CHOICE,
  base64ToBytes,
  bytesToBase64,
  decodeResolveBaselineResponse,
  decodeSyncResponse,
  encodeJsonValue,
  encodeResolveBaselineRequest,
  encodeSyncRequest,
} from "../src/sync/protocol.js";
import { SESSION_ISSUER, apiRequest } from "./api-config.mjs";

// 用法：可用 API_BASE_URL 与 FRONTEND_ORIGIN 切换 Go API 和两个获准的前端 origin。
const DEVICE_ID = "device_baseline_integration";
const BASELINE_A = "baseline_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BASELINE_B = "baseline_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const BASELINE_C = "baseline_cccccccccccccccccccccccccccccccc";

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

async function protobufPost(path, token, bytes) {
  const response = await apiRequest(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `stella_session=${encodeURIComponent(token)}`,
    },
    body: JSON.stringify({ protobuf: bytesToBase64(bytes) }),
  });
  const envelope = await response.json();
  assert.equal(response.status, 200, JSON.stringify(envelope));
  return base64ToBytes(envelope.protobuf);
}

async function exchange(token, baselineId, cursor = 0, mutations = []) {
  return decodeSyncResponse(await protobufPost(
    "v1/sync/exchange",
    token,
    encodeSyncRequest({
      deviceId: DEVICE_ID,
      cursor,
      mutations,
      pullLimit: 128,
      baselineId,
      localVersion: cursor,
      localUpdatedAtMs: Date.now(),
      localProgressDay: "2026-07-13",
    }),
  ));
}

async function resolve(token, request) {
  return decodeResolveBaselineResponse(await protobufPost(
    "v1/sync/resolve",
    token,
    encodeResolveBaselineRequest(request),
  ));
}

const devVars = parseDevVars(await readFile(new URL("../.dev.vars", import.meta.url), "utf8"));
const now = Math.floor(Date.now() / 1000);
const subject = `baseline-test-${crypto.randomUUID()}`;
const token = await signJwt({
  iss: SESSION_ISSUER,
  aud: "stellafortuna",
  sub: subject,
  iat: now,
  nbf: now - 5,
  exp: now + 600,
}, devVars.SESSION_JWT_SECRET);

const initialized = await exchange(token, BASELINE_A);
assert.equal(initialized.baselineId, BASELINE_A);
assert.equal(initialized.baselineMismatch, false);
assert.equal(initialized.serverVersion, 0);

const mismatch = await exchange(token, BASELINE_B);
assert.equal(mismatch.baselineMismatch, true);
assert.equal(mismatch.baselineId, BASELINE_A);
assert.equal(mismatch.serverVersion, 0, "基线不一致时不得写入服务端");

const keptServer = await resolve(token, {
  requestId: `resolve_${crypto.randomUUID().replaceAll("-", "")}`,
  deviceId: DEVICE_ID,
  localBaselineId: BASELINE_B,
  expectedServerBaselineId: BASELINE_A,
  expectedServerVersion: 0,
  choice: BASELINE_CHOICE.USE_SERVER,
  localSnapshot: [],
  localVersion: 1,
  localUpdatedAtMs: Date.now(),
  localProgressDay: "2026-07-14",
});
assert.equal(keptServer.stale, false);
assert.equal(keptServer.baselineId, BASELINE_A);
assert.equal(keptServer.serverVersion, 0);

const clientSnapshot = [{
  opId: `snapshot_${crypto.randomUUID().replaceAll("-", "")}`,
  entityKey: "stella/v1/day/2026-07-15/journal",
  baseVersion: 0,
  clientTimeMs: Date.now(),
  valueJson: encodeJsonValue("# 新设备进度"),
  deleted: false,
  deviceId: DEVICE_ID,
  clientSeq: 1,
}];
const keptClient = await resolve(token, {
  requestId: `resolve_${crypto.randomUUID().replaceAll("-", "")}`,
  deviceId: DEVICE_ID,
  localBaselineId: BASELINE_B,
  expectedServerBaselineId: BASELINE_A,
  expectedServerVersion: 0,
  choice: BASELINE_CHOICE.USE_LOCAL,
  localSnapshot: clientSnapshot,
  localVersion: 1,
  localUpdatedAtMs: Date.now(),
  localProgressDay: "2026-07-15",
});
assert.equal(keptClient.stale, false);
assert.equal(keptClient.baselineId, BASELINE_B);
assert.equal(keptClient.serverVersion, 1);
assert.equal(keptClient.serverCursor, 1);
assert.equal(keptClient.serverProgressDay, "2026-07-15");

const oldDevice = await exchange(token, BASELINE_A);
assert.equal(oldDevice.baselineMismatch, true);
assert.equal(oldDevice.baselineId, BASELINE_B);
assert.equal(oldDevice.serverVersion, 1);

const currentDevice = await exchange(token, BASELINE_B, 1);
assert.equal(currentDevice.baselineMismatch, false);
assert.equal(currentDevice.baselineId, BASELINE_B);
assert.equal(currentDevice.serverVersion, 1);

const clientOverwrite = await exchange(token, BASELINE_B, 1, [{
  opId: `overwrite_${crypto.randomUUID().replaceAll("-", "")}`,
  entityKey: "stella/v1/day/2026-07-15/journal",
  baseVersion: 1,
  clientTimeMs: Date.now(),
  valueJson: encodeJsonValue("# 客户端较新内容"),
  deleted: false,
  deviceId: DEVICE_ID,
  clientSeq: 2,
}]);
assert.equal(clientOverwrite.acks[0].applied, true);
assert.equal(clientOverwrite.acks[0].conflict, false, "同基线客户端覆盖不应计为冲突");
assert.equal(clientOverwrite.serverVersion, 2, "一个同步批次只增加一个逻辑版本");

const emptyMismatch = await exchange(token, BASELINE_C);
assert.equal(emptyMismatch.baselineMismatch, true);
assert.equal(emptyMismatch.serverVersion, 2);

const emptyClient = await resolve(token, {
  requestId: `resolve_${crypto.randomUUID().replaceAll("-", "")}`,
  deviceId: DEVICE_ID,
  localBaselineId: BASELINE_C,
  expectedServerBaselineId: BASELINE_B,
  expectedServerVersion: 2,
  choice: BASELINE_CHOICE.USE_LOCAL,
  localSnapshot: [],
  localVersion: 0,
  localUpdatedAtMs: 0,
  localProgressDay: "2026-07-13",
});
assert.equal(emptyClient.baselineId, BASELINE_C);
assert.equal(emptyClient.serverVersion, 0, "空白基线的逻辑版本应从 0 开始");
assert.equal(emptyClient.serverCursor, 0, "空白基线不应上传模板记录");
assert.equal(emptyClient.serverProgressDay, "2026-07-13");
assert.equal(emptyClient.records.length, 0);

console.log("baseline sync integration: passed");
