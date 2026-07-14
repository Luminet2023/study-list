import assert from "node:assert/strict";
import test from "node:test";

import { getCampaignDates } from "../src/domain/campaign.js";
import { resolveRouteSelectedDate } from "../src/router/routeState.js";

test("week statistics reference date does not replace the selected day", () => {
  assert.equal(
    resolveRouteSelectedDate({
      mode: "week-stats",
      date: "2026-07-27",
      from: "2026-07-30",
      currentDate: "2026-07-30",
      campaignDates: getCampaignDates(),
    }),
    "2026-07-30",
  );
});

test("day and week routes still select their date parameter", () => {
  for (const mode of ["day", "week"]) {
    assert.equal(
      resolveRouteSelectedDate({
        mode,
        date: "2026-07-30",
        from: undefined,
        currentDate: "2026-07-27",
        campaignDates: getCampaignDates(),
      }),
      "2026-07-30",
    );
  }
});
