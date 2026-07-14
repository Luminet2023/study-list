export const DAY_PAGE_TRANSITION = Object.freeze({
  CLASSIC: "classic",
  FLIPBOOK: "flipbook",
});

const ALLOWED_DAY_PAGE_TRANSITIONS = new Set(Object.values(DAY_PAGE_TRANSITION));

export function normalizeDayPageTransition(value) {
  return ALLOWED_DAY_PAGE_TRANSITIONS.has(value)
    ? value
    : DAY_PAGE_TRANSITION.CLASSIC;
}

export function createDayFlipbookPages(dates) {
  return Array.isArray(dates)
    ? dates.map((date, position) => ({ date, position }))
    : [];
}

export function findDayFlipbookPosition(dates, date) {
  return Array.isArray(dates) ? dates.indexOf(date) : -1;
}
