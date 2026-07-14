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

export function orderFlipbookPages(direction, previousPage, nextPage) {
  if (direction === "previous") {
    return {
      pages: [nextPage, previousPage],
      startSpread: 1,
      targetSpread: 0,
    };
  }
  return {
    pages: [previousPage, nextPage],
    startSpread: 0,
    targetSpread: 1,
  };
}
