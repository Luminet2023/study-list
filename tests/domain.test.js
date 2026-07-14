import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPAIGN_DAY_COUNT,
  CAMPAIGN_END,
  CAMPAIGN_START,
  CAMPAIGN_WEEK_COUNT,
  DAY_TYPE,
  ITEM_STATUS,
  VIRTUAL_FINAL_SUMMARY_DATE,
  WORKDAY_REQUIRED_INPUT_SLOTS,
  addDays,
  appendSaturdayItem,
  areWorkdayGoalInputsComplete,
  calculateLuckIndex,
  calculateTotalStats,
  calculateWeekStats,
  clampCampaignDate,
  compareDateKeys,
  countCharacters,
  createDefaultDay,
  createDefaultState,
  cycleItemStatus,
  daysBetween,
  findNextCampaignWorkday,
  getCampaignDates,
  getCampaignDayIndex,
  getCampaignWeek,
  getCampaignWeekIndex,
  getCampaignWeeks,
  getDayType,
  getEffectiveItemState,
  getEffectiveItemStatus,
  getIsoWeekday,
  getItemText,
  getWeekStart,
  getWeekdayName,
  getWorkdayTemplate,
  isCampaignDate,
  isAwardRedeemed,
  isCountedPlanItem,
  isItemExempt,
  isWorkdayJournalUnlocked,
  isVirtualSummaryDate,
  lockWorkdayGoals,
  nextItemStatus,
  removeSaturdayItem,
  toDateKey,
  unlockWorkdayGoals,
  updateItemInput,
} from "../src/domain/campaign.js";
import {
  BASE_RAFFLE_WEIGHTS,
  PRIZE_IDS,
  RAFFLE_MAX_PAPER_BONUS_DRAWS,
  RAFFLE_TOTAL_WEIGHT,
  buildRafflePool,
  canDrawDaily,
  canUsePaperBonus,
  createAward,
  drawRaffle,
  getNextWorkday,
  getAwardPreparation,
  getPrizeTargetDates,
  getRafflePreparation,
  getRaffleProbabilitySummary,
  getUtc8DateKey,
  isRafflePrizeTargetInRange,
  millisecondsUntilUtc8Midnight,
  pickWeightedPrize,
  prepareRaffle,
  recordRaffleDraw,
  redeemRaffleAward,
  secureRandomInt,
} from "../src/domain/raffle.js";

function completeDay(day) {
  return {
    ...day,
    items: day.items.map((item) => ({ ...item, status: ITEM_STATUS.COMPLETED })),
  };
}

test("campaign has exact inclusive 2026-07-13..2026-08-29 range", () => {
  const dates = getCampaignDates();
  assert.equal(dates.length, CAMPAIGN_DAY_COUNT);
  assert.equal(CAMPAIGN_DAY_COUNT, 48);
  assert.equal(dates[0], CAMPAIGN_START);
  assert.equal(dates.at(-1), CAMPAIGN_END);
  assert.equal(daysBetween(CAMPAIGN_START, CAMPAIGN_END), 47);
});

test("date helpers reject malformed and impossible dates", () => {
  assert.throws(() => toDateKey("2026-02-30"), /Invalid calendar date/);
  assert.throws(() => toDateKey("26-07-13"), /Invalid date key/);
});

test("date arithmetic crosses month boundaries without timezone drift", () => {
  assert.equal(addDays("2026-07-31", 1), "2026-08-01");
  assert.equal(addDays("2026-08-01", -1), "2026-07-31");
  assert.equal(compareDateKeys("2026-07-13", "2026-07-14"), -1);
});

test("campaign start is Monday and end is Saturday", () => {
  assert.equal(getIsoWeekday(CAMPAIGN_START), 1);
  assert.equal(getIsoWeekday(CAMPAIGN_END), 6);
  assert.equal(getWeekdayName(CAMPAIGN_START), "星期一");
  assert.equal(getWeekStart("2026-07-19"), CAMPAIGN_START);
});

test("day types distinguish workday, Saturday, Sunday and outside", () => {
  assert.equal(getDayType("2026-07-13"), DAY_TYPE.WORKDAY);
  assert.equal(getDayType("2026-07-18"), DAY_TYPE.SATURDAY);
  assert.equal(getDayType("2026-07-19"), DAY_TYPE.SUNDAY);
  assert.equal(getDayType("2026-08-30"), DAY_TYPE.OUTSIDE);
});

test("campaign inclusion and clamping are exact", () => {
  assert.equal(isCampaignDate("2026-07-12"), false);
  assert.equal(isCampaignDate(CAMPAIGN_START), true);
  assert.equal(isCampaignDate(CAMPAIGN_END), true);
  assert.equal(isCampaignDate("2026-08-30"), false);
  assert.equal(clampCampaignDate("2026-01-01"), CAMPAIGN_START);
  assert.equal(clampCampaignDate("2027-01-01"), CAMPAIGN_END);
});

test("campaign exposes seven week buckets", () => {
  const weeks = getCampaignWeeks();
  assert.equal(weeks.length, CAMPAIGN_WEEK_COUNT);
  assert.deepEqual(weeks[0].dates, [
    "2026-07-13",
    "2026-07-14",
    "2026-07-15",
    "2026-07-16",
    "2026-07-17",
    "2026-07-18",
    "2026-07-19",
  ]);
});

test("last week uses virtual 8/30 summary without creating a campaign day", () => {
  const week = getCampaignWeek(7);
  assert.equal(week.startDate, "2026-08-24");
  assert.equal(week.endDate, "2026-08-29");
  assert.equal(week.summaryDate, VIRTUAL_FINAL_SUMMARY_DATE);
  assert.equal(week.virtualSummary, true);
  assert.equal(week.dates.length, 6);
  assert.equal(isVirtualSummaryDate(week.summaryDate), true);
  assert.equal(getCampaignWeek(VIRTUAL_FINAL_SUMMARY_DATE).number, 7);
});

test("week and day indexes return -1 outside campaign", () => {
  assert.equal(getCampaignDayIndex(CAMPAIGN_START), 0);
  assert.equal(getCampaignDayIndex(CAMPAIGN_END), 47);
  assert.equal(getCampaignDayIndex("2026-08-30"), -1);
  assert.equal(getCampaignWeekIndex("2026-07-19"), 0);
  assert.equal(getCampaignWeekIndex(VIRTUAL_FINAL_SUMMARY_DATE), 6);
  assert.equal(getCampaignWeekIndex("2026-07-12"), -1);
});

test("next campaign workday skips weekends and ends at campaign boundary", () => {
  assert.equal(findNextCampaignWorkday("2026-07-17"), "2026-07-20");
  assert.equal(findNextCampaignWorkday("2026-08-28"), null);
  assert.equal(findNextCampaignWorkday(CAMPAIGN_END), null);
});

test("MWF template uses Chinese, Chemistry, then Math", () => {
  for (const date of ["2026-07-13", "2026-07-15", "2026-07-17"]) {
    const items = getWorkdayTemplate(date);
    assert.deepEqual(items.slice(0, 3).map(getItemText), [
      "语文点线面",
      "化学错题/知识点收集整理",
      "数学错题深研",
    ]);
    assert.deepEqual(items.slice(0, 3).map((item) => item.subject), ["语文", "化学", "数学"]);
  }
});

test("Tue/Thu template uses English, Math, then Chemistry", () => {
  for (const date of ["2026-07-14", "2026-07-16"]) {
    const items = getWorkdayTemplate(date);
    assert.deepEqual(items.slice(0, 3).map(getItemText), [
      "英语教材深研",
      "数学错题/知识点收集整理",
      "化学错题深研",
    ]);
  }
});

test("workday fixed suffix template is exact", () => {
  const items = getWorkdayTemplate("2026-07-13");
  assert.equal(getItemText(items[3]), "生物");
  assert.equal(getItemText(items[4]), "物理错题/知识点收集整理");
  assert.equal(getItemText(items[5]), "");
  assert.equal(getItemText(items[6]), "生物课本阅读研习");
  assert.equal(getItemText(items[7]), "物理错题深研");
});

test("only slots 4, 6 and 7 are editable", () => {
  const day = createDefaultDay("2026-07-13");
  assert.deepEqual(day.items.filter((item) => item.editable).map((item) => item.slot), [4, 6, 7]);
  assert.throws(() => updateItemInput(day, 1, "不可改"), /not editable/);
});

test("workday goal inputs gate the irreversible lock", () => {
  let day = createDefaultDay(CAMPAIGN_START);
  assert.deepEqual(WORKDAY_REQUIRED_INPUT_SLOTS, [4, 7]);
  assert.equal(day.goalsLocked, false);
  assert.equal(areWorkdayGoalInputsComplete(day), false);
  assert.throws(() => lockWorkdayGoals(day), /inputs are incomplete/);

  day = updateItemInput(day, 4, "必修一");
  assert.equal(areWorkdayGoalInputsComplete(day), false);
  day = updateItemInput(day, 7, "第三章");
  assert.equal(areWorkdayGoalInputsComplete(day), true);
  assert.equal(getItemText(day.items[5]), "");

  const locked = lockWorkdayGoals(day, "2026-07-13T08:00:00.000Z");
  assert.equal(locked.goalsLocked, true);
  assert.equal(locked.goalsLockedAt, "2026-07-13T08:00:00.000Z");
  assert.equal(lockWorkdayGoals(locked), locked);
  assert.throws(() => lockWorkdayGoals(createDefaultDay("2026-07-18")), /not a workday/);
});

test("workday goals can be unlocked without losing content or status", () => {
  let day = createDefaultDay(CAMPAIGN_START);
  day = updateItemInput(day, 4, "必修一");
  day = updateItemInput(day, 7, "第三章");
  day = lockWorkdayGoals(day, "2026-07-13T08:00:00.000Z");
  day = cycleItemStatus(day, 1);

  const unlocked = unlockWorkdayGoals(day);
  assert.equal(unlocked.goalsLocked, false);
  assert.equal(unlocked.goalsLockedAt, null);
  assert.equal(unlocked.items[0].status, ITEM_STATUS.COMPLETED);
  assert.equal(unlocked.items.find((item) => item.slot === 4).input, "必修一");
  assert.equal(unlocked.items.find((item) => item.slot === 7).input, "第三章");
  assert.equal(unlockWorkdayGoals(unlocked), unlocked);
  assert.throws(() => unlockWorkdayGoals(createDefaultDay("2026-07-18")), /not a workday/);
});

test("workday journal unlocks after every effective checkbox is settled", () => {
  let day = createDefaultDay(CAMPAIGN_START);
  day = updateItemInput(day, 4, "必修一");
  day = updateItemInput(day, 7, "第三章");
  const state = createDefaultState();

  assert.equal(isWorkdayJournalUnlocked(day, state), false);
  day = lockWorkdayGoals(day, "2026-07-13T08:00:00.000Z");
  assert.equal(isWorkdayJournalUnlocked(day, state), false);

  day = {
    ...day,
    items: day.items.map((item) => ({
      ...item,
      status: [6, 8].includes(item.slot) ? ITEM_STATUS.PENDING : ITEM_STATUS.COMPLETED,
    })),
  };
  assert.equal(isWorkdayJournalUnlocked(day, state), false);

  state.raffle.awards = [{ targets: [{ date: CAMPAIGN_START, slots: [8] }] }];
  assert.equal(isWorkdayJournalUnlocked(day, state), true);
});

test("missed workday goals are settled and allow journal entry", () => {
  let day = createDefaultDay(CAMPAIGN_START);
  day = updateItemInput(day, 4, "必修一");
  day = updateItemInput(day, 7, "第三章");
  day = lockWorkdayGoals(day, "2026-07-13T08:00:00.000Z");
  day = {
    ...day,
    items: day.items.map((item) => ({
      ...item,
      status: item.slot === 4 ? ITEM_STATUS.MISSED : ITEM_STATUS.COMPLETED,
    })),
  };

  assert.equal(isWorkdayJournalUnlocked(day, createDefaultState()), true);

  day = {
    ...day,
    items: day.items.map((item) =>
      item.slot === 8 ? { ...item, status: ITEM_STATUS.PENDING } : item,
    ),
  };
  assert.equal(isWorkdayJournalUnlocked(day, createDefaultState()), false);
});

test("filled slot 6 becomes required for journal unlock", () => {
  let day = createDefaultDay(CAMPAIGN_START);
  day = updateItemInput(day, 4, "必修一");
  day = updateItemInput(day, 6, "整理今日错题");
  day = updateItemInput(day, 7, "第三章");
  day = lockWorkdayGoals(day, "2026-07-13T08:00:00.000Z");
  day = {
    ...day,
    items: day.items.map((item) => ({
      ...item,
      status: item.slot === 6 ? ITEM_STATUS.PENDING : ITEM_STATUS.COMPLETED,
    })),
  };

  const state = createDefaultState();
  assert.equal(isWorkdayJournalUnlocked(day, state), false);
  day = cycleItemStatus(day, 6);
  assert.equal(isWorkdayJournalUnlocked(day, state), true);
});

test("slot 4 and slot 7 compose editable text between fixed parts", () => {
  let day = createDefaultDay("2026-07-13");
  day = updateItemInput(day, 4, " 必修一");
  day = updateItemInput(day, 7, "第三章");
  assert.equal(getItemText(day.items[3]), "生物 必修一");
  assert.equal(getItemText(day.items[6]), "生物课本第三章阅读研习");
});

test("blank slot 6 is not a plan, filled slot 6 is a plan", () => {
  let day = createDefaultDay("2026-07-13");
  assert.equal(isCountedPlanItem(day, day.items[5]), false);
  day = updateItemInput(day, 6, "整理今日补充任务");
  assert.equal(isCountedPlanItem(day, day.items[5]), true);
});

test("default state contains 48 real days and no virtual day", () => {
  const state = createDefaultState();
  assert.equal(Object.keys(state.days).length, 48);
  assert.equal(state.days[VIRTUAL_FINAL_SUMMARY_DATE], undefined);
  assert.equal(state.days["2026-07-19"].type, DAY_TYPE.SUNDAY);
});

test("status machine follows pending -> completed -> missed -> completed", () => {
  assert.equal(nextItemStatus(ITEM_STATUS.PENDING), ITEM_STATUS.COMPLETED);
  assert.equal(nextItemStatus(ITEM_STATUS.COMPLETED), ITEM_STATUS.MISSED);
  assert.equal(nextItemStatus(ITEM_STATUS.MISSED), ITEM_STATUS.COMPLETED);
  assert.throws(() => nextItemStatus("unknown"), /unknown item status/);
});

test("cycling an item is immutable", () => {
  const original = createDefaultDay("2026-07-13");
  const changed = cycleItemStatus(original, 1);
  assert.equal(original.items[0].status, ITEM_STATUS.PENDING);
  assert.equal(changed.items[0].status, ITEM_STATUS.COMPLETED);
  assert.notEqual(changed, original);
});

test("Saturday starts with centered-title model and one blank line", () => {
  const day = createDefaultDay("2026-07-18");
  assert.equal(day.type, DAY_TYPE.SATURDAY);
  assert.equal(day.title, "今日总目标");
  assert.equal(day.items.length, 1);
  assert.equal(day.items[0].slot, 1);
  assert.equal(getItemText(day.items[0]), "");
  assert.equal(day.journal, "");
});

test("Saturday append/remove renumbers and always retains one line", () => {
  let day = createDefaultDay("2026-07-18");
  day = appendSaturdayItem(day, "第二项");
  day = appendSaturdayItem(day, "第三项");
  day = removeSaturdayItem(day, 2);
  assert.deepEqual(day.items.map((item) => [item.slot, getItemText(item)]), [[1, ""], [2, "第三项"]]);
  day = removeSaturdayItem(removeSaturdayItem(day, 2), 1);
  assert.equal(day.items.length, 1);
  assert.equal(getItemText(day.items[0]), "");
});

test("character count ignores whitespace and counts Unicode code points", () => {
  assert.equal(countCharacters("中 文\nA😊"), 4);
  assert.equal(countCharacters("a b", { ignoreWhitespace: false }), 3);
});

test("initial full first week counts 35 fixed workday plans", () => {
  const stats = calculateWeekStats(createDefaultState(), 1);
  assert.equal(stats.planItems, 35);
  assert.equal(stats.completedItems, 0);
  assert.equal(stats.unfinishedItems, 35);
  assert.equal(stats.fullAttendance, false);
});

test("week stats obey asOf and do not count future preset days", () => {
  const stats = calculateWeekStats(createDefaultState(), 1, { asOf: "2026-07-13" });
  assert.equal(stats.includedDates.length, 1);
  assert.equal(stats.planItems, 7);
  assert.equal(stats.closed, false);
});

test("journal characters count workdays only and ignore Saturday/Sunday residue", () => {
  const state = createDefaultState();
  state.days["2026-07-13"].journal = "## 工作日\n\n**日结**";
  state.days["2026-07-18"].journal = "不应计入";
  state.days["2026-07-19"].journal = "不应计入";
  const stats = calculateWeekStats(state, 1);
  assert.equal(stats.journalCharacters, 5);
});

test("filled slot 6 adds one plan and authored characters", () => {
  const state = createDefaultState();
  const before = calculateWeekStats(state, 1);
  state.days[CAMPAIGN_START] = updateItemInput(state.days[CAMPAIGN_START], 6, "额外练习");
  const after = calculateWeekStats(state, 1);
  assert.equal(after.planItems, before.planItems + 1);
  assert.equal(after.planCharacters, before.planCharacters + 4);
});

test("pending and missed both count as unfinished, with missed tracked separately", () => {
  const state = createDefaultState();
  let day = cycleItemStatus(state.days[CAMPAIGN_START], 1);
  day = cycleItemStatus(day, 1);
  state.days[CAMPAIGN_START] = day;
  const stats = calculateWeekStats(state, 1, { asOf: CAMPAIGN_START });
  assert.equal(stats.unfinishedItems, 7);
  assert.equal(stats.explicitlyMissedItems, 1);
});

test("a targeted task exemption derives completed without changing raw status", () => {
  const state = createDefaultState();
  state.raffle.awards.push({
    id: "award-1",
    prizeId: "task:2",
    drawDate: "2026-07-12",
    targets: [{ date: CAMPAIGN_START, slots: [2] }],
  });
  const item = state.days[CAMPAIGN_START].items[1];
  assert.equal(isItemExempt(state, CAMPAIGN_START, 2), true);
  assert.deepEqual(getEffectiveItemState(item, CAMPAIGN_START, state), {
    rawStatus: ITEM_STATUS.PENDING,
    status: ITEM_STATUS.COMPLETED,
    exempt: true,
  });
  assert.equal(item.status, ITEM_STATUS.PENDING);
  assert.equal(calculateWeekStats(state, 1, { asOf: CAMPAIGN_START }).completedItems, 1);
});

test("all-slots exemption completes every counted item for that date only", () => {
  const state = createDefaultState();
  state.raffle.awards.push({
    id: "award-day",
    prizeId: "weekday:1",
    targets: [{ date: CAMPAIGN_START, slots: "all" }],
  });
  assert.equal(getEffectiveItemStatus(state.days[CAMPAIGN_START].items[7], CAMPAIGN_START, state), "completed");
  assert.equal(getEffectiveItemStatus(state.days["2026-07-14"].items[0], "2026-07-14", state), "pending");
});

test("unfinished subject distribution covers six subjects but excludes free slot 6", () => {
  const state = createDefaultState();
  state.days[CAMPAIGN_START] = updateItemInput(state.days[CAMPAIGN_START], 6, "自由任务");
  const stats = calculateWeekStats(state, 1, { asOf: CAMPAIGN_START });
  assert.equal(stats.planItems, 8);
  assert.deepEqual(stats.unfinishedBySubject, {
    语文: 1,
    英语: 0,
    数学: 1,
    化学: 1,
    生物: 2,
    物理: 2,
  });
  assert.equal(Object.values(stats.unfinishedBySubject).reduce((a, b) => a + b, 0), 7);
});

test("last partial week statistics include five workdays and Saturday", () => {
  const stats = calculateWeekStats(createDefaultState(), VIRTUAL_FINAL_SUMMARY_DATE);
  assert.equal(stats.weekNumber, 7);
  assert.equal(stats.includedDates.length, 6);
  assert.equal(stats.planItems, 35);
  assert.equal(stats.virtualSummary, true);
});

test("total initial statistics contain 245 fixed plans over 35 workdays", () => {
  const stats = calculateTotalStats(createDefaultState());
  assert.equal(stats.planItems, 245);
  assert.equal(stats.unfinishedItems, 245);
  assert.equal(stats.closedWeekCount, 7);
  assert.equal(stats.fullAttendanceWeeks, 0);
  assert.equal(stats.weeks.length, 7);
});

test("blank slot 6 is treated as satisfied for full attendance", () => {
  const state = createDefaultState();
  for (const date of getCampaignDates()) state.days[date] = completeDay(state.days[date]);
  const stats = calculateTotalStats(state);
  assert.equal(stats.completedItems, 245);
  assert.equal(stats.unfinishedItems, 0);
  assert.equal(stats.fullAttendanceWeeks, 7);
});

test("filled slot 6 must be completed for full attendance", () => {
  const state = createDefaultState();
  const firstWeek = getCampaignWeek(1);
  for (const date of firstWeek.dates) state.days[date] = completeDay(state.days[date]);
  state.days[CAMPAIGN_START] = updateItemInput(
    state.days[CAMPAIGN_START],
    6,
    "整理今日补充任务",
  );
  state.days[CAMPAIGN_START] = {
    ...state.days[CAMPAIGN_START],
    items: state.days[CAMPAIGN_START].items.map((item) =>
      item.slot === 6 ? { ...item, status: ITEM_STATUS.PENDING } : item,
    ),
  };

  let stats = calculateWeekStats(state, 1);
  assert.equal(stats.unfinishedItems, 1);
  assert.equal(stats.fullAttendance, false);

  state.days[CAMPAIGN_START] = cycleItemStatus(state.days[CAMPAIGN_START], 6);
  stats = calculateWeekStats(state, 1);
  assert.equal(stats.unfinishedItems, 0);
  assert.equal(stats.fullAttendance, true);
});

test("asOf before campaign produces no plans or closed weeks", () => {
  const stats = calculateTotalStats(createDefaultState(), { asOf: "2026-07-12" });
  assert.equal(stats.planItems, 0);
  assert.equal(stats.closedWeekCount, 0);
});

test("raffle base constants sum to exactly 700000", () => {
  const sum =
    BASE_RAFFLE_WEIGHTS.none +
    BASE_RAFFLE_WEIGHTS.task * 8 +
    BASE_RAFFLE_WEIGHTS.saturday +
    BASE_RAFFLE_WEIGHTS.weekday * 5 +
    BASE_RAFFLE_WEIGHTS.nextWeek;
  assert.equal(sum, RAFFLE_TOTAL_WEIGHT);
  assert.equal(sum, 700_000);
});

test("UTC+8 raffle day and next-midnight delay are exact", () => {
  const beforeMidnight = new Date("2026-07-12T15:59:59.250Z");
  assert.equal(getUtc8DateKey(beforeMidnight), "2026-07-12");
  assert.equal(millisecondsUntilUtc8Midnight(beforeMidnight), 750);
  assert.equal(getUtc8DateKey(new Date("2026-07-12T16:00:00.000Z")), "2026-07-13");
  assert.equal(millisecondsUntilUtc8Midnight(new Date("2026-07-12T16:00:00.000Z")), 86_400_000);
});

test("dynamic probability summary follows date validity and slot 6 redistribution", () => {
  const opening = Object.fromEntries(
    getRaffleProbabilitySummary(CAMPAIGN_START).map((entry) => [entry.id, entry]),
  );
  assert.equal(opening.tasks.probability, "各 1% · 共 8%");
  assert.equal(opening.none.probability, "90.999%");

  const redistributed = Object.fromEntries(
    getRaffleProbabilitySummary(CAMPAIGN_START, { redistributeSlot6: true })
      .map((entry) => [entry.id, entry]),
  );
  assert.equal(redistributed.tasks.probability, "第 6 项 0% · 其余各 1.143% · 共 8%");
  assert.equal(redistributed.tasks.entries.find((entry) => entry.id === "task:6").weight, 0);

  const penultimate = Object.fromEntries(
    getRaffleProbabilitySummary("2026-08-28").map((entry) => [entry.id, entry]),
  );
  assert.equal(penultimate.saturday.probability, "0.5%");
  assert.equal(penultimate.tasks.probability, "0%");
  assert.equal(penultimate.none.probability, "99.5%");
});

test("normal early-date pool preserves all configured integer weights", () => {
  const pool = buildRafflePool(CAMPAIGN_START);
  assert.equal(pool.totalWeight, 700_000);
  assert.equal(pool.entries.find((entry) => entry.id === "none").weight, 636_993);
  assert.equal(pool.entries.find((entry) => entry.id === "task:1").weight, 7_000);
  assert.equal(pool.entries.find((entry) => entry.id === "saturday").weight, 3_500);
  assert.equal(pool.entries.find((entry) => entry.id === "weekday:1").weight, 700);
  assert.equal(pool.entries.find((entry) => entry.id === "next-week").weight, 7);
});

test("confirmed blank slot 6 reallocates its weight equally to seven tasks", () => {
  const pool = buildRafflePool(CAMPAIGN_START, { redistributeSlot6: true });
  for (let slot = 1; slot <= 8; slot += 1) {
    assert.equal(
      pool.entries.find((entry) => entry.id === `task:${slot}`).weight,
      slot === 6 ? 0 : 8_000,
    );
  }
  assert.equal(pool.totalWeight, 700_000);
});

test("prize target dates use strictly next occurrences", () => {
  assert.deepEqual(getPrizeTargetDates("2026-07-13", "task:1"), ["2026-07-14"]);
  assert.deepEqual(getPrizeTargetDates("2026-07-17", "task:1"), ["2026-07-20"]);
  assert.deepEqual(getPrizeTargetDates("2026-07-13", "weekday:1"), ["2026-07-20"]);
  assert.deepEqual(getPrizeTargetDates("2026-07-13", "saturday"), ["2026-07-18"]);
  assert.deepEqual(getPrizeTargetDates("2026-07-19", "next-week"), [
    "2026-07-20",
    "2026-07-21",
    "2026-07-22",
    "2026-07-23",
    "2026-07-24",
  ]);
  assert.equal(getNextWorkday("2026-07-17"), "2026-07-20");
});

test("last campaign day folds every out-of-range prize into none", () => {
  const pool = buildRafflePool(CAMPAIGN_END);
  assert.equal(pool.entries.find((entry) => entry.id === "none").weight, 700_000);
  assert.equal(pool.entries.filter((entry) => entry.id !== "none").every((entry) => entry.weight === 0), true);
  assert.equal(isRafflePrizeTargetInRange(CAMPAIGN_END, PRIZE_IDS.SATURDAY), false);
});

test("near-end pool keeps valid Saturday and folds other future prizes", () => {
  const pool = buildRafflePool("2026-08-28");
  assert.equal(pool.entries.find((entry) => entry.id === "saturday").weight, 3_500);
  assert.equal(pool.entries.find((entry) => entry.id === "task:1").weight, 0);
  assert.equal(pool.entries.find((entry) => entry.id === "next-week").weight, 0);
  assert.equal(pool.entries.find((entry) => entry.id === "none").weight, 696_500);
});

test("raffle preparation prompts only for a valid blank next-workday slot 6", () => {
  const state = createDefaultState();
  const blank = getRafflePreparation(state, CAMPAIGN_START);
  assert.equal(blank.nextWorkday, "2026-07-14");
  assert.equal(blank.requiresSlot6Confirmation, true);
  state.days["2026-07-14"] = updateItemInput(state.days["2026-07-14"], 6, "已有任务");
  assert.equal(getRafflePreparation(state, CAMPAIGN_START).requiresSlot6Confirmation, false);
  assert.equal(getRafflePreparation(state, CAMPAIGN_END).requiresSlot6Confirmation, false);
});

test("prepareRaffle blocks until blank-slot confirmation then redistributes", () => {
  const state = createDefaultState();
  const blocked = prepareRaffle(state, CAMPAIGN_START);
  assert.equal(blocked.canDraw, false);
  const ready = prepareRaffle(state, CAMPAIGN_START, { slot6BlankConfirmed: true });
  assert.equal(ready.canDraw, true);
  assert.equal(ready.pool.redistributedSlot6, true);
});

test("whole-day and next-week prizes report blank slot 6 confirmations without changing weights", () => {
  const state = createDefaultState();
  const dayPrize = getAwardPreparation(state, CAMPAIGN_START, "weekday:2");
  assert.deepEqual(dayPrize.blankSlot6Dates, ["2026-07-14"]);
  assert.equal(dayPrize.requiresBlankSlot6Confirmation, true);
  const weekPrize = getAwardPreparation(state, CAMPAIGN_START, "next-week");
  assert.equal(weekPrize.blankSlot6Dates.length, 5);
  assert.equal(buildRafflePool(CAMPAIGN_START).entries.find((entry) => entry.id === "weekday:2").weight, 700);
});

test("weighted picker observes exact boundary between none and task 1", () => {
  const pool = buildRafflePool(CAMPAIGN_START);
  assert.equal(pickWeightedPrize(pool, 636_992).id, "none");
  assert.equal(pickWeightedPrize(pool, 636_993).id, "task:1");
  assert.throws(() => pickWeightedPrize(pool, 700_000), /random integer/);
});

test("secureRandomInt accepts deterministic uint32 injection", () => {
  assert.equal(secureRandomInt(10, () => 42), 2);
  const values = [0xffff_ffff, 21];
  assert.equal(secureRandomInt(10, () => values.shift()), 1);
});

test("drawRaffle returns deterministic prize and exemption award", () => {
  const result = drawRaffle(CAMPAIGN_START, {}, 636_993);
  assert.equal(result.prize.id, "task:1");
  assert.deepEqual(result.award.targets, [{ date: "2026-07-14", slots: [1] }]);
  const award = createAward(result.prize, CAMPAIGN_START, "custom-id");
  assert.equal(award.id, "custom-id");
});

test("daily raffle can be recorded once per calendar date", () => {
  let state = createDefaultState();
  assert.equal(canDrawDaily(state, CAMPAIGN_START), true);
  state = recordRaffleDraw(state, {
    id: "draw-1",
    drawDate: CAMPAIGN_START,
    prizeId: "none",
    mode: "daily",
  });
  assert.equal(canDrawDaily(state, CAMPAIGN_START), false);
  assert.throws(
    () => recordRaffleDraw(state, { id: "draw-2", drawDate: CAMPAIGN_START, prizeId: "none" }),
    /already used/,
  );
});

test("winning reward stays pending until redeemed and redemption is idempotent", () => {
  let state = createDefaultState();
  state = recordRaffleDraw(state, {
    id: "pending-win",
    drawDate: CAMPAIGN_START,
    prizeId: "task:1",
    mode: "daily",
  });

  const pendingAward = state.raffle.awards[0];
  assert.equal(pendingAward.redeemedAt, null);
  assert.equal(isAwardRedeemed(pendingAward), false);
  assert.equal(isItemExempt(state, "2026-07-14", 1), false);
  assert.equal(state.days["2026-07-14"].items[0].status, ITEM_STATUS.PENDING);

  const redeemed = redeemRaffleAward(state, "pending-win", "2026-07-13T12:00:00.000Z");
  assert.equal(redeemed.raffle.awards[0].redeemedAt, "2026-07-13T12:00:00.000Z");
  assert.equal(redeemed.raffle.draws[0].redeemedAt, "2026-07-13T12:00:00.000Z");
  assert.equal(isItemExempt(redeemed, "2026-07-14", 1), true);
  assert.equal(redeemed.days["2026-07-14"].items[0].status, ITEM_STATUS.PENDING);
  assert.strictEqual(
    redeemRaffleAward(redeemed, "pending-win", "2026-07-13T13:00:00.000Z"),
    redeemed,
  );
});

test("legacy awards without redeemedAt remain effective", () => {
  const state = createDefaultState();
  const award = createAward("task:1", CAMPAIGN_START, "legacy-award");
  state.raffle.awards.push(award);
  assert.equal(isAwardRedeemed(award), true);
  assert.equal(isItemExempt(state, "2026-07-14", 1), true);
});

test("paper bonus requires same-day completion flag and stops after three", () => {
  let state = createDefaultState();
  assert.equal(canUsePaperBonus(state, CAMPAIGN_START, false), false);
  assert.equal(canUsePaperBonus(state, CAMPAIGN_START, true), true);
  for (let index = 0; index < RAFFLE_MAX_PAPER_BONUS_DRAWS; index += 1) {
    state = recordRaffleDraw(state, {
      id: `bonus-${index}`,
      drawDate: addDays(CAMPAIGN_START, index),
      prizeId: "none",
      mode: "paper-bonus",
    });
  }
  assert.equal(state.raffle.bonusDrawsUsed, 3);
  assert.equal(canUsePaperBonus(state, "2026-07-20", true), false);
});

test("luck index rewards rarity and includes failed draws in denominator", () => {
  assert.equal(calculateLuckIndex([]), 0);
  assert.equal(calculateLuckIndex([{ id: "a", prizeId: "task:1" }]), 40);
  assert.equal(calculateLuckIndex([{ id: "a", prizeId: "weekday:1" }]), 60);
  assert.equal(calculateLuckIndex([{ id: "a", prizeId: "next-week" }]), 100);
  assert.equal(calculateLuckIndex([{ id: "a", prizeId: "task:1" }, { id: "b", prizeId: "none" }]), 28);
});

test("total statistics include wins, target distribution and luck index", () => {
  let state = createDefaultState();
  state = recordRaffleDraw(state, {
    id: "win-1",
    drawDate: CAMPAIGN_START,
    prizeId: "task:1",
    mode: "daily",
  });
  assert.equal(calculateTotalStats(state).exemptedItems, 0);
  state = redeemRaffleAward(state, "win-1", "2026-07-13T12:00:00.000Z");
  state = recordRaffleDraw(state, {
    id: "lose-1",
    drawDate: "2026-07-14",
    prizeId: "none",
    mode: "daily",
  });
  const stats = calculateTotalStats(state);
  assert.equal(stats.drawCount, 2);
  assert.equal(stats.winCount, 1);
  assert.deepEqual(stats.winDistribution, { "task:1": 1 });
  assert.equal(stats.luckIndex, 28);
  assert.equal(stats.exemptedItems, 1);
});
