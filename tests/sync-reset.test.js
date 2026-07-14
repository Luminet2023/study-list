import assert from "node:assert/strict";
import test from "node:test";

import { selectResetLocalOverlay } from "../src/sync/syncEngine.js";

const ENTITY_KEY = "stella/v1/day/2026-07-13/journal";

test("reset recovery preserves an unconfirmed local change over the rebuilt remote baseline", () => {
  const overlay = selectResetLocalOverlay(
    new Map([[ENTITY_KEY, "old-server-value"]]),
    new Map([[ENTITY_KEY, "local-value"]]),
    new Map([[ENTITY_KEY, "local-value"]]),
    new Set(),
  );

  assert.deepEqual(overlay, [{
    entityKey: ENTITY_KEY,
    deleted: false,
    value: "local-value",
  }]);
});

test("reset recovery does not replay a rejected write when the record was not edited again", () => {
  const overlay = selectResetLocalOverlay(
    new Map([[ENTITY_KEY, "server-value"]]),
    new Map([[ENTITY_KEY, "rejected-value"]]),
    new Map([[ENTITY_KEY, "rejected-value"]]),
    new Set([ENTITY_KEY]),
  );

  assert.deepEqual(overlay, []);
});

test("reset recovery preserves a newer edit made while a rejected write was in flight", () => {
  const overlay = selectResetLocalOverlay(
    new Map([[ENTITY_KEY, "server-value"]]),
    new Map([[ENTITY_KEY, "edited-again"]]),
    new Map([[ENTITY_KEY, "rejected-value"]]),
    new Set([ENTITY_KEY]),
  );

  assert.deepEqual(overlay, [{
    entityKey: ENTITY_KEY,
    deleted: false,
    value: "edited-again",
  }]);
});

test("reset recovery applies the same rejection rule to local deletions", () => {
  assert.deepEqual(
    selectResetLocalOverlay(
      new Map([[ENTITY_KEY, "server-value"]]),
      new Map(),
      new Map(),
      new Set([ENTITY_KEY]),
    ),
    [],
  );

  assert.deepEqual(
    selectResetLocalOverlay(
      new Map([[ENTITY_KEY, "server-value"]]),
      new Map([[ENTITY_KEY, "restored-after-send"]]),
      new Map(),
      new Set([ENTITY_KEY]),
    ),
    [{
      entityKey: ENTITY_KEY,
      deleted: false,
      value: "restored-after-send",
    }],
  );
});
