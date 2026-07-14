import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { signJwt } from "../worker/jwt.js";
import {
  bytesToBase64,
  decodeSyncResponse,
  base64ToBytes,
  encodeSyncRequest,
} from "../src/sync/protocol.js";

const ORIGIN = process.env.WORKER_ORIGIN ?? "http://127.0.0.1:8787";

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

async function session(token) {
  const response = await fetch(`${ORIGIN}/api/v1/auth/session`, {
    headers: { cookie: `stella_session=${encodeURIComponent(token)}` },
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.authenticated, true);
  return body.user;
}

const vars = parseDevVars(await readFile(new URL("../.dev.vars", import.meta.url), "utf8"));
const now = Math.floor(Date.now() / 1000);
const subject = `profile-test-${crypto.randomUUID()}`;
const firstToken = await signJwt({
  sub: subject,
  username: "first-user",
  name: "初始名称",
  avatarUrl: "https://example.com/first.png",
  email: "profile@example.com",
  iat: now,
  exp: now + 600,
}, vars.SESSION_JWT_SECRET);
const first = await session(firstToken);
assert.deepEqual(first, {
  id: subject,
  username: "first-user",
  name: "初始名称",
  avatarUrl: "https://example.com/first.png",
  email: "profile@example.com",
});

const updatedToken = await signJwt({
  sub: subject,
  username: "updated-user",
  name: "更新名称",
  avatarUrl: "https://example.com/updated.png",
  iat: now + 1,
  exp: now + 600,
}, vars.SESSION_JWT_SECRET);
const updated = await session(updatedToken);
assert.equal(updated.username, "updated-user");
assert.equal(updated.name, "更新名称");
assert.equal(updated.avatarUrl, "https://example.com/updated.png");
assert.equal(updated.email, "profile@example.com", "旧 Session 回填不得清空已保存邮箱");

const baselineId = `baseline_${crypto.randomUUID().replaceAll("-", "")}`;
const syncResponse = await fetch(`${ORIGIN}/api/v1/sync/exchange`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    cookie: `stella_session=${encodeURIComponent(updatedToken)}`,
  },
  body: JSON.stringify({
    protobuf: bytesToBase64(encodeSyncRequest({
      deviceId: `device_${crypto.randomUUID().replaceAll("-", "")}`,
      cursor: 0,
      mutations: [],
      pullLimit: 128,
      baselineId,
      localVersion: 0,
      localUpdatedAtMs: 0,
      localProgressDay: "2026-07-13",
    })),
  }),
});
const envelope = await syncResponse.json();
assert.equal(syncResponse.status, 200, JSON.stringify(envelope));
assert.equal(decodeSyncResponse(base64ToBytes(envelope.protobuf)).baselineId, baselineId);
assert.equal((await session(updatedToken)).id, subject, "用户资料与同一 Durable Object 学习数据关联");

console.log("user profile integration: passed");
