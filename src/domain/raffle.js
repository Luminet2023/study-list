/** 摸鱼大转盘的整数权重、目标日期与纯状态更新。 */

import {
  CAMPAIGN_END,
  addDays,
  createDefaultDay,
  findNextWeekday,
  getIsoWeekday,
  getItemText,
  getNextCalendarWeekWorkdays,
  isCampaignDate,
  toDateKey,
} from "./campaign.js";

export const RAFFLE_TOTAL_WEIGHT = 700_000;
export const RAFFLE_MAX_PAPER_BONUS_DRAWS = 3;

export const PRIZE_IDS = Object.freeze({
  NONE: "none",
  SATURDAY: "saturday",
  NEXT_WEEK: "next-week",
  task: (slot) => `task:${slot}`,
  weekday: (isoWeekday) => `weekday:${isoWeekday}`,
});

/**
 * 700000 份整数奖池：1%=7000，0.5%=3500，0.1%=700，0.001%=7。
 */
export const BASE_RAFFLE_WEIGHTS = Object.freeze({
  none: 636_993,
  task: 7_000,
  saturday: 3_500,
  weekday: 700,
  nextWeek: 7,
});

const WEEKDAY_SHORT_NAMES = Object.freeze(["周一", "周二", "周三", "周四", "周五"]);

/** @typedef {'none'|'task'|'saturday'|'weekday'|'next-week'} PrizeKind */

/**
 * @typedef {Object} PrizeDefinition
 * @property {string} id
 * @property {PrizeKind} kind
 * @property {string} label
 * @property {number} baseWeight
 * @property {number|null} slot
 * @property {number|null} isoWeekday
 */

/** @returns {PrizeDefinition[]} */
function createPrizeDefinitions() {
  return [
    {
      id: PRIZE_IDS.NONE,
      kind: "none",
      label: "未中奖",
      baseWeight: BASE_RAFFLE_WEIGHTS.none,
      slot: null,
      isoWeekday: null,
    },
    ...Array.from({ length: 8 }, (_, index) => ({
      id: PRIZE_IDS.task(index + 1),
      kind: "task",
      label: `免下一个工作日第 ${index + 1} 项`,
      baseWeight: BASE_RAFFLE_WEIGHTS.task,
      slot: index + 1,
      isoWeekday: null,
    })),
    {
      id: PRIZE_IDS.SATURDAY,
      kind: "saturday",
      label: "免周六努力",
      baseWeight: BASE_RAFFLE_WEIGHTS.saturday,
      slot: null,
      isoWeekday: 6,
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      id: PRIZE_IDS.weekday(index + 1),
      kind: "weekday",
      label: `免下一个${WEEKDAY_SHORT_NAMES[index]}全天`,
      baseWeight: BASE_RAFFLE_WEIGHTS.weekday,
      slot: null,
      isoWeekday: index + 1,
    })),
    {
      id: PRIZE_IDS.NEXT_WEEK,
      kind: "next-week",
      label: "免下一周工作日",
      baseWeight: BASE_RAFFLE_WEIGHTS.nextWeek,
      slot: null,
      isoWeekday: null,
    },
  ];
}

export const PRIZE_DEFINITIONS = Object.freeze(
  createPrizeDefinitions().map((definition) => Object.freeze(definition)),
);

/** @param {string} prizeId @returns {PrizeDefinition} */
export function getPrizeDefinition(prizeId) {
  const definition = PRIZE_DEFINITIONS.find((candidate) => candidate.id === prizeId);
  if (!definition) throw new RangeError(`unknown prize id: ${prizeId}`);
  return definition;
}

/** @param {string|Date} date */
function assertDrawDate(date) {
  const key = toDateKey(date);
  if (!isCampaignDate(key)) throw new RangeError(`draw date is outside campaign: ${key}`);
  return key;
}

/** 严格晚于 date 的下一个工作日，不在此处截断 campaign，便于判断越界奖项。 */
export function getNextWorkday(date) {
  let cursor = addDays(date, 1);
  while (getIsoWeekday(cursor) > 5) cursor = addDays(cursor, 1);
  return cursor;
}

/**
 * 返回奖项原始目标日期；日期即使越过 campaign 也保留，由奖池构建器判无效。
 * @param {string|Date} drawDate
 * @param {string} prizeId
 * @returns {string[]}
 */
export function getPrizeTargetDates(drawDate, prizeId) {
  const date = assertDrawDate(drawDate);
  const definition = getPrizeDefinition(prizeId);
  if (definition.kind === "none") return [];
  if (definition.kind === "task") return [getNextWorkday(date)];
  if (definition.kind === "saturday") return [findNextWeekday(date, 6)];
  if (definition.kind === "weekday") return [findNextWeekday(date, definition.isoWeekday)];
  return getNextCalendarWeekWorkdays(date);
}

/** @param {PrizeDefinition} definition @param {string[]} targetDates */
function hasValidTargets(definition, targetDates) {
  const expectedCount = definition.kind === "next-week" ? 5 : definition.kind === "none" ? 0 : 1;
  return targetDates.length === expectedCount && targetDates.every(isCampaignDate);
}

/**
 * @typedef {PrizeDefinition & {
 *   configuredWeight:number,
 *   weight:number,
 *   valid:boolean,
 *   targetDates:string[]
 * }} RaffleEntry
 */

/**
 * 构建总和恒为 700000 的奖池。无有效目标的权重全部回流 none。
 * 若确认下个工作日第 6 项留空，task:6 归零，其 7000 权重平均加到另 7 项，
 * 因而每项均为 8000。
 *
 * @param {string|Date} drawDate
 * @param {{
 *   redistributeSlot6?: boolean,
 *   nextWorkdaySlot6Blank?: boolean,
 *   slot6BlankConfirmed?: boolean
 * }} [options]
 */
export function buildRafflePool(drawDate, options = {}) {
  const date = assertDrawDate(drawDate);
  const redistributedSlot6 =
    options.redistributeSlot6 === true ||
    (options.slot6BlankConfirmed === true && options.nextWorkdaySlot6Blank !== false);

  const configuredWeights = Object.fromEntries(
    PRIZE_DEFINITIONS.map((definition) => [definition.id, definition.baseWeight]),
  );
  if (redistributedSlot6) {
    configuredWeights[PRIZE_IDS.task(6)] = 0;
    for (let slot = 1; slot <= 8; slot += 1) {
      if (slot !== 6) configuredWeights[PRIZE_IDS.task(slot)] = 8_000;
    }
  }

  let foldedWeight = 0;
  /** @type {RaffleEntry[]} */
  const prizeEntries = PRIZE_DEFINITIONS.filter((definition) => definition.kind !== "none").map(
    (definition) => {
      const targetDates = getPrizeTargetDates(date, definition.id);
      const valid = hasValidTargets(definition, targetDates);
      const configuredWeight = configuredWeights[definition.id];
      if (!valid) foldedWeight += configuredWeight;
      return {
        ...definition,
        configuredWeight,
        weight: valid ? configuredWeight : 0,
        valid,
        targetDates,
      };
    },
  );

  /** @type {RaffleEntry} */
  const noneEntry = {
    ...getPrizeDefinition(PRIZE_IDS.NONE),
    configuredWeight: BASE_RAFFLE_WEIGHTS.none,
    weight: BASE_RAFFLE_WEIGHTS.none + foldedWeight,
    valid: true,
    targetDates: [],
  };
  const entries = [noneEntry, ...prizeEntries];
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight !== RAFFLE_TOTAL_WEIGHT) {
    throw new Error(`raffle pool invariant failed: ${totalWeight}`);
  }

  return {
    drawDate: date,
    totalWeight,
    redistributedSlot6,
    requiresSlot6Confirmation:
      options.nextWorkdaySlot6Blank === true &&
      options.slot6BlankConfirmed !== true &&
      options.redistributeSlot6 !== true,
    entries,
  };
}

/**
 * 检查下个工作日第 6 项；仅当目标仍在 campaign 且当前为空时要求确认。
 * @param {Object} state
 * @param {string|Date} drawDate
 */
export function getRafflePreparation(state, drawDate) {
  const date = assertDrawDate(drawDate);
  const nextWorkday = getNextWorkday(date);
  const targetIsValid = isCampaignDate(nextWorkday);
  const day = targetIsValid ? state?.days?.[nextWorkday] ?? createDefaultDay(nextWorkday) : null;
  const slot6 = day?.items?.find((item) => item.slot === 6);
  const nextWorkdaySlot6Blank = Boolean(targetIsValid && slot6 && getItemText(slot6).trim() === "");
  return {
    drawDate: date,
    nextWorkday: targetIsValid ? nextWorkday : null,
    nextWorkdaySlot6Blank,
    requiresSlot6Confirmation: nextWorkdaySlot6Blank,
  };
}

/**
 * 组合“是否需弹确认”和奖池。确认留空后才允许按重分配规则抽取。
 * @param {Object} state
 * @param {string|Date} drawDate
 * @param {{slot6BlankConfirmed?: boolean}} [options]
 */
export function prepareRaffle(state, drawDate, options = {}) {
  const preparation = getRafflePreparation(state, drawDate);
  const confirmed = options.slot6BlankConfirmed === true;
  const blocked = preparation.requiresSlot6Confirmation && !confirmed;
  return {
    ...preparation,
    canDraw: !blocked,
    pool: buildRafflePool(drawDate, {
      nextWorkdaySlot6Blank: preparation.nextWorkdaySlot6Blank,
      slot6BlankConfirmed: confirmed,
    }),
  };
}

/**
 * 整日/整周免项中奖后，找出仍为空的第 6 项，供 UI 按原需求再次确认。
 * 该确认不改变中奖概率，也不改变奖项目标；空白第 6 项本身不计入计划数。
 *
 * @param {Object} state
 * @param {string|Date} drawDate
 * @param {string} prizeId
 */
export function getAwardPreparation(state, drawDate, prizeId) {
  const definition = getPrizeDefinition(prizeId);
  const targetDates = getPrizeTargetDates(drawDate, prizeId);
  const valid = definition.kind === "none" || hasValidTargets(definition, targetDates);
  const checksBlankSlot6 = definition.kind === "weekday" || definition.kind === "next-week";
  const blankSlot6Dates = checksBlankSlot6
    ? targetDates.filter((date) => {
        if (!isCampaignDate(date)) return false;
        const day = state?.days?.[date] ?? createDefaultDay(date);
        const item = day.items?.find((candidate) => candidate.slot === 6);
        return Boolean(item && getItemText(item).trim() === "");
      })
    : [];
  return {
    drawDate: assertDrawDate(drawDate),
    prizeId,
    targetDates,
    valid,
    blankSlot6Dates,
    requiresBlankSlot6Confirmation: valid && blankSlot6Dates.length > 0,
  };
}

/** @param {unknown} source */
function readUint32(source) {
  if (typeof source === "function") {
    const value = source();
    if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
      throw new RangeError("injected uint32 source returned an invalid value");
    }
    return value;
  }
  const cryptoLike = source ?? globalThis.crypto;
  if (!cryptoLike || typeof cryptoLike.getRandomValues !== "function") {
    throw new Error("Web Crypto getRandomValues is unavailable");
  }
  const values = new Uint32Array(1);
  cryptoLike.getRandomValues(values);
  return values[0];
}

/**
 * 无模偏的 crypto 随机整数；第二参数可注入返回 uint32 的函数用于确定性测试。
 * @param {number} maxExclusive
 * @param {Crypto|(()=>number)} [source]
 */
export function secureRandomInt(maxExclusive, source) {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x1_0000_0000) {
    throw new RangeError("maxExclusive must be an integer between 1 and 2^32");
  }
  const range = 0x1_0000_0000;
  const limit = range - (range % maxExclusive);
  for (;;) {
    const value = readUint32(source);
    if (value < limit) return value % maxExclusive;
  }
}

/**
 * @param {{entries:RaffleEntry[],totalWeight:number}|RaffleEntry[]} pool
 * @param {number|((maxExclusive:number)=>number)} [randomInteger]
 * @returns {RaffleEntry}
 */
export function pickWeightedPrize(pool, randomInteger) {
  const entries = Array.isArray(pool) ? pool : pool.entries;
  const totalWeight = Array.isArray(pool)
    ? entries.reduce((sum, entry) => sum + entry.weight, 0)
    : pool.totalWeight;
  const value =
    typeof randomInteger === "number"
      ? randomInteger
      : typeof randomInteger === "function"
        ? randomInteger(totalWeight)
        : secureRandomInt(totalWeight);
  if (!Number.isInteger(value) || value < 0 || value >= totalWeight) {
    throw new RangeError(`random integer must be in [0, ${totalWeight})`);
  }
  let cursor = value;
  for (const entry of entries) {
    if (cursor < entry.weight) return entry;
    cursor -= entry.weight;
  }
  throw new Error("weighted raffle selection invariant failed");
}

/**
 * @typedef {Object} RaffleAward
 * @property {string} id
 * @property {string} prizeId
 * @property {string} label
 * @property {string} drawDate
 * @property {{date:string,slots:'all'|number[]}[]} targets
 */

/**
 * 将有效中奖项转换成免项记录；none 返回 null。
 * @param {RaffleEntry|string} prize
 * @param {string|Date} drawDate
 * @param {string} [awardId]
 * @returns {RaffleAward|null}
 */
export function createAward(prize, drawDate, awardId) {
  const date = assertDrawDate(drawDate);
  const entry =
    typeof prize === "string"
      ? {
          ...getPrizeDefinition(prize),
          targetDates: getPrizeTargetDates(date, prize),
          valid: getPrizeTargetDates(date, prize).every(isCampaignDate),
        }
      : prize;
  if (entry.kind === "none" || entry.id === PRIZE_IDS.NONE) return null;
  if (entry.valid === false || !entry.targetDates?.length || !entry.targetDates.every(isCampaignDate)) {
    throw new RangeError(`prize has no valid campaign target: ${entry.id}`);
  }
  const targets = entry.targetDates.map((targetDate) => ({
    date: targetDate,
    slots: entry.kind === "task" ? [entry.slot] : "all",
  }));
  return {
    id: awardId ?? `${date}:${entry.id}`,
    prizeId: entry.id,
    label: entry.label,
    drawDate: date,
    targets,
  };
}

/**
 * @param {string|Date} drawDate
 * @param {Parameters<typeof buildRafflePool>[1]} [options]
 * @param {number|((maxExclusive:number)=>number)} [randomInteger]
 */
export function drawRaffle(drawDate, options = {}, randomInteger) {
  const pool = buildRafflePool(drawDate, options);
  const prize = pickWeightedPrize(pool, randomInteger);
  return {
    drawDate: pool.drawDate,
    prize,
    award: createAward(prize, pool.drawDate),
    pool,
  };
}

/** @param {Object} state @param {string|Date} date */
export function canDrawDaily(state, date) {
  const key = assertDrawDate(date);
  const raffle = state?.raffle ?? {};
  if (raffle.dailyDrawDates?.[key]) return false;
  return !(raffle.draws ?? []).some(
    (draw) => (draw.mode ?? "daily") === "daily" && (draw.drawDate ?? draw.date) === key,
  );
}

/** @param {Object} state @param {string|Date} date @param {boolean} [paperCompletedInOneDay] */
export function canUsePaperBonus(state, date, paperCompletedInOneDay = true) {
  assertDrawDate(date);
  if (!paperCompletedInOneDay) return false;
  const raffle = state?.raffle ?? {};
  const used = Number.isInteger(raffle.bonusDrawsUsed)
    ? raffle.bonusDrawsUsed
    : (raffle.draws ?? []).filter((draw) => draw.mode === "paper-bonus").length;
  return used < RAFFLE_MAX_PAPER_BONUS_DRAWS;
}

/**
 * 记录抽奖，返回新 state。daily 每日一次；paper-bonus 全假期最多三次。
 * @param {Object} state
 * @param {{id:string,drawDate:string,prizeId:string,mode?:'daily'|'paper-bonus'}} draw
 */
export function recordRaffleDraw(state, draw) {
  const date = assertDrawDate(draw.drawDate);
  const mode = draw.mode ?? "daily";
  if (mode === "daily" && !canDrawDaily(state, date)) throw new Error(`${date} daily raffle already used`);
  if (mode === "paper-bonus" && !canUsePaperBonus(state, date, true)) {
    throw new Error("paper bonus raffle limit reached");
  }
  const definition = getPrizeDefinition(draw.prizeId);
  const targetDates = getPrizeTargetDates(date, definition.id);
  const valid = definition.kind === "none" || hasValidTargets(definition, targetDates);
  if (!valid) throw new RangeError(`cannot record invalid target prize: ${definition.id}`);
  const award = createAward({ ...definition, targetDates, valid }, date, `${draw.id}:award`);
  const raffle = state?.raffle ?? {};
  const record = { ...draw, drawDate: date, mode };
  return {
    ...state,
    raffle: {
      ...raffle,
      draws: [...(raffle.draws ?? []), record],
      awards: award ? [...(raffle.awards ?? []), award] : [...(raffle.awards ?? [])],
      dailyDrawDates:
        mode === "daily"
          ? { ...(raffle.dailyDrawDates ?? {}), [date]: draw.id }
          : { ...(raffle.dailyDrawDates ?? {}) },
      paperBonusDates:
        mode === "paper-bonus"
          ? [...(raffle.paperBonusDates ?? []), date]
          : [...(raffle.paperBonusDates ?? [])],
      bonusDrawsUsed: (raffle.bonusDrawsUsed ?? 0) + (mode === "paper-bonus" ? 1 : 0),
    },
  };
}

/** campaign 最后一天，所有未来奖项均应折回未中奖；供 UI/诊断展示。 */
export function isRafflePrizeTargetInRange(drawDate, prizeId) {
  return getPrizeTargetDates(drawDate, prizeId).every(
    (targetDate) => targetDate <= CAMPAIGN_END && isCampaignDate(targetDate),
  );
}
