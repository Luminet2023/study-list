import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { signJwt } from "../worker/jwt.js";
import {
  bytesToBase64,
  decodeDiffResponse,
  base64ToBytes,
  encodeDiffRequest,
} from "../src/sync/protocol.js";
import { SESSION_ISSUER, apiRequest } from "./api-config.mjs";

// 用法：可用 API_BASE_URL 与 FRONTEND_ORIGIN 切换 Go API 和两个获准的前端 origin。

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
  const response = await apiRequest("v1/auth/session", {
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
  iss: SESSION_ISSUER,
  aud: "stellafortuna",
  sub: subject,
  username: "first-user",
  name: "初始名称",
  avatarUrl: "https://example.com/first.png",
  email: "profile@example.com",
  iat: now,
  nbf: now - 5,
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
  iss: SESSION_ISSUER,
  aud: "stellafortuna",
  sub: subject,
  username: "updated-user",
  name: "更新名称",
  avatarUrl: "https://example.com/updated.png",
  iat: now + 1,
  nbf: now - 5,
  exp: now + 600,
}, vars.SESSION_JWT_SECRET);
const updated = await session(updatedToken);
assert.equal(updated.username, "updated-user");
assert.equal(updated.name, "更新名称");
assert.equal(updated.avatarUrl, "https://example.com/updated.png");
assert.equal(updated.email, "profile@example.com", "旧 Session 回填不得清空已保存邮箱");

const baselineId = `baseline_${crypto.randomUUID().replaceAll("-", "")}`;
const syncResponse = await apiRequest("v1/sync/diff", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    cookie: `stella_session=${encodeURIComponent(updatedToken)}`,
  },
  body: JSON.stringify({
    protobuf: bytesToBase64(encodeDiffRequest({
      deviceId: `device_${crypto.randomUUID().replaceAll("-", "")}`,
      mutations: [],
      baselineId,
      localVersion: 0,
      localUpdatedAtMs: 0,
      localProgressDay: "2026-07-13",
    })),
  }),
});
const envelope = await syncResponse.json();
assert.equal(syncResponse.status, 200, JSON.stringify(envelope));
assert.equal(decodeDiffResponse(base64ToBytes(envelope.protobuf)).baselineId, baselineId);
assert.equal((await session(updatedToken)).id, subject, "用户资料与同一 owner_key 学习数据关联");

console.log("user profile integration: passed");
