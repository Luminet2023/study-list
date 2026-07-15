import assert from "node:assert/strict";
import test from "node:test";

import { bytesToBase64 } from "../src/sync/protocol.js";
import {
  MAX_HTTP_PROTOBUF_BYTES,
  postSyncProtobuf,
} from "../src/sync/httpTransport.js";

function response(status, body = {}, responseHeaders = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(responseHeaders),
    async json() { return body; },
  };
}

test("protobuf POST uses the cross-origin cookie and JSON Base64 contract", async () => {
  const calls = [];
  const result = await postSyncProtobuf("v1/sync/diff", Uint8Array.of(1, 2, 3), {
    apiBaseUrl: "https://api.luminet.cn/hifumi/",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, { protobuf: bytesToBase64(Uint8Array.of(9, 8)) });
    },
  });
  assert.deepEqual(result, Uint8Array.of(9, 8));
  assert.equal(calls[0].url, "https://api.luminet.cn/hifumi/v1/sync/diff");
  assert.equal(calls[0].options.credentials, "include");
  assert.equal(calls[0].options.referrerPolicy, "strict-origin-when-cross-origin");
  assert.deepEqual(JSON.parse(calls[0].options.body), { protobuf: "AQID" });
});

test("protobuf POST classifies auth, rate limit, and adaptive batch responses", async () => {
  await assert.rejects(
    postSyncProtobuf("v1/sync/diff", new Uint8Array(), {
      apiBaseUrl: "https://api.example.test/",
      fetchImpl: async () => response(401),
    }),
    (error) => error.code === "AUTH_REQUIRED",
  );
  await assert.rejects(
    postSyncProtobuf("v1/sync/diff", new Uint8Array(), {
      apiBaseUrl: "https://api.example.test/",
      fetchImpl: async () => response(429, {}, { "retry-after": "7" }),
    }),
    (error) => error.code === "RATE_LIMITED" && error.retryAfterMs === 7000,
  );
  await assert.rejects(
    postSyncProtobuf("v1/sync/diff", new Uint8Array(), {
      apiBaseUrl: "https://api.example.test/",
      fetchImpl: async () => response(413, { code: "sync_response_too_large" }),
    }),
    (error) => error.code === "SYNC_RESPONSE_TOO_LARGE",
  );
});

test("aborting a protobuf POST is reported as a paused request", async () => {
  const controller = new AbortController();
  const promise = postSyncProtobuf("v1/sync/diff", new Uint8Array(), {
    apiBaseUrl: "https://api.example.test/",
    signal: controller.signal,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }),
  });
  controller.abort();
  await assert.rejects(promise, (error) => error.code === "SYNC_PAUSED");
});

test("protobuf POST rejects malformed JSON, Base64, and decoded payloads over 512 KiB", async () => {
  await assert.rejects(
    postSyncProtobuf("v1/sync/diff", new Uint8Array(), {
      apiBaseUrl: "https://api.example.test/",
      fetchImpl: async () => ({
        ...response(200),
        async json() { throw new SyntaxError("bad json"); },
      }),
    }),
    (error) => error.code === "INVALID_RESPONSE",
  );
  await assert.rejects(
    postSyncProtobuf("v1/sync/diff", new Uint8Array(), {
      apiBaseUrl: "https://api.example.test/",
      fetchImpl: async () => response(200, { protobuf: "!!!!" }),
    }),
    (error) => error.code === "INVALID_RESPONSE",
  );
  await assert.rejects(
    postSyncProtobuf("v1/sync/diff", new Uint8Array(), {
      apiBaseUrl: "https://api.example.test/",
      fetchImpl: async () => response(200, {
        protobuf: bytesToBase64(new Uint8Array(MAX_HTTP_PROTOBUF_BYTES + 1)),
      }),
    }),
    (error) => error.code === "RESPONSE_TOO_LARGE",
  );
});

test("aborting while response.json is pending is reported as a paused request", async () => {
  const controller = new AbortController();
  let markJsonStarted;
  const jsonStarted = new Promise((resolve) => { markJsonStarted = resolve; });
  const promise = postSyncProtobuf("v1/sync/diff", new Uint8Array(), {
    apiBaseUrl: "https://api.example.test/",
    signal: controller.signal,
    fetchImpl: async () => ({
      ...response(200),
      json: () => new Promise((_resolve, reject) => {
        markJsonStarted();
        controller.signal.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      }),
    }),
  });
  await jsonStarted;
  controller.abort();
  await assert.rejects(promise, (error) => error.code === "SYNC_PAUSED");
});
