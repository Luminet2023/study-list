import assert from "node:assert/strict";

import { chromium } from "playwright";

const baseUrl = process.env.QA_URL || "http://127.0.0.1:4173/";
const routeUrl = (path) => new URL(path, baseUrl).href;
const campaignDates = [];
for (
  let cursor = new Date("2026-07-13T00:00:00Z");
  cursor <= new Date("2026-08-29T00:00:00Z");
  cursor.setUTCDate(cursor.getUTCDate() + 1)
) {
  campaignDates.push(cursor.toISOString().slice(0, 10));
}

function expectedHydratedDates(date) {
  const position = campaignDates.indexOf(date);
  if (position < 0) return [];
  return campaignDates.slice(Math.max(0, position - 1), position + 2);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  locale: "zh-CN",
  timezoneId: "Asia/Shanghai",
  reducedMotion: "no-preference",
  serviceWorkers: "block",
});

await context.route("**/api/v1/auth/session", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: false }),
  }),
);
await context.route("https://assets-proxy.anthropic.com/**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "font/woff2",
    path: new URL("../src/assets/fonts/lxgw-wenkai-300.woff2", import.meta.url).pathname,
  }),
);

const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("response", (response) => {
  if (response.status() >= 400) errors.push(`http ${response.status()}: ${response.url()}`);
});
page.on("requestfailed", (request) => {
  const reason = request.failure()?.errorText ?? "unknown";
  if (reason !== "net::ERR_ABORTED") {
    errors.push(`requestfailed ${reason}: ${request.url()}`);
  }
});

async function openSettings() {
  await page.goto(routeUrl("/settings"), { waitUntil: "networkidle" });
  await page.locator("#settings-title").waitFor();
}

async function openDrawer() {
  await page.getByRole("button", { name: "打开工具栏" }).click();
  await page.locator(".tool-drawer.v-navigation-drawer--active").waitFor();
  await page.waitForTimeout(320);
}

async function openDay(date) {
  await page.goto(routeUrl(`/day/${date}`), { waitUntil: "networkidle" });
  await page.locator(`.day-page[data-page-date="${date}"]`).waitFor();
}

async function assertDate(day) {
  const activePage = page.locator('[data-day-flipbook-source][aria-hidden="false"] .date-numeral');
  const fallbackPage = page.locator(".day-flipbook__fallback .date-numeral");
  const locator = await activePage.count() ? activePage : fallbackPage;
  assert.equal((await locator.textContent())?.trim(), day);
}

async function assertFullBook(expectedActiveDate) {
  const result = await page.locator('[data-flipbook-engine="stpageflip"]').evaluate((root) => {
    const sources = [...root.querySelectorAll("[data-day-flipbook-source]")];
    const active = sources.filter((element) => element.getAttribute("aria-hidden") === "false");
    const inactiveAccessible = sources.filter((element) =>
      element.getAttribute("aria-hidden") === "true" && !element.hasAttribute("inert"));
    return {
      count: sources.length,
      declaredCount: Number(root.dataset.pageCount),
      dates: sources.map((element) => element.dataset.pageDate),
      positions: sources.map((element) => Number(element.dataset.pagePosition)),
      orientation: root.querySelector(".stf__wrapper")?.classList.contains("--portrait")
        ? "portrait"
        : "landscape",
      activeDates: active.map((element) => element.dataset.pageDate),
      inactiveAccessible: inactiveAccessible.length,
    };
  });
  assert.equal(result.count, 48);
  assert.equal(result.declaredCount, 48);
  assert.equal(result.orientation, "portrait");
  assert.deepEqual(result.dates, campaignDates);
  assert.deepEqual(result.positions, campaignDates.map((_, index) => index));
  assert.equal(new Set(result.dates).size, 48);
  assert.deepEqual(result.activeDates, [expectedActiveDate]);
  assert.equal(result.inactiveAccessible, 0);
}

async function rememberEngineIdentity() {
  await page.locator('[data-flipbook-engine="stpageflip"]').evaluate((root) => {
    window.__stPageFlipRoot = root;
    window.__stPageFlipSources = [...root.querySelectorAll("[data-day-flipbook-source]")];
  });
}

async function assertEngineIdentity() {
  const result = await page.locator('[data-flipbook-engine="stpageflip"]').evaluate((root) => {
    const sources = [...root.querySelectorAll("[data-day-flipbook-source]")];
    return {
      sameRoot: window.__stPageFlipRoot === root,
      sameSources: sources.length === window.__stPageFlipSources?.length
        && sources.every((source, index) => source === window.__stPageFlipSources[index]),
    };
  });
  assert.equal(result.sameRoot, true);
  assert.equal(result.sameSources, true);
}

async function assertSingleAccessibleDayPage(expectedDate) {
  await page.waitForFunction(
    (date) => {
      const root = document.querySelector(".day-flipbook");
      return root?.dataset.hydrationAnchorDate === date
        && root?.dataset.hydrationRadius === "1";
    },
    expectedDate,
    { timeout: 1_500 },
  );
  const result = await page.evaluate(() => {
    const pages = [...document.querySelectorAll(".day-page")];
    const isAriaHidden = (element) => {
      let current = element;
      while (current) {
        if (current.getAttribute?.("aria-hidden") === "true") return true;
        current = current.parentElement;
      }
      return false;
    };
    const accessible = pages.filter(
      (element) => !element.closest("[inert]") && !isAriaHidden(element),
    );
    return {
      total: pages.length,
      hydratedDates: pages.map((element) => element.dataset.pageDate),
      accessibleDates: accessible.map((element) => element.dataset.pageDate),
    };
  });
  assert.deepEqual(result.hydratedDates, expectedHydratedDates(expectedDate));
  assert.deepEqual(result.accessibleDates, [expectedDate]);
  return result;
}

async function assertNoHydratedDayPages() {
  const result = await page.locator(".day-flipbook").evaluate((root) => ({
    hydratedCount: Number(root.dataset.hydratedPageCount),
    dayPages: root.querySelectorAll(".day-page").length,
    physicalPages: root.querySelectorAll("[data-day-flipbook-source]").length,
  }));
  assert.deepEqual(result, {
    hydratedCount: 0,
    dayPages: 0,
    physicalPages: 48,
  });
}

async function assertNoDuplicateIds() {
  const duplicateIds = await page.evaluate(() => {
    const ids = [...document.querySelectorAll("[id]")]
      .map((element) => element.id)
      .filter(Boolean);
    return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  });
  assert.deepEqual(duplicateIds, []);
}

async function swipeDayLeft() {
  await page.locator('[data-day-flipbook-source][aria-hidden="false"] .day-page').evaluate((target) => {
    const touch = (x) => new Touch({
      identifier: 1,
      target,
      clientX: x,
      clientY: 420,
      pageX: x,
      pageY: 420,
      screenX: x,
      screenY: 420,
      radiusX: 8,
      radiusY: 8,
      force: 0.5,
    });
    const start = touch(330);
    const end = touch(48);
    target.dispatchEvent(new TouchEvent("touchstart", {
      bubbles: true,
      cancelable: true,
      touches: [start],
      targetTouches: [start],
      changedTouches: [start],
    }));
    target.dispatchEvent(new TouchEvent("touchmove", {
      bubbles: true,
      cancelable: true,
      touches: [end],
      targetTouches: [end],
      changedTouches: [end],
    }));
    target.dispatchEvent(new TouchEvent("touchend", {
      bubbles: true,
      cancelable: true,
      touches: [],
      targetTouches: [],
      changedTouches: [end],
    }));
  });
}

async function startTurnAudit(fromDate, toDate) {
  await page.evaluate(({ fromDate: from, toDate: to }) => {
    const root = document.querySelector(".day-flipbook");
    const engine = root?.querySelector('[data-flipbook-engine="stpageflip"]');
    const sources = [...(engine?.querySelectorAll("[data-day-flipbook-source]") ?? [])];
    const sourceDates = new Map(sources.map((source) => [source, source.dataset.pageDate]));
    const audit = {
      from,
      to,
      startedAt: performance.now(),
      frames: [],
      longTasks: [],
      dataDateChanges: 0,
      businessMutations: 0,
      nonAdjacentBusinessMutations: 0,
      nonAdjacentAnimatingBusinessMutations: 0,
      sawBusy: false,
      done: false,
    };

    const processMutations = (records) => {
      for (const record of records) {
        const source = sources.find(
          (candidate) => candidate === record.target || candidate.contains(record.target),
        );
        if (!source) continue;
        if (record.type === "attributes" && record.attributeName === "data-page-date") {
          audit.dataDateChanges += 1;
          continue;
        }
        if (record.type === "childList" || record.type === "characterData") {
          audit.businessMutations += 1;
          const date = sourceDates.get(source);
          if (date !== from && date !== to) {
            audit.nonAdjacentBusinessMutations += 1;
            if (root?.dataset.flipbookPhase === "animating") {
              audit.nonAdjacentAnimatingBusinessMutations += 1;
            }
          }
        }
      }
    };

    const mutationObserver = new MutationObserver(processMutations);
    mutationObserver.observe(engine, {
      attributes: true,
      attributeFilter: ["data-page-date"],
      childList: true,
      characterData: true,
      subtree: true,
    });

    let longTaskObserver = null;
    if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
      longTaskObserver = new PerformanceObserver((list) => {
        audit.longTasks.push(...list.getEntries().map((entry) => ({
          startTime: entry.startTime,
          duration: entry.duration,
        })));
      });
      longTaskObserver.observe({ type: "longtask", buffered: false });
    }

    let lastFrameAt = audit.startedAt;
    const sample = (time) => {
      const isBusy = root?.getAttribute("aria-busy") === "true";
      audit.sawBusy ||= isBusy;
      const visibleItems = [...(engine?.querySelectorAll(".stf__item") ?? [])]
        .filter((element) => element.style.display === "block");
      const shadows = [...(engine?.querySelectorAll(".stf__outerShadow, .stf__innerShadow") ?? [])]
        .filter((element) => getComputedStyle(element).display !== "none");
      audit.frames.push({
        time,
        delta: time - lastFrameAt,
        busy: isBusy,
        phase: root?.dataset.flipbookPhase ?? "missing",
        path: location.pathname,
        rootInert: root?.hasAttribute("inert") ?? false,
        activeDates: [...(engine?.querySelectorAll('[data-day-flipbook-source][aria-hidden="false"]') ?? [])]
          .map((element) => element.dataset.pageDate),
        visibleDates: [...new Set(visibleItems.map((element) => element.dataset.pageDate).filter(Boolean))],
        hasClippedPage: visibleItems.some((element) => element.style.clipPath !== "none"),
        hasTransformedPage: visibleItems.some((element) => element.style.transform !== "none"),
        shadowCount: shadows.length,
        temporaryCopyCount: engine?.querySelectorAll('[data-temporary-copy="true"]').length ?? 0,
      });
      lastFrameAt = time;

      if ((!audit.sawBusy || isBusy) && audit.frames.length < 180) {
        requestAnimationFrame(sample);
        return;
      }

      processMutations(mutationObserver.takeRecords());
      mutationObserver.disconnect();
      if (longTaskObserver) {
        audit.longTasks.push(...longTaskObserver.takeRecords().map((entry) => ({
          startTime: entry.startTime,
          duration: entry.duration,
        })));
        longTaskObserver.disconnect();
      }
      audit.finishedAt = performance.now();
      audit.done = true;
    };

    window.__flipTurnAudit = audit;
    requestAnimationFrame(sample);
  }, { fromDate, toDate });
}

async function finishTurnAudit() {
  await page.waitForFunction(() => window.__flipTurnAudit?.done === true, null, { timeout: 5_000 });
  return page.evaluate(() => {
    const audit = window.__flipTurnAudit;
    return {
      ...audit,
      totalMs: audit.finishedAt - audit.startedAt,
      temporaryCopiesAfter: document.querySelectorAll('[data-temporary-copy="true"]').length,
    };
  });
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function assertTurnAudit(audit, { expectTemporaryCopy }) {
  const animating = audit.frames.filter((frame) => frame.phase === "animating");
  const committing = audit.frames.filter((frame) => frame.phase === "committing");
  const frameDeltas = animating.map((frame) => frame.delta).filter((delta) => delta > 0);
  const longTaskTotal = audit.longTasks.reduce((sum, task) => sum + task.duration, 0);
  const maxLongTask = Math.max(0, ...audit.longTasks.map((task) => task.duration));
  const allowedDates = new Set([audit.from, audit.to]);

  console.log("flipbook turn audit", JSON.stringify({
    from: audit.from,
    to: audit.to,
    totalMs: Math.round(audit.totalMs),
    animatingFrames: animating.length,
    maxLongTask: Math.round(maxLongTask),
    longTaskTotal: Math.round(longTaskTotal),
    animationFrameP95: Math.round(percentile(frameDeltas, 0.95)),
    animationFrameMax: Math.round(Math.max(0, ...frameDeltas)),
    businessMutations: audit.businessMutations,
    nonAdjacentBusinessMutations: audit.nonAdjacentBusinessMutations,
    nonAdjacentAnimatingBusinessMutations: audit.nonAdjacentAnimatingBusinessMutations,
  }));

  assert.ok(animating.length >= 7, `有效动画帧过少: ${JSON.stringify(audit.frames)}`);
  assert.ok(animating.some((frame) => frame.hasClippedPage));
  assert.ok(animating.some((frame) => frame.hasTransformedPage));
  assert.ok(animating.some((frame) => frame.shadowCount >= 2));
  assert.ok(audit.frames.every((frame) => frame.phase !== "recentring"));
  assert.ok(audit.frames.every((frame) => frame.rootInert === false));
  assert.ok(animating.every((frame) => frame.path === `/day/${audit.from}`));
  assert.ok(animating.every((frame) => frame.activeDates.length === 1));
  assert.ok(animating.every((frame) => frame.activeDates[0] === audit.from));
  assert.ok(
    animating.every((frame) => frame.visibleDates.every((date) => allowedDates.has(date))),
    `动画出现第三日期: ${JSON.stringify(animating)}`,
  );
  if (expectTemporaryCopy) {
    assert.ok(animating.some((frame) => frame.temporaryCopyCount === 1));
  } else {
    assert.ok(animating.every((frame) => frame.temporaryCopyCount <= 1));
  }
  assert.ok(audit.frames.every((frame) => frame.temporaryCopyCount <= 1));
  assert.equal(audit.temporaryCopiesAfter, 0);
  assert.equal(audit.dataDateChanges, 0);
  assert.equal(audit.nonAdjacentAnimatingBusinessMutations, 0);
  assert.ok(
    audit.nonAdjacentBusinessMutations <= 16,
    `邻页水合产生了过多 DOM 变更: ${audit.nonAdjacentBusinessMutations}`,
  );

  assert.ok(audit.totalMs <= 900, `翻页总时长过高: ${audit.totalMs.toFixed(1)}ms`);
  assert.ok(maxLongTask <= 150, `单个 long task 过高: ${maxLongTask.toFixed(1)}ms`);
  assert.ok(longTaskTotal <= 220, `long task 总时长过高: ${longTaskTotal.toFixed(1)}ms`);
  assert.ok(percentile(frameDeltas, 0.95) <= 80, `动画帧 P95 过高: ${percentile(frameDeltas, 0.95)}ms`);
  assert.ok(Math.max(0, ...frameDeltas) <= 150, `最大动画帧间隔过高: ${Math.max(...frameDeltas)}ms`);
  if (committing.length) {
    const commitMs = audit.finishedAt - committing[0].time;
    assert.ok(commitMs <= 250, `路由提交阶段过高: ${commitMs.toFixed(1)}ms`);
  }

  return {
    totalMs: Math.round(audit.totalMs),
    maxLongTask: Math.round(maxLongTask),
    longTaskTotal: Math.round(longTaskTotal),
    animationFrameP95: Math.round(percentile(frameDeltas, 0.95)),
    businessMutations: audit.businessMutations,
  };
}

async function assertNoHorizontalOverflow(width) {
  await page.setViewportSize({ width, height: 844 });
  await page.waitForTimeout(220);
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    stageRight: document.querySelector(".day-stage")?.getBoundingClientRect().right,
  }));
  assert.ok(dimensions.documentWidth <= dimensions.viewport);
  assert.ok(dimensions.stageRight <= dimensions.viewport + 0.5);
}

async function clickDayAndWait(name) {
  await page.getByRole("button", { name }).click();
  await page.locator(".day-flipbook--turning").waitFor({ state: "visible", timeout: 3_000 });
  await page.locator(".day-flipbook--turning").waitFor({ state: "hidden", timeout: 4_000 });
}

async function assertSettledTurn(expectedDate, { waitForHydration = true } = {}) {
  if (waitForHydration) {
    await page.waitForFunction(
      (date) => {
        const root = document.querySelector(".day-flipbook");
        return root?.dataset.hydrationAnchorDate === date
          && root?.dataset.hydrationRadius === "1";
      },
      expectedDate,
      { timeout: 1_500 },
    );
  }
  const state = await page.locator(".day-flipbook").evaluate((root) => {
    const engine = root.querySelector('[data-flipbook-engine="stpageflip"]');
    const visibleItems = [...(engine?.querySelectorAll(".stf__item") ?? [])]
      .filter((element) => element.style.display === "block");
    return {
      phase: root.dataset.flipbookPhase,
      busy: root.getAttribute("aria-busy"),
      activeDates: [...(engine?.querySelectorAll('[data-day-flipbook-source][aria-hidden="false"]') ?? [])]
        .map((element) => element.dataset.pageDate),
      temporaryCopies: engine?.querySelectorAll('[data-temporary-copy="true"]').length ?? 0,
      clippedPages: visibleItems.filter((element) => {
        const clipPath = element.style.clipPath;
        return Boolean(clipPath && clipPath !== "none");
      }).length,
      transformedPages: visibleItems.filter((element) => {
        const transform = element.style.transform;
        return Boolean(transform && transform !== "none");
      }).length,
      visibleDates: visibleItems.map((element) => element.dataset.pageDate).filter(Boolean),
      visibleShadows: [...(engine?.querySelectorAll(
        ".stf__outerShadow, .stf__innerShadow, .stf__hardShadow, .stf__hardInnerShadow",
      ) ?? [])].filter((element) => {
        const style = element.style;
        return getComputedStyle(element).display !== "none"
          && Boolean(style.width || style.transform || style.clipPath);
      }).length,
      hydratedDates: [...(engine?.querySelectorAll(".day-page") ?? [])]
        .map((element) => element.dataset.pageDate),
    };
  });
  assert.equal(state.phase, "idle");
  assert.equal(state.busy, "false");
  assert.deepEqual(state.activeDates, [expectedDate]);
  assert.equal(state.temporaryCopies, 0);
  assert.equal(state.clippedPages, 0);
  assert.equal(state.transformedPages, 0);
  assert.deepEqual(state.visibleDates, [expectedDate]);
  assert.equal(state.visibleShadows, 0);
  if (waitForHydration) {
    assert.deepEqual(state.hydratedDates, expectedHydratedDates(expectedDate));
  } else {
    assert.ok(state.hydratedDates.includes(expectedDate));
    assert.ok(state.hydratedDates.length >= 1 && state.hydratedDates.length <= 3);
  }
  assert.equal(new URL(page.url()).pathname, `/day/${expectedDate}`);
}

try {
  await openSettings();
  await assertNoHydratedDayPages();
  assert.equal(await page.getByRole("heading", { name: "翻页效果" }).count(), 0);
  assert.equal(await page.getByRole("radio", { name: "原有翻页" }).count(), 0);
  assert.equal(await page.getByRole("radio", { name: "3D 翻书" }).count(), 0);

  await openDay("2026-07-30");
  const root = page.locator(".day-flipbook");
  const engine = page.locator('[data-flipbook-engine="stpageflip"][data-engine-ready="true"]');
  await engine.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(500);
  assert.equal(await root.getAttribute("data-page-transition"), "flipbook");
  await assertFullBook("2026-07-30");
  await assertSingleAccessibleDayPage("2026-07-30");
  await assertNoDuplicateIds();
  await rememberEngineIdentity();

  await startTurnAudit("2026-07-30", "2026-07-31");
  await swipeDayLeft();
  await page.locator(".day-flipbook--turning").waitFor({ state: "visible", timeout: 3_000 });
  await page.waitForFunction(
    () => window.__flipTurnAudit?.frames.some((frame) => frame.hasClippedPage),
    null,
    { timeout: 2_000 },
  );
  await assertNoDuplicateIds();
  await page.screenshot({ path: "/tmp/study-list-stpageflip.png", fullPage: false });
  await page.locator(".day-flipbook--turning").waitFor({ state: "hidden", timeout: 4_000 });
  const forwardMetrics = assertTurnAudit(await finishTurnAudit(), { expectTemporaryCopy: true });
  await assertDate("31");
  assert.equal(new URL(page.url()).pathname, "/day/2026-07-31");
  await assertFullBook("2026-07-31");
  await assertEngineIdentity();

  await startTurnAudit("2026-07-31", "2026-07-30");
  await page.getByRole("button", { name: "前一天" }).click();
  await page.locator(".day-flipbook--turning").waitFor({ state: "visible", timeout: 3_000 });
  await page.locator(".day-flipbook--turning").waitFor({ state: "hidden", timeout: 4_000 });
  const backwardMetrics = assertTurnAudit(await finishTurnAudit(), { expectTemporaryCopy: false });
  await assertDate("30");
  assert.equal(new URL(page.url()).pathname, "/day/2026-07-30");
  await assertFullBook("2026-07-30");
  await assertEngineIdentity();

  await openDrawer();
  await swipeDayLeft();
  await page.locator(".day-flipbook--turning").waitFor({ state: "visible", timeout: 3_000 });
  await page.getByText("设置", { exact: true }).dispatchEvent("click");
  await page.locator("#settings-title").waitFor();
  await page.waitForTimeout(1_200);
  assert.equal(new URL(page.url()).pathname, "/settings");
  assert.equal(await root.getAttribute("aria-busy"), "false");
  await assertNoHydratedDayPages();
  await page.getByRole("button", { name: "返回" }).click();
  await engine.waitFor({ state: "visible" });
  await assertDate("30");
  await assertFullBook("2026-07-30");
  await assertSingleAccessibleDayPage("2026-07-30");
  await assertEngineIdentity();

  for (const width of [360, 390, 430]) await assertNoHorizontalOverflow(width);

  await clickDayAndWait("后一天");
  await assertSettledTurn("2026-07-31");
  await assertFullBook("2026-07-31");
  await assertSingleAccessibleDayPage("2026-07-31");
  await assertEngineIdentity();
  await assertNoDuplicateIds();

  const july31Index = campaignDates.indexOf("2026-07-31");
  const continuousForwardDates = campaignDates.slice(july31Index + 1, july31Index + 21);
  for (const date of continuousForwardDates) {
    await clickDayAndWait("后一天");
    await assertSettledTurn(date, { waitForHydration: false });
  }
  const continuousBackwardDates = [
    ...continuousForwardDates.slice(0, -1).reverse(),
    "2026-07-31",
  ];
  for (const date of continuousBackwardDates) {
    await clickDayAndWait("前一天");
    await assertSettledTurn(date, { waitForHydration: false });
  }
  await assertSettledTurn("2026-07-31");
  await assertFullBook("2026-07-31");
  await assertEngineIdentity();
  assert.equal(await page.locator('[data-temporary-copy="true"]').count(), 0);

  // Regression for the screenshot failure: a mobile-created instance used to
  // switch to a two-page landscape spread when the viewport became wide. The
  // flip event then skipped from index 36 to 38 and left 08/18 half-folded.
  await page.setViewportSize({ width: 390, height: 844 });
  await openDay("2026-08-18");
  const resizedEngine = page.locator(
    '[data-flipbook-engine="stpageflip"][data-engine-ready="true"]',
  );
  await resizedEngine.waitFor({ state: "visible", timeout: 15_000 });
  await page.setViewportSize({ width: 1673, height: 1460 });
  await page.waitForTimeout(320);
  await assertFullBook("2026-08-18");
  await assertSettledTurn("2026-08-18");
  const resizedNextEar = page.locator(".day-ear--right");
  await resizedNextEar.click();
  await page.locator(".day-flipbook--turning").waitFor({ state: "visible", timeout: 3_000 });
  const resizedTurnStartedAt = Date.now();
  await page.locator(".day-flipbook--turning").waitFor({ state: "hidden", timeout: 4_000 });
  const resizedTurnMs = Date.now() - resizedTurnStartedAt;
  assert.ok(resizedTurnMs <= 1_600, `宽屏翻页不应等待 fallback: ${resizedTurnMs}ms`);
  await assertSettledTurn("2026-08-19");

  // Strict debounce: buttons and swipe navigation stay locked until the whole
  // physical turn, engine cleanup, route commit, and active-date commit finish.
  await page.setViewportSize({ width: 390, height: 844 });
  await openDay("2026-07-30");
  const debounceEngine = page.locator(
    '[data-flipbook-engine="stpageflip"][data-engine-ready="true"]',
  );
  await debounceEngine.waitFor({ state: "visible", timeout: 15_000 });
  const previousEar = page.locator(".day-ear--left");
  const nextEar = page.locator(".day-ear--right");
  await nextEar.click();
  await page.locator(".day-flipbook--turning").waitFor({ state: "visible", timeout: 3_000 });
  assert.equal(await previousEar.isDisabled(), true);
  assert.equal(await nextEar.isDisabled(), true);
  await previousEar.dispatchEvent("click");
  for (let intent = 0; intent < 4; intent += 1) {
    await page.waitForTimeout(35);
    await nextEar.dispatchEvent("click");
  }
  await swipeDayLeft();
  await page.locator(".day-flipbook--turning").waitFor({ state: "hidden", timeout: 4_000 });
  await assertSettledTurn("2026-07-31");
  assert.equal(await previousEar.isDisabled(), false);
  assert.equal(await nextEar.isDisabled(), false);
  await swipeDayLeft();
  await page.locator(".day-flipbook--turning").waitFor({ state: "visible", timeout: 3_000 });
  await page.locator(".day-flipbook--turning").waitFor({ state: "hidden", timeout: 4_000 });
  await assertSettledTurn("2026-08-01");

  // A queued right-ear click must not bypass the navigation lock while the
  // final campaign date is being committed and jump directly to the ending.
  await openDay("2026-08-28");
  await debounceEngine.waitFor({ state: "visible", timeout: 15_000 });
  await page.evaluate(() => {
    const root = document.querySelector(".day-flipbook");
    const rightEar = document.querySelector(".day-ear--right");
    window.__finalDayBusyClickInjected = false;
    const observer = new MutationObserver(() => {
      const finalPageActive = root?.querySelector(
        '[data-day-flipbook-source][data-page-date="2026-08-29"][aria-hidden="false"]',
      );
      if (
        root?.dataset.flipbookPhase !== "committing"
        || !finalPageActive
        || window.__finalDayBusyClickInjected
      ) return;
      window.__finalDayBusyClickInjected = true;
      rightEar?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      observer.disconnect();
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["aria-hidden", "data-flipbook-phase"],
      subtree: true,
    });
  });
  await nextEar.click();
  await page.locator(".day-flipbook--turning").waitFor({ state: "visible", timeout: 3_000 });
  await page.locator(".day-flipbook--turning").waitFor({ state: "hidden", timeout: 4_000 });
  assert.equal(await page.evaluate(() => window.__finalDayBusyClickInjected), true);
  await assertSettledTurn("2026-08-29");

  assert.deepEqual(errors, []);
  console.log(
    `flipbook QA passed: 48 stable page shells; at most 3 hydrated Day pages; forward=${JSON.stringify(forwardMetrics)}; backward=${JSON.stringify(backwardMetrics)}`,
  );
} catch (error) {
  if (errors.length) console.error(`browser diagnostics:\n${errors.join("\n")}`);
  throw error;
} finally {
  await browser.close();
}
