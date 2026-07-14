import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultState } from "../src/domain/campaign.js";
import {
  createBaselineId,
  isBaselineId,
  summarizeCampaignProgress,
} from "../src/sync/baseline.js";

test("baseline IDs are random and valid", () => {
  const first = createBaselineId();
  const second = createBaselineId();
  assert.equal(isBaselineId(first), true);
  assert.equal(isBaselineId(second), true);
  assert.notEqual(first, second);
});

test("progress summary reports the latest day with meaningful activity", () => {
  const state = createDefaultState();
  state.baselineId = createBaselineId();
  state.revision = 7;
  state.lastUpdatedAt = "2026-07-20T08:00:00.000Z";
  state.days["2026-07-13"].items[0].status = "completed";
  state.days["2026-07-18"].items[0].input = "复习";
  const summary = summarizeCampaignProgress(state);
  assert.equal(summary.progressDay, "2026-07-18");
  assert.equal(summary.version, 7);
  assert.equal(summary.updatedAtMs, Date.parse(state.lastUpdatedAt));
});

test("automatically binding hitokoto does not advance learning progress", () => {
  const state = createDefaultState();
  state.days["2026-07-20"].blessing.hitokoto = {
    uuid: "quote-uuid",
    hitokoto: "山川异域，风月同天。",
  };
  assert.equal(summarizeCampaignProgress(state).progressDay, "2026-07-13");
});
