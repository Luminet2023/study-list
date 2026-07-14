import assert from "node:assert/strict";
import test from "node:test";

import { resolveApiUrl, resolveApiWebSocketUrl } from "../src/lib/apiUrl.js";

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

test("WebSocket URL maps HTTPS and HTTP API bases to WSS and WS", () => {
  assert.equal(
    resolveApiWebSocketUrl("/v1/sync/ws", { baseUrl: API_BASE_URL }),
    "wss://api.luminet.cn/hifumi/v1/sync/ws",
  );
  assert.equal(
    resolveApiWebSocketUrl("v1/sync/ws", { baseUrl: "http://127.0.0.1:8080/hifumi/" }),
    "ws://127.0.0.1:8080/hifumi/v1/sync/ws",
  );
});

test("WebSocket URL keeps the page origin when no API base is configured", () => {
  assert.equal(
    resolveApiWebSocketUrl("/v1/sync/ws", {
      baseUrl: "",
      locationHref: "https://stellafortuna.luminet.cn/day/2026-07-13",
    }),
    "wss://stellafortuna.luminet.cn/v1/sync/ws",
  );
});

test("API URL rejects unsupported schemes and empty paths", () => {
  assert.throws(() => resolveApiUrl("v1/auth/session", "ftp://api.example.test/"), /HTTP or HTTPS/u);
  assert.throws(() => resolveApiUrl("", API_BASE_URL), /must not be empty/u);
});
