import assert from "node:assert/strict";
import test from "node:test";

import {
  createDayFlipbookHydrationPositions,
  createDayFlipbookPages,
  findDayFlipbookPosition,
} from "../src/lib/dayPageTransition.js";

test("flipbook creates one stable page for every campaign date", () => {
  const dates = Array.from({ length: 48 }, (_, index) => `day-${index}`);
  const pages = createDayFlipbookPages(dates);

  assert.equal(pages.length, 48);
  assert.deepEqual(pages[0], { date: "day-0", position: 0 });
  assert.deepEqual(pages.at(-1), { date: "day-47", position: 47 });
  assert.equal(new Set(pages.map((page) => page.date)).size, 48);
});

test("flipbook date positions stay aligned with the full campaign", () => {
  const dates = Array.from({ length: 48 }, (_, index) => `day-${index}`);
  assert.equal(findDayFlipbookPosition(dates, dates[0]), 0);
  assert.equal(findDayFlipbookPosition(dates, dates[23]), 23);
  assert.equal(findDayFlipbookPosition(dates, dates.at(-1)), 47);
  assert.equal(findDayFlipbookPosition(dates, "outside"), -1);
});

test("flipbook produces no placeholder pages for invalid date input", () => {
  assert.deepEqual(createDayFlipbookPages(undefined), []);
  assert.deepEqual(createDayFlipbookPages(null), []);
});

test("flipbook hydrates only the current page and its direct neighbours", () => {
  const dates = Array.from({ length: 48 }, (_, index) => `day-${index}`);

  assert.deepEqual(createDayFlipbookHydrationPositions(dates, "day-23"), [22, 23, 24]);
  assert.deepEqual(
    createDayFlipbookHydrationPositions(dates, "day-23", { radius: 0 }),
    [23],
  );
  assert.deepEqual(createDayFlipbookHydrationPositions(dates, "day-0"), [0, 1]);
  assert.deepEqual(createDayFlipbookHydrationPositions(dates, "day-47"), [46, 47]);
});

test("flipbook releases hydrated Day content while its route is inactive", () => {
  const dates = ["day-0", "day-1", "day-2"];

  assert.deepEqual(
    createDayFlipbookHydrationPositions(dates, "day-1", { active: false }),
    [],
  );
  assert.deepEqual(createDayFlipbookHydrationPositions(dates, "outside"), []);
  assert.deepEqual(createDayFlipbookHydrationPositions(undefined, "day-0"), []);
});
