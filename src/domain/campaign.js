/**
 * 暑期学习清单的纯领域模型。
 *
 * 本模块不访问 DOM、localStorage 或网络；所有修改函数都返回新对象，便于
 * Vue store、本地持久化以及 Node 测试共同使用。
 */

import { countMarkdownCharacters } from "../lib/markdown.js";

export const CAMPAIGN_START = "2026-07-13";
export const CAMPAIGN_END = "2026-08-29";
export const VIRTUAL_FINAL_SUMMARY_DATE = "2026-08-30";
export const CAMPAIGN_DAY_COUNT = 48;
export const CAMPAIGN_WEEK_COUNT = 7;

export const DAY_TYPE = Object.freeze({
  WORKDAY: "workday",
  SATURDAY: "saturday",
  SUNDAY: "sunday",
  OUTSIDE: "outside",
});

export const ITEM_STATUS = Object.freeze({
  PENDING: "pending",
  COMPLETED: "completed",
  MISSED: "missed",
});

export const WORKDAY_REQUIRED_INPUT_SLOTS = Object.freeze([4, 7]);

export const SUBJECTS = Object.freeze([
  "语文",
  "英语",
  "数学",
  "化学",
  "生物",
  "物理",
]);

export const WEEKDAY_NAMES = Object.freeze([
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六",
  "星期日",
]);

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** @param {number} value */
function pad2(value) {
  return String(value).padStart(2, "0");
}

/**
 * 将日期值规范为 YYYY-MM-DD。Date 按调用者本地日历日解释；领域内部统一
 * 使用 UTC 做日期加减，避免夏令时造成跳日。
 *
 * @param {string|Date} value
 * @returns {string}
 */
export function toDateKey(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError("Invalid Date");
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }

  if (typeof value !== "string") {
    throw new TypeError("date must be a YYYY-MM-DD string or Date");
  }

  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) throw new TypeError(`Invalid date key: ${value}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new TypeError(`Invalid calendar date: ${value}`);
  }
  return value;
}

/** @param {string|Date} value */
function toUtcDate(value) {
  const [year, month, day] = toDateKey(value).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** @param {Date} date */
function utcDateToKey(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/**
 * @param {string|Date} date
 * @param {number} amount
 */
export function addDays(date, amount) {
  if (!Number.isInteger(amount)) throw new TypeError("amount must be an integer");
  const next = toUtcDate(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return utcDateToKey(next);
}

/** @param {string|Date} left @param {string|Date} right */
export function compareDateKeys(left, right) {
  return toDateKey(left).localeCompare(toDateKey(right));
}

/** 返回 end - start 的日历日数。 */
export function daysBetween(start, end) {
  return Math.round((toUtcDate(end).getTime() - toUtcDate(start).getTime()) / 86_400_000);
}

/** ISO weekday：周一为 1，周日为 7。 */
export function getIsoWeekday(date) {
  const day = toUtcDate(date).getUTCDay();
  return day === 0 ? 7 : day;
}

/** @param {string|Date} date */
export function getWeekdayName(date) {
  return WEEKDAY_NAMES[getIsoWeekday(date) - 1];
}

/** @param {string|Date} date */
export function isCampaignDate(date) {
  const key = toDateKey(date);
  return key >= CAMPAIGN_START && key <= CAMPAIGN_END;
}

/** @param {string|Date} date */
export function getDayType(date) {
  const key = toDateKey(date);
  if (!isCampaignDate(key)) return DAY_TYPE.OUTSIDE;
  const weekday = getIsoWeekday(key);
  if (weekday <= 5) return DAY_TYPE.WORKDAY;
  if (weekday === 6) return DAY_TYPE.SATURDAY;
  return DAY_TYPE.SUNDAY;
}

/** 虚拟周日只承载最后一周统计，不是 campaign day。 */
export function isVirtualSummaryDate(date) {
  return toDateKey(date) === VIRTUAL_FINAL_SUMMARY_DATE;
}

/** @param {string|Date} date */
export function clampCampaignDate(date) {
  const key = toDateKey(date);
  if (key < CAMPAIGN_START) return CAMPAIGN_START;
  if (key > CAMPAIGN_END) return CAMPAIGN_END;
  return key;
}

/** @returns {string[]} */
export function getCampaignDates() {
  return Array.from({ length: CAMPAIGN_DAY_COUNT }, (_, index) => addDays(CAMPAIGN_START, index));
}

/** @param {string|Date} date */
export function getCampaignDayIndex(date) {
  const key = toDateKey(date);
  return isCampaignDate(key) ? daysBetween(CAMPAIGN_START, key) : -1;
}

/** 获取日期所在自然周的周一。 */
export function getWeekStart(date) {
  return addDays(date, 1 - getIsoWeekday(date));
}

/** 获取日期所在自然周的周日。 */
export function getWeekEnd(date) {
  return addDays(getWeekStart(date), 6);
}

/**
 * @typedef {Object} CampaignWeek
 * @property {number} index 零基序号
 * @property {number} number 一基序号
 * @property {string} startDate
 * @property {string} endDate 范围内最后一天
 * @property {string} summaryDate 周日统计日期；第 7 周为范围外虚拟周日
 * @property {boolean} virtualSummary
 * @property {string[]} dates 仅包含 campaign days
 */

/** @returns {CampaignWeek[]} */
export function getCampaignWeeks() {
  return Array.from({ length: CAMPAIGN_WEEK_COUNT }, (_, index) => {
    const startDate = addDays(CAMPAIGN_START, index * 7);
    const naturalEnd = addDays(startDate, 6);
    const endDate = naturalEnd > CAMPAIGN_END ? CAMPAIGN_END : naturalEnd;
    const summaryDate = naturalEnd;
    const dates = [];
    for (let date = startDate; date <= endDate; date = addDays(date, 1)) dates.push(date);
    return Object.freeze({
      index,
      number: index + 1,
      startDate,
      endDate,
      summaryDate,
      virtualSummary: summaryDate > CAMPAIGN_END,
      dates: Object.freeze(dates),
    });
  });
}

/**
 * 数字参数使用人类可读的 1..7；日期参数也接受最后一周虚拟周日。
 * @param {number|string|Date|CampaignWeek} reference
 * @returns {CampaignWeek}
 */
export function getCampaignWeek(reference) {
  const weeks = getCampaignWeeks();
  if (typeof reference === "number") {
    if (!Number.isInteger(reference) || reference < 1 || reference > CAMPAIGN_WEEK_COUNT) {
      throw new RangeError("campaign week number must be between 1 and 7");
    }
    return weeks[reference - 1];
  }
  if (reference && typeof reference === "object" && !(reference instanceof Date)) {
    if (Number.isInteger(reference.number)) return getCampaignWeek(reference.number);
    if (Number.isInteger(reference.index)) return getCampaignWeek(reference.index + 1);
  }
  const key = toDateKey(/** @type {string|Date} */ (reference));
  if (key === VIRTUAL_FINAL_SUMMARY_DATE) return weeks.at(-1);
  const index = getCampaignWeekIndex(key);
  if (index < 0) throw new RangeError(`date is outside campaign weeks: ${key}`);
  return weeks[index];
}

/**
 * @param {string|Date} date
 * @param {{includeVirtualSummary?: boolean}} [options]
 */
export function getCampaignWeekIndex(date, options = {}) {
  const key = toDateKey(date);
  if (options.includeVirtualSummary !== false && key === VIRTUAL_FINAL_SUMMARY_DATE) {
    return CAMPAIGN_WEEK_COUNT - 1;
  }
  if (!isCampaignDate(key)) return -1;
  return Math.floor(daysBetween(CAMPAIGN_START, key) / 7);
}

/** 下一个范围内工作日；严格晚于传入日期。 */
export function findNextCampaignWorkday(date) {
  for (let cursor = addDays(date, 1); cursor <= CAMPAIGN_END; cursor = addDays(cursor, 1)) {
    if (cursor >= CAMPAIGN_START && getIsoWeekday(cursor) <= 5) return cursor;
  }
  return null;
}

/**
 * 严格晚于 date 的下一个指定 ISO weekday；默认不限制在 campaign 内。
 * @param {string|Date} date
 * @param {number} isoWeekday
 * @param {{campaignOnly?: boolean}} [options]
 */
export function findNextWeekday(date, isoWeekday, options = {}) {
  if (!Number.isInteger(isoWeekday) || isoWeekday < 1 || isoWeekday > 7) {
    throw new RangeError("isoWeekday must be between 1 and 7");
  }
  const current = getIsoWeekday(date);
  const distance = ((isoWeekday - current + 7) % 7) || 7;
  const result = addDays(date, distance);
  return options.campaignOnly && !isCampaignDate(result) ? null : result;
}

/** 下一自然周的周一至周五（可能越过 campaign 末日）。 */
export function getNextCalendarWeekWorkdays(date) {
  const nextMonday = addDays(getWeekStart(date), 7);
  return Array.from({ length: 5 }, (_, index) => addDays(nextMonday, index));
}

/**
 * @typedef {Object} PlanItem
 * @property {string} id
 * @property {number} slot
 * @property {string|null} subject
 * @property {'fixed'|'detail'|'free'|'section'} kind
 * @property {string} prefix
 * @property {string} input
 * @property {string} suffix
 * @property {boolean} editable
 * @property {'pending'|'completed'|'missed'} status
 */

/** @returns {PlanItem} */
function createItem(date, slot, subject, kind, prefix, suffix = "") {
  return {
    id: `${date}:item:${slot}`,
    slot,
    subject,
    kind,
    prefix,
    input: "",
    suffix,
    editable: kind !== "fixed",
    status: ITEM_STATUS.PENDING,
  };
}

/**
 * 工作日模板。特别地，周一/三/五的第 3 项为数学，周二/四为化学。
 * @param {string|Date} date
 * @returns {PlanItem[]}
 */
export function getWorkdayTemplate(date) {
  const key = toDateKey(date);
  if (getIsoWeekday(key) > 5) throw new RangeError(`${key} is not a workday`);
  const chineseChemistryDay = [1, 3, 5].includes(getIsoWeekday(key));
  return [
    createItem(key, 1, chineseChemistryDay ? "语文" : "英语", "fixed", chineseChemistryDay ? "语文点线面" : "英语教材深研"),
    createItem(key, 2, chineseChemistryDay ? "化学" : "数学", "fixed", `${chineseChemistryDay ? "化学" : "数学"}错题/知识点收集整理`),
    createItem(key, 3, chineseChemistryDay ? "数学" : "化学", "fixed", `${chineseChemistryDay ? "数学" : "化学"}错题深研`),
    createItem(key, 4, "生物", "detail", "生物"),
    createItem(key, 5, "物理", "fixed", "物理错题/知识点收集整理"),
    createItem(key, 6, null, "free", ""),
    createItem(key, 7, "生物", "section", "生物课本", "阅读研习"),
    createItem(key, 8, "物理", "fixed", "物理错题深研"),
  ];
}

/** @param {string|Date} date @param {number} slot @param {string} [input] */
export function createSaturdayItem(date, slot, input = "") {
  const key = toDateKey(date);
  if (!Number.isInteger(slot) || slot < 1) throw new RangeError("slot must be a positive integer");
  const item = createItem(key, slot, null, "free", "");
  item.input = String(input);
  return item;
}

/**
 * @typedef {Object} CampaignDay
 * @property {string} date
 * @property {'workday'|'saturday'|'sunday'} type
 * @property {string|null} title
 * @property {PlanItem[]} items
 * @property {string} journal
 * @property {string} journalDraft
 * @property {boolean} goalsLocked
 * @property {string|null} goalsLockedAt
 * @property {{liked:boolean, likedAt:string|null, hitokoto:Object|null}} blessing
 */

/** @param {string|Date} date @returns {CampaignDay} */
export function createDefaultDay(date) {
  const key = toDateKey(date);
  if (!isCampaignDate(key)) throw new RangeError(`date is outside campaign: ${key}`);
  const type = getDayType(key);
  return {
    date: key,
    type,
    title: type === DAY_TYPE.SATURDAY ? "今日总目标" : null,
    items:
      type === DAY_TYPE.WORKDAY
        ? getWorkdayTemplate(key)
        : type === DAY_TYPE.SATURDAY
          ? [createSaturdayItem(key, 1)]
          : [],
    journal: "",
    journalDraft: "",
    goalsLocked: type === DAY_TYPE.WORKDAY ? false : true,
    goalsLockedAt: null,
    blessing: { liked: false, likedAt: null, hitokoto: null },
  };
}

/**
 * 创建可直接持久化的完整默认状态；不创建 8 月 30 日虚拟 day。
 * @returns {Object}
 */
export function createDefaultState() {
  return {
    version: 1,
    campaign: { startDate: CAMPAIGN_START, endDate: CAMPAIGN_END },
    days: Object.fromEntries(getCampaignDates().map((date) => [date, createDefaultDay(date)])),
    raffle: {
      draws: [],
      awards: [],
      dailyDrawDates: {},
      paperBonusDates: [],
      bonusDrawsUsed: 0,
    },
  };
}

/** @param {PlanItem} item */
export function getItemText(item) {
  if (!item || typeof item !== "object") return "";
  if (typeof item.text === "string" && item.prefix == null) return item.text;
  return `${item.prefix ?? ""}${item.input ?? ""}${item.suffix ?? ""}`;
}

/** 工作日第 4、7 项均填写后，才允许进入目标锁定确认；第 6 项可留空。 */
export function areWorkdayGoalInputsComplete(day) {
  if (!day || day.type !== DAY_TYPE.WORKDAY) return false;
  return WORKDAY_REQUIRED_INPUT_SLOTS.every((slot) => {
    const item = day.items?.find((candidate) => candidate.slot === slot);
    return Boolean(item && String(item.input ?? "").trim());
  });
}

/** 锁定后的输入由 store/UI 共同保护为只读。 */
export function lockWorkdayGoals(day, lockedAt = new Date().toISOString()) {
  if (!day || day.type !== DAY_TYPE.WORKDAY) {
    throw new TypeError("day is not a workday");
  }
  if (!areWorkdayGoalInputsComplete(day)) {
    throw new Error("workday goal inputs are incomplete");
  }
  if (day.goalsLocked) return day;
  return {
    ...day,
    goalsLocked: true,
    goalsLockedAt: String(lockedAt),
  };
}

/** 解除工作日目标锁定，保留已填写内容与任务状态。 */
export function unlockWorkdayGoals(day) {
  if (!day || day.type !== DAY_TYPE.WORKDAY) {
    throw new TypeError("day is not a workday");
  }
  if (!day.goalsLocked) return day;
  return {
    ...day,
    goalsLocked: false,
    goalsLockedAt: null,
  };
}

/**
 * 统计 Unicode code points；默认忽略所有空白字符，标点仍计数。
 * @param {unknown} value
 * @param {{ignoreWhitespace?: boolean}} [options]
 */
export function countCharacters(value, options = {}) {
  const text = String(value ?? "");
  const normalized = options.ignoreWhitespace === false ? text : text.replace(/\s/gu, "");
  return Array.from(normalized).length;
}

/** @param {CampaignDay} day @param {PlanItem} item */
export function isCountedPlanItem(day, item) {
  if (!day || !item) return false;
  if (day.type === DAY_TYPE.WORKDAY) {
    return item.slot !== 6 || getItemText(item).trim().length > 0;
  }
  if (day.type === DAY_TYPE.SATURDAY) return getItemText(item).trim().length > 0;
  return false;
}

/**
 * pending -> completed -> missed -> completed；进入 completed 后在完成/未完成间切换。
 * @param {string} status
 */
export function nextItemStatus(status) {
  if (status === ITEM_STATUS.PENDING || status === ITEM_STATUS.MISSED) return ITEM_STATUS.COMPLETED;
  if (status === ITEM_STATUS.COMPLETED) return ITEM_STATUS.MISSED;
  throw new RangeError(`unknown item status: ${status}`);
}

/** @param {CampaignDay} day @param {number} slot */
export function cycleItemStatus(day, slot) {
  let found = false;
  const items = day.items.map((item) => {
    if (item.slot !== slot) return item;
    found = true;
    return { ...item, status: nextItemStatus(item.status) };
  });
  if (!found) throw new RangeError(`item slot ${slot} does not exist`);
  return { ...day, items };
}

/** @param {CampaignDay} day @param {number} slot @param {string} input */
export function updateItemInput(day, slot, input) {
  let found = false;
  const items = day.items.map((item) => {
    if (item.slot !== slot) return item;
    found = true;
    if (!item.editable) throw new TypeError(`item slot ${slot} is not editable`);
    return { ...item, input: String(input) };
  });
  if (!found) throw new RangeError(`item slot ${slot} does not exist`);
  return { ...day, items };
}

/** @param {CampaignDay} day @param {string} [input] */
export function appendSaturdayItem(day, input = "") {
  if (day.type !== DAY_TYPE.SATURDAY) throw new TypeError("day is not Saturday");
  const nextSlot = day.items.length + 1;
  return { ...day, items: [...day.items, createSaturdayItem(day.date, nextSlot, input)] };
}

/** 删除后重排编号；周六始终至少保留一行。 */
export function removeSaturdayItem(day, slot) {
  if (day.type !== DAY_TYPE.SATURDAY) throw new TypeError("day is not Saturday");
  const filtered = day.items.filter((item) => item.slot !== slot);
  const source = filtered.length ? filtered : [createSaturdayItem(day.date, 1)];
  const items = source.map((item, index) => ({
    ...item,
    id: `${day.date}:item:${index + 1}`,
    slot: index + 1,
  }));
  return { ...day, items };
}

/** @param {unknown} source */
function getAwards(source) {
  if (Array.isArray(source)) return source;
  if (source && Array.isArray(source.awards)) return source.awards;
  if (source && source.raffle && Array.isArray(source.raffle.awards)) return source.raffle.awards;
  return [];
}

/** 新奖励只有在 redeemedAt 有值时生效；旧数据没有该字段，继续视作已兑现。 */
export function isAwardRedeemed(award) {
  if (!award || typeof award !== "object") return false;
  return !Object.prototype.hasOwnProperty.call(award, "redeemedAt") || Boolean(award.redeemedAt);
}

/**
 * 奖励 target 格式为 {date, slots:'all'|number[]}；只有明确命中日期及 slot 才生效。
 * @param {unknown} awardSource state、raffle 或 awards 数组
 * @param {string|Date} date
 * @param {number} slot
 */
export function isItemExempt(awardSource, date, slot) {
  const key = toDateKey(date);
  return getAwards(awardSource).some((award) =>
    isAwardRedeemed(award) &&
    Array.isArray(award?.targets) &&
    award.targets.some((target) => {
      if (target?.date !== key) return false;
      if (target.slots === "all") return true;
      if (typeof target.slots === "number") return target.slots === slot;
      return Array.isArray(target.slots) && target.slots.includes(slot);
    }),
  );
}

/** @param {PlanItem} item @param {string|CampaignDay} dateOrDay @param {unknown} awardSource */
export function getEffectiveItemState(item, dateOrDay, awardSource) {
  const date = typeof dateOrDay === "string" ? dateOrDay : dateOrDay.date;
  const exempt = isItemExempt(awardSource, date, item.slot);
  return {
    rawStatus: item.status,
    status: exempt ? ITEM_STATUS.COMPLETED : item.status,
    exempt,
  };
}

/** @param {PlanItem} item @param {string|CampaignDay} dateOrDay @param {unknown} awardSource */
export function getEffectiveItemStatus(item, dateOrDay, awardSource) {
  return getEffectiveItemState(item, dateOrDay, awardSource).status;
}

/** 目标已锁定且所有已计划项目均已结算（完成或未完成）时，日记才可编辑。 */
export function isWorkdayJournalUnlocked(day, awardSource) {
  if (!day || day.type !== DAY_TYPE.WORKDAY || !day.goalsLocked) return false;
  if (!areWorkdayGoalInputsComplete(day)) return false;
  return (day.items ?? [])
    .filter((item) => isCountedPlanItem(day, item))
    .every(
      (item) => getEffectiveItemStatus(item, day, awardSource) !== ITEM_STATUS.PENDING,
    );
}

/** @param {Object} state @param {string} date */
function getStateDay(state, date) {
  return state?.days?.[date] ?? createDefaultDay(date);
}

/** @param {string} asOf */
function effectiveAsOf(asOf) {
  const key = toDateKey(asOf);
  return key > CAMPAIGN_END ? CAMPAIGN_END : key;
}

/** @returns {Record<string, number>} */
function emptySubjectDistribution() {
  return Object.fromEntries(SUBJECTS.map((subject) => [subject, 0]));
}

/**
 * @param {Object} state
 * @param {string[]} dates
 * @param {{asOf?: string|Date}} [options]
 */
export function calculateStatsForDates(state, dates, options = {}) {
  const asOf = effectiveAsOf(options.asOf ? toDateKey(options.asOf) : CAMPAIGN_END);
  const unfinishedBySubject = emptySubjectDistribution();
  let planCharacters = 0;
  let journalCharacters = 0;
  let planItems = 0;
  let completedItems = 0;
  let unfinishedItems = 0;
  let explicitlyMissedItems = 0;
  let exemptedItems = 0;

  const includedDates = dates
    .map(toDateKey)
    .filter((date) => isCampaignDate(date) && date <= asOf)
    .sort();

  for (const date of includedDates) {
    const day = getStateDay(state, date);
    // 周六明确没有日记区，周日为统计页；即使旧数据残留字段也不应误计。
    if (day.type === DAY_TYPE.WORKDAY) {
      journalCharacters += countMarkdownCharacters(day.journal ?? day.diary ?? "");
    }
    for (const item of day.items ?? []) {
      if (!isCountedPlanItem(day, item)) continue;
      planItems += 1;
      planCharacters += countCharacters(getItemText(item));
      const effective = getEffectiveItemState(item, date, state);
      if (effective.exempt) exemptedItems += 1;
      if (effective.status === ITEM_STATUS.COMPLETED) {
        completedItems += 1;
      } else {
        unfinishedItems += 1;
        if (item.status === ITEM_STATUS.MISSED) explicitlyMissedItems += 1;
        if (item.subject && Object.hasOwn(unfinishedBySubject, item.subject)) {
          unfinishedBySubject[item.subject] += 1;
        }
      }
    }
  }

  return {
    asOf,
    includedDates,
    planCharacters,
    journalCharacters,
    planItems,
    completedItems,
    unfinishedItems,
    explicitlyMissedItems,
    exemptedItems,
    unfinishedBySubject,
    completionRate: planItems === 0 ? 0 : completedItems / planItems,
    // UI 友好的同义字段。
    totalPlans: planItems,
    completed: completedItems,
    unfinished: unfinishedItems,
  };
}

/**
 * @param {Object} state
 * @param {number|string|Date|CampaignWeek} weekReference
 * @param {{asOf?: string|Date}} [options]
 */
export function calculateWeekStats(state, weekReference, options = {}) {
  const week = getCampaignWeek(weekReference);
  const asOf = options.asOf ? toDateKey(options.asOf) : week.endDate;
  const stats = calculateStatsForDates(state, week.dates, { asOf });
  const cutoff = effectiveAsOf(asOf);
  return {
    ...stats,
    weekIndex: week.index,
    weekNumber: week.number,
    startDate: week.startDate,
    endDate: week.endDate,
    summaryDate: week.summaryDate,
    virtualSummary: week.virtualSummary,
    closed: cutoff >= week.endDate,
    fullAttendance: cutoff >= week.endDate && stats.unfinishedItems === 0,
  };
}

/** @param {unknown[]} records */
function uniqueRaffleRecords(records) {
  const seen = new Set();
  return records.filter((record, index) => {
    const key = record?.id ?? `${record?.drawDate ?? record?.date ?? "unknown"}:${record?.prizeId ?? record?.prize?.id ?? "none"}:${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 欧皇指数：按基础概率的 -log10(p) 映射到 0..100，中奖稀有度累加后除以
 * sqrt(抽奖次数)。任务免项约 40 分、周六 46 分、整日 60 分、整周 100 分。
 * @param {unknown[]|Object} source draws 数组、raffle 或完整 state
 */
export function calculateLuckIndex(source) {
  const raffle = Array.isArray(source) ? { draws: source } : source?.raffle ?? source ?? {};
  const records = uniqueRaffleRecords(
    Array.isArray(raffle.draws) && raffle.draws.length
      ? raffle.draws
      : Array.isArray(raffle.awards)
        ? raffle.awards
        : [],
  );
  if (!records.length) return 0;
  const points = records.reduce((total, record) => {
    const id = record?.prizeId ?? record?.prize?.id ?? "none";
    if (id.startsWith("task:")) return total + 40;
    if (id === "saturday") return total + 46;
    if (id.startsWith("weekday:")) return total + 60;
    if (id === "next-week") return total + 100;
    return total;
  }, 0);
  return Math.min(100, Math.round(points / Math.sqrt(records.length)));
}

/**
 * @param {Object} state
 * @param {{asOf?: string|Date}} [options]
 */
export function calculateTotalStats(state, options = {}) {
  const requestedAsOf = options.asOf ? toDateKey(options.asOf) : CAMPAIGN_END;
  const asOf = effectiveAsOf(requestedAsOf);
  const total = calculateStatsForDates(state, getCampaignDates(), { asOf });
  const weeks = getCampaignWeeks().map((week) => calculateWeekStats(state, week, { asOf }));
  const closedWeeks = weeks.filter((week) => week.closed);

  const raffle = state?.raffle ?? {};
  const rawRecords =
    Array.isArray(raffle.draws) && raffle.draws.length
      ? raffle.draws
      : Array.isArray(raffle.awards)
        ? raffle.awards
        : [];
  const records = uniqueRaffleRecords(rawRecords).filter((record) => {
    const date = record?.drawDate ?? record?.date;
    return !date || toDateKey(date) <= asOf;
  });
  const winningRecords = records.filter((record) => {
    const id = record?.prizeId ?? record?.prize?.id ?? "none";
    return id !== "none";
  });
  const winDistribution = {};
  for (const record of winningRecords) {
    const id = record?.prizeId ?? record?.prize?.id;
    winDistribution[id] = (winDistribution[id] ?? 0) + 1;
  }

  return {
    ...total,
    weeks,
    closedWeekCount: closedWeeks.length,
    fullAttendanceWeeks: closedWeeks.filter((week) => week.fullAttendance).length,
    unfinishedByWeek: weeks.map((week) => ({
      weekNumber: week.weekNumber,
      startDate: week.startDate,
      endDate: week.endDate,
      count: week.unfinishedItems,
    })),
    drawCount: records.length,
    winCount: winningRecords.length,
    winDistribution,
    luckIndex: calculateLuckIndex(records),
  };
}
