import { CAMPAIGN_START, ITEM_STATUS } from "../domain/campaign.js";

const BASELINE_ID_PATTERN = /^baseline_[a-f0-9]{32}$/u;

export function createBaselineId() {
  return `baseline_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}

export function isBaselineId(value) {
  return typeof value === "string" && BASELINE_ID_PATTERN.test(value);
}

function dayHasProgress(day) {
  if (!day || typeof day !== "object") return false;
  if (String(day.journal ?? "").trim()) return true;
  if (day.goalsLockedAt) return true;
  if (day.blessing?.liked) return true;
  return (day.items ?? []).some(
    (item) => String(item?.input ?? "").trim() || item?.status !== ITEM_STATUS.PENDING,
  );
}

/** 生成冲突 Dialog 与服务端基线头共用的可读进度摘要。 */
export function summarizeCampaignProgress(state) {
  const progressedDates = [];
  for (const [date, day] of Object.entries(state?.days ?? {})) {
    if (dayHasProgress(day)) progressedDates.push(date);
  }
  for (const quote of Object.values(state?.quoteLikes ?? {})) {
    if (quote?.date) progressedDates.push(quote.date);
  }
  for (const draw of state?.raffle?.draws ?? []) {
    if (draw?.drawDate) progressedDates.push(draw.drawDate);
  }
  for (const claim of state?.raffle?.paperClaims ?? []) {
    if (claim?.date) progressedDates.push(claim.date);
  }
  const updatedAt =
    typeof state?.lastUpdatedAt === "string" && !Number.isNaN(Date.parse(state.lastUpdatedAt))
      ? state.lastUpdatedAt
      : null;
  return {
    baselineId: isBaselineId(state?.baselineId) ? state.baselineId : null,
    version: Number.isSafeInteger(state?.revision) ? state.revision : 0,
    updatedAt,
    updatedAtMs: updatedAt ? Date.parse(updatedAt) : 0,
    progressDay: progressedDates.sort().at(-1) ?? CAMPAIGN_START,
  };
}
