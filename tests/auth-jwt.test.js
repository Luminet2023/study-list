import assert from "node:assert/strict";
import test from "node:test";

import { signJwt, verifyJwt } from "../worker/jwt.js";

const SECRET = "unit-test-session-secret-that-is-longer-than-32-characters";

test("session JWT verifies valid claims and rejects tampering", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt({ sub: "linuxdo-user", iat: now, exp: now + 31 * 86_400 }, SECRET);
  const payload = await verifyJwt(token, SECRET);
  assert.equal(payload.sub, "linuxdo-user");
  assert.equal(payload.exp - payload.iat, 31 * 86_400);

  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  assert.equal(await verifyJwt(tampered, SECRET), null);
});

test("short-lived OAuth state JWT is purpose-bound", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt({ purpose: "linuxdo-oauth", exp: now + 600 }, SECRET);
  assert.ok(await verifyJwt(token, SECRET, { purpose: "linuxdo-oauth" }));
  assert.equal(await verifyJwt(token, SECRET, { purpose: "session" }), null);
});
