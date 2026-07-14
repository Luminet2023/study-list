import assert from "node:assert/strict";
import test from "node:test";

import {
  RAFFLE_WHEEL_SEGMENTS,
  getRaffleWheelLabelCounterRotation,
  getRaffleWheelLandingDuration,
  getRaffleWheelLandingRotation,
  getRaffleWheelTargetRotation,
} from "../src/components/raffleWheel.js";

test("raffle wheel maps every real prize kind to the center below the top pointer", () => {
  assert.equal(RAFFLE_WHEEL_SEGMENTS.length, 8);
  assert.equal(getRaffleWheelTargetRotation("task"), 0);
  assert.equal(getRaffleWheelTargetRotation("saturday"), 315);
  assert.equal(getRaffleWheelTargetRotation("weekday"), 270);
  assert.equal(getRaffleWheelTargetRotation("next-week"), 225);
  assert.equal(getRaffleWheelTargetRotation("none"), 180);
});

test("raffle wheel counter-rotates labels so landed text stays upright", () => {
  for (const kind of ["task", "saturday", "weekday", "next-week", "none"]) {
    const wheelRotation = getRaffleWheelTargetRotation(kind);
    const labelRotation = getRaffleWheelLabelCounterRotation(kind);
    assert.equal((wheelRotation + labelRotation + 360) % 360, 0, kind);
  }
});

test("raffle wheel landing keeps moving forward before reaching the exact result", () => {
  assert.equal(getRaffleWheelLandingRotation(20, "none"), 540);
  assert.equal(getRaffleWheelLandingRotation(350, "saturday"), 1035);
  assert.equal(getRaffleWheelLandingDuration(20, "none"), 1618);
  assert.equal(getRaffleWheelLandingDuration(350, "saturday"), 2131);
  assert.throws(() => getRaffleWheelTargetRotation("unknown"), /unknown raffle prize kind/u);
});
