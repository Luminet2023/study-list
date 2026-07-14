import assert from "node:assert/strict";
import test from "node:test";

import {
  loginWithLinuxDo,
  logoutAuthSession,
  refreshAuthSession,
} from "../src/composables/useAuthSession.js";

test("auth session requests use credentialed API URLs", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const calls = [];
  const redirects = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return Response.json({ authenticated: false });
  };
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { assign: (url) => redirects.push(url) },
  });
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation);
    else delete globalThis.location;
  });

  await refreshAuthSession();
  loginWithLinuxDo();
  await logoutAuthSession();

  assert.equal(calls[0].url, "/v1/auth/session");
  assert.equal(calls[0].options.credentials, "include");
  assert.equal(calls[0].options.referrerPolicy, "strict-origin-when-cross-origin");
  assert.equal(calls[1].url, "/v1/auth/logout");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[1].options.credentials, "include");
  assert.equal(calls[1].options.referrerPolicy, "strict-origin-when-cross-origin");
  assert.deepEqual(redirects, ["/v1/auth/login/linuxdo"]);
});
