export const RAFFLE_WHEEL_SEGMENTS = Object.freeze([
  { id: "tasks", label: "免任务" },
  { id: "saturday", label: "免周六" },
  { id: "weekdays", label: "免全天" },
  { id: "next-week", label: "免整周" },
  { id: "none", label: "未中" },
  { id: "tasks-repeat", label: "免任务" },
  { id: "weekdays-repeat", label: "免全天" },
  { id: "none-repeat", label: "未中" },
]);

const SEGMENT_ANGLE = 360 / RAFFLE_WHEEL_SEGMENTS.length;
const SPIN_DEGREES_PER_MS = 360 / 560;
const SEGMENT_BY_PRIZE_KIND = Object.freeze({
  task: "tasks",
  saturday: "saturday",
  weekday: "weekdays",
  "next-week": "next-week",
  none: "none",
});

export function normalizeWheelRotation(degrees) {
  return ((Number(degrees) % 360) + 360) % 360;
}

/** 返回让对应奖项扇区中心对齐顶部指针的角度。 */
export function getRaffleWheelTargetRotation(prizeKind) {
  const segmentId = SEGMENT_BY_PRIZE_KIND[prizeKind];
  const index = RAFFLE_WHEEL_SEGMENTS.findIndex((segment) => segment.id === segmentId);
  if (index < 0) throw new RangeError(`unknown raffle prize kind: ${prizeKind}`);
  return normalizeWheelRotation(-index * SEGMENT_ANGLE);
}

/** 从当前角度继续正向旋转若干圈，并精确落到结果扇区中心。 */
export function getRaffleWheelLandingRotation(currentDegrees, prizeKind, extraTurns = 1) {
  const current = Number(currentDegrees);
  if (!Number.isFinite(current)) throw new TypeError("current wheel rotation must be finite");
  const turns = Math.max(0, Math.trunc(extraTurns));
  const target = getRaffleWheelTargetRotation(prizeKind);
  const delta = normalizeWheelRotation(target - normalizeWheelRotation(current));
  return current + turns * 360 + delta;
}

/** 二次 ease-out 初速度为平均速度的两倍；按当前匀速反推时长，避免落位瞬间突增速。 */
export function getRaffleWheelLandingDuration(currentDegrees, prizeKind) {
  const landing = getRaffleWheelLandingRotation(currentDegrees, prizeKind);
  const distance = landing - Number(currentDegrees);
  return Math.round((2 * distance) / SPIN_DEGREES_PER_MS);
}
