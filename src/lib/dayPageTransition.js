export function createDayFlipbookPages(dates) {
  return Array.isArray(dates)
    ? dates.map((date, position) => ({ date, position }))
    : [];
}

export function findDayFlipbookPosition(dates, date) {
  return Array.isArray(dates) ? dates.indexOf(date) : -1;
}

export function createDayFlipbookHydrationPositions(
  dates,
  selectedDate,
  { active = true, radius = 1 } = {},
) {
  if (!active || !Array.isArray(dates) || dates.length === 0) return [];

  const selectedPosition = findDayFlipbookPosition(dates, selectedDate);
  if (selectedPosition < 0) return [];

  const safeRadius = Number.isInteger(radius) && radius >= 0 ? radius : 1;
  const firstPosition = Math.max(0, selectedPosition - safeRadius);
  const lastPosition = Math.min(dates.length - 1, selectedPosition + safeRadius);

  return Array.from(
    { length: lastPosition - firstPosition + 1 },
    (_, offset) => firstPosition + offset,
  );
}
