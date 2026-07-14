export function resolveRouteSelectedDate({
  mode,
  date,
  from,
  currentDate,
  campaignDates,
}) {
  const isCampaignDate = (value) => campaignDates.includes(value);
  if (mode === "week-stats") {
    return isCampaignDate(from) ? from : currentDate;
  }
  if ((mode === "day" || mode === "week") && isCampaignDate(date)) {
    return date;
  }
  return currentDate;
}
