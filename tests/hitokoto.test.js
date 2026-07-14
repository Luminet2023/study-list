import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHitokotoUrl,
  fetchHitokoto,
  fetchUniqueHitokoto,
  normalizeHitokotoCategories,
} from "../src/services/hitokoto.js";

test("hitokoto categories are filtered, deduplicated and encoded as repeated c params", () => {
  assert.deepEqual(normalizeHitokotoCategories(["c", "a", "c", "x", null]), ["a", "c"]);
  const url = buildHitokotoUrl(["c", "a", "c"]);
  assert.equal(url.origin, "https://v1.hitokoto.cn");
  assert.deepEqual(url.searchParams.getAll("c"), ["a", "c"]);
  assert.equal(url.searchParams.get("encode"), "json");
  assert.equal(url.searchParams.get("charset"), "utf-8");
});

test("hitokoto response is normalized and malformed payloads are rejected", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      uuid: " quote-uuid ",
      hitokoto: " 山川异域，风月同天。 ",
      type: "i",
      from: "绣袈裟衣缘",
      from_who: null,
    }),
  });
  assert.deepEqual(await fetchHitokoto(["i"], { fetchImpl }), {
    uuid: "quote-uuid",
    hitokoto: "山川异域，风月同天。",
    type: "i",
    from: "绣袈裟衣缘",
    fromWho: null,
  });

  await assert.rejects(
    () => fetchHitokoto([], {
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ uuid: "missing-text" }) }),
    }),
    /缺少 uuid 或 hitokoto/u,
  );
  await assert.rejects(
    () => fetchHitokoto([], {
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    }),
    /HTTP 503/u,
  );
});

test("duplicate hitokoto UUID is fetched again until a unique sentence is returned", async () => {
  const payloads = [
    { uuid: "used-uuid", hitokoto: "重复句子" },
    { uuid: "unique-uuid", hitokoto: "新的句子" },
  ];
  let calls = 0;
  const result = await fetchUniqueHitokoto(["d", "i"], {
    usedUuids: new Set(["used-uuid"]),
    retryDelayMs: 0,
    fetchImpl: async (url) => {
      calls += 1;
      assert.deepEqual(url.searchParams.getAll("c"), ["d", "i"]);
      return { ok: true, status: 200, json: async () => payloads.shift() };
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.uuid, "unique-uuid");
  assert.equal(result.hitokoto, "新的句子");
});
