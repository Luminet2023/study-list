import { decodeJsonValue, encodeJsonValue } from "./protocol.js";
import { createDefaultState } from "../domain/campaign.js";

const RECORD_PREFIX = "stella/v1";
const DEFAULT_STATE = createDefaultState();

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function key(...segments) {
  return [RECORD_PREFIX, ...segments.map((segment) => encodeURIComponent(String(segment)))].join("/");
}

function decodeKey(entityKey) {
  const segments = entityKey.split("/");
  if (segments[0] !== "stella" || segments[1] !== "v1") return null;
  return segments.slice(2).map((segment) => decodeURIComponent(segment));
}

function setArrayRecord(array, id, value) {
  const index = array.findIndex((candidate) => String(candidate?.id) === id);
  if (value === undefined) {
    if (index >= 0) array.splice(index, 1);
    return;
  }
  if (index >= 0) array[index] = clone(value);
  else array.push(clone(value));
}

/** 只投影偏离默认空白数据库的记录，避免首次同步上传数百条模板数据。 */
export function stateToRecords(state) {
  const records = new Map();
  for (const [date, day] of Object.entries(state?.days ?? {})) {
    const defaultDay = DEFAULT_STATE.days?.[date];
    const journal = day.journal ?? "";
    if (journal !== (defaultDay?.journal ?? "")) {
      records.set(key("day", date, "journal"), journal);
    }
    const journalDraft = day.journalDraft ?? "";
    if (journalDraft !== (defaultDay?.journalDraft ?? "")) {
      records.set(key("day", date, "journalDraft"), journalDraft);
    }
    const goals = {
      locked: Boolean(day.goalsLocked),
      lockedAt: day.goalsLockedAt ?? null,
    };
    const defaultGoals = {
      locked: Boolean(defaultDay?.goalsLocked),
      lockedAt: defaultDay?.goalsLockedAt ?? null,
    };
    if (!recordValuesEqual(goals, defaultGoals)) {
      records.set(key("day", date, "goals"), goals);
    }
    const blessing = clone(day.blessing ?? {});
    if (!recordValuesEqual(blessing, defaultDay?.blessing ?? {})) {
      records.set(key("day", date, "blessing"), blessing);
    }
    const defaultItems = new Map((defaultDay?.items ?? []).map((item) => [String(item.id), item]));
    for (const item of day.items ?? []) {
      if (!recordValuesEqual(item, defaultItems.get(String(item.id)))) {
        records.set(key("day", date, "item", item.id), clone(item));
      }
    }
  }

  for (const [quoteId, quote] of Object.entries(state?.quoteLikes ?? {})) {
    records.set(key("quote", quoteId), clone(quote));
  }
  const fontFamily = state?.preferences?.fontFamily ?? "lxgw-wenka";
  if (fontFamily !== (DEFAULT_STATE.preferences?.fontFamily ?? "lxgw-wenka")) {
    records.set(key("preference", "fontFamily"), fontFamily);
  }
  const quoteSource = state?.preferences?.quoteSource ?? "native";
  if (quoteSource !== "native") {
    records.set(key("preference", "quoteSource"), quoteSource);
  }
  const hitokotoCategories = [...(state?.preferences?.hitokotoCategories ?? [])];
  if (hitokotoCategories.length) {
    records.set(key("preference", "hitokotoCategories"), hitokotoCategories);
  }

  for (const draw of state?.raffle?.draws ?? []) {
    records.set(key("raffle", "draw", draw.id), clone(draw));
  }
  for (const award of state?.raffle?.awards ?? []) {
    records.set(key("raffle", "award", award.id), clone(award));
  }
  for (const claim of state?.raffle?.paperClaims ?? []) {
    records.set(key("raffle", "paperClaim", claim.id), clone(claim));
  }
  const raffleMeta = {
    dailyDrawDates: clone(state?.raffle?.dailyDrawDates ?? {}),
    paperBonusDates: clone(state?.raffle?.paperBonusDates ?? []),
    bonusDrawsUsed: state?.raffle?.bonusDrawsUsed ?? 0,
  };
  const defaultRaffleMeta = {
    dailyDrawDates: clone(DEFAULT_STATE.raffle?.dailyDrawDates ?? {}),
    paperBonusDates: clone(DEFAULT_STATE.raffle?.paperBonusDates ?? []),
    bonusDrawsUsed: DEFAULT_STATE.raffle?.bonusDrawsUsed ?? 0,
  };
  if (!recordValuesEqual(raffleMeta, defaultRaffleMeta)) {
    records.set(key("raffle", "meta"), raffleMeta);
  }
  return records;
}

export function recordsToSerializable(records) {
  return Object.fromEntries([...records.entries()].map(([recordKey, value]) => [recordKey, clone(value)]));
}

export function serializableToRecords(value) {
  return new Map(Object.entries(value ?? {}).map(([recordKey, recordValue]) => [recordKey, clone(recordValue)]));
}

export function recordValuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function diffRecords(previous, current) {
  const changes = [];
  const allKeys = new Set([...previous.keys(), ...current.keys()]);
  for (const entityKey of allKeys) {
    const before = previous.get(entityKey);
    const after = current.get(entityKey);
    if (current.has(entityKey) && recordValuesEqual(before, after)) continue;
    changes.push({
      entityKey,
      deleted: !current.has(entityKey),
      value: current.has(entityKey) ? clone(after) : undefined,
    });
  }
  return changes.sort((left, right) => left.entityKey.localeCompare(right.entityKey));
}

export function applyRecordValue(state, entityKey, value) {
  const segments = decodeKey(entityKey);
  if (!segments) return false;

  if (segments[0] === "day" && segments.length >= 3) {
    const [, date, kind, id] = segments;
    const day = state.days?.[date];
    if (!day) return false;
    const defaultDay = DEFAULT_STATE.days?.[date];
    if (kind === "journal") day.journal = value === undefined ? (defaultDay?.journal ?? "") : String(value);
    else if (kind === "journalDraft") {
      day.journalDraft = value === undefined ? (defaultDay?.journalDraft ?? "") : String(value);
    }
    else if (kind === "goals") {
      day.goalsLocked = value === undefined ? Boolean(defaultDay?.goalsLocked) : Boolean(value?.locked);
      day.goalsLockedAt = value === undefined ? (defaultDay?.goalsLockedAt ?? null) : (value?.lockedAt ?? null);
    } else if (kind === "blessing") {
      const currentHitokoto = clone(day.blessing?.hitokoto ?? null);
      const incomingBlessing = clone(
        value === undefined ? (defaultDay?.blessing ?? {}) : value,
      );
      // blessing 是早期协议中的整块记录；旧客户端/旧云端记录通常只含点赞状态，
      // 或显式带有 hitokoto: null。它不应擦除本机已经完成的按日一言绑定。
      // 若远端确实带来另一条有效绑定，仍以远端为准。
      day.blessing = {
        ...incomingBlessing,
        hitokoto: incomingBlessing?.hitokoto?.uuid
          ? incomingBlessing.hitokoto
          : currentHitokoto,
      };
    } else if (kind === "item" && id) {
      const defaultItem = defaultDay?.items?.find((item) => String(item.id) === id);
      setArrayRecord(day.items, id, value === undefined && defaultItem ? defaultItem : value);
      day.items.sort((left, right) => left.slot - right.slot || left.id.localeCompare(right.id));
    } else return false;
    return true;
  }

  if (segments[0] === "quote" && segments[1]) {
    state.quoteLikes ??= {};
    if (value === undefined) delete state.quoteLikes[segments[1]];
    else state.quoteLikes[segments[1]] = clone(value);
    return true;
  }

  if (segments[0] === "preference" && segments[1]) {
    state.preferences ??= {};
    if (segments[1] === "fontFamily") {
      state.preferences.fontFamily = value ?? DEFAULT_STATE.preferences?.fontFamily ?? "lxgw-wenka";
    } else if (segments[1] === "quoteSource") {
      state.preferences.quoteSource = value ?? "native";
    } else if (segments[1] === "hitokotoCategories") {
      state.preferences.hitokotoCategories = Array.isArray(value) ? clone(value) : [];
    } else return false;
    return true;
  }

  if (segments[0] === "raffle") {
    state.raffle ??= {};
    const [, kind, id] = segments;
    if (kind === "draw" && id) setArrayRecord((state.raffle.draws ??= []), id, value);
    else if (kind === "award" && id) setArrayRecord((state.raffle.awards ??= []), id, value);
    else if (kind === "paperClaim" && id) setArrayRecord((state.raffle.paperClaims ??= []), id, value);
    else if (kind === "meta") {
      const meta = value ?? DEFAULT_STATE.raffle;
      state.raffle.dailyDrawDates = clone(meta?.dailyDrawDates ?? {});
      state.raffle.paperBonusDates = clone(meta?.paperBonusDates ?? []);
      state.raffle.bonusDrawsUsed = meta?.bonusDrawsUsed ?? 0;
    } else return false;
    return true;
  }
  return false;
}

export function applyWireChanges(state, changes) {
  for (const change of [...changes].sort((left, right) => left.cursor - right.cursor)) {
    applyRecordValue(
      state,
      change.entityKey,
      change.deleted ? undefined : decodeJsonValue(change.valueJson),
    );
  }
  return state;
}

export function createMutationPayload(change) {
  return change.deleted ? new Uint8Array() : encodeJsonValue(change.value);
}
