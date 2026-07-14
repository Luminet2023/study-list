export function createDayFlipbookPages(dates) {
  return Array.isArray(dates)
    ? dates.map((date, position) => ({ date, position }))
    : [];
}

export function findDayFlipbookPosition(dates, date) {
  return Array.isArray(dates) ? dates.indexOf(date) : -1;
}
