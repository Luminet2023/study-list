import assert from "node:assert/strict";
import test from "node:test";

import { resolveApiUrl } from "../src/lib/apiUrl.js";

const API_BASE_URL = "https://api.luminet.cn/hifumi/";

test("API URL preserves the configured path prefix", () => {
  assert.equal(
    resolveApiUrl("/v1/auth/session", API_BASE_URL),
    "https://api.luminet.cn/hifumi/v1/auth/session",
  );
  assert.equal(
    resolveApiUrl("v1/auth/logout", "https://api.luminet.cn/hifumi"),
    "https://api.luminet.cn/hifumi/v1/auth/logout",
  );
});

test("API URL keeps the versioned same-origin path when no base is configured", () => {
  assert.equal(resolveApiUrl("/v1/auth/session", ""), "/v1/auth/session");
});

test("API URL rejects unsupported schemes and empty paths", () => {
  assert.throws(() => resolveApiUrl("v1/auth/session", "ftp://api.example.test/"), /HTTP or HTTPS/u);
  assert.throws(() => resolveApiUrl("", API_BASE_URL), /must not be empty/u);
});
