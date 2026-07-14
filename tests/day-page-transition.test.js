import assert from "node:assert/strict";
import test from "node:test";

import {
  DAY_PAGE_TRANSITION,
  normalizeDayPageTransition,
  orderFlipbookPages,
} from "../src/lib/dayPageTransition.js";

test("day page transition keeps the classic effect as its compatible default", () => {
  assert.equal(normalizeDayPageTransition(undefined), DAY_PAGE_TRANSITION.CLASSIC);
  assert.equal(normalizeDayPageTransition("unknown"), DAY_PAGE_TRANSITION.CLASSIC);
  assert.equal(normalizeDayPageTransition("flipbook"), DAY_PAGE_TRANSITION.FLIPBOOK);
});

test("flipbook page order matches the requested turn direction", () => {
  const previousPage = { id: "previous" };
  const nextPage = { id: "next" };

  assert.deepEqual(orderFlipbookPages("next", previousPage, nextPage), {
    pages: [previousPage, nextPage],
    startPage: 1,
    targetPage: 2,
  });
  assert.deepEqual(orderFlipbookPages("previous", previousPage, nextPage), {
    pages: [nextPage, previousPage],
    startPage: 2,
    targetPage: 1,
  });
});
