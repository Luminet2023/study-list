import assert from "node:assert/strict";
import test from "node:test";

import {
  FRONTEND_ORIGIN,
  apiRequest,
  apiUrl,
} from "../scripts/api-config.mjs";

test("maintenance API requests use the configured Go API and browser source headers", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(null, { status: 204 });
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  await apiRequest("v1/auth/session", {
    headers: { cookie: "stella_session=test" },
  });

  assert.equal(calls[0].url, apiUrl("v1/auth/session"));
  assert.equal(calls[0].options.credentials, "include");
  assert.equal(calls[0].options.referrerPolicy, "strict-origin-when-cross-origin");
  assert.equal(calls[0].options.headers.get("origin"), FRONTEND_ORIGIN);
  assert.equal(calls[0].options.headers.get("referer"), `${FRONTEND_ORIGIN}/`);
  assert.equal(calls[0].options.headers.get("cookie"), "stella_session=test");
});
