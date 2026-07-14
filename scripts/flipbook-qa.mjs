import assert from "node:assert/strict";

import { chromium } from "playwright";

const baseUrl = process.env.QA_URL || "http://127.0.0.1:4173/";
const routeUrl = (path) => new URL(path, baseUrl).href;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  locale: "zh-CN",
  timezoneId: "Asia/Shanghai",
});

await context.route("**/api/v1/auth/session", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: false }),
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

async function openSettings() {
  await page.goto(routeUrl("/settings"), { waitUntil: "networkidle" });
  await page.locator("#settings-title").waitFor();
}

async function selectTransition(name) {
  const radio = page.getByRole("radio", { name });
  await radio.click();
  await assert.doesNotReject(() => radio.isChecked());
  assert.equal(await radio.isChecked(), true);
  await page.waitForTimeout(1_250);
}

async function openDay(date) {
  await page.goto(routeUrl(`/day/${date}`), { waitUntil: "networkidle" });
  await page.locator(".day-page").waitFor();
}

async function assertDate(day) {
  assert.equal((await page.locator(".date-numeral").textContent())?.trim(), day);
}

async function swipeDayLeft() {
  await page.locator(".day-page").evaluate((target) => {
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
    const end = touch(60);
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

async function assertNoHorizontalOverflow(width) {
  await page.setViewportSize({ width, height: 844 });
  await page.waitForTimeout(80);
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    stageRight: document.querySelector(".day-stage")?.getBoundingClientRect().right,
  }));
  assert.ok(
    dimensions.documentWidth <= dimensions.viewport,
    `${width}px 下发生横向溢出: ${JSON.stringify(dimensions)}`,
  );
  assert.ok(dimensions.stageRight <= dimensions.viewport + 0.5);
}

try {
  await openSettings();
  assert.equal(await page.getByRole("radio", { name: "原有翻页" }).isChecked(), true);
  await selectTransition("3D 翻书");

  await openDay("2026-07-14");
  assert.equal(
    await page.locator(".day-flipbook").getAttribute("data-page-transition"),
    "flipbook",
  );

  await swipeDayLeft();
  const turning = page.locator(".day-flipbook--turning");
  await turning.waitFor({ state: "visible", timeout: 3_000 });
  await page.waitForTimeout(220);
  const engine = page.locator('[data-flipbook-engine="strata"][data-engine-ready="true"]');
  await engine.waitFor({ state: "visible", timeout: 3_000 });
  assert.ok(await engine.locator(".st-flipbook-flip-page").count());
  assert.ok(await engine.locator(".st-flipbook-page-left .date-numeral").count());
  await page.screenshot({ path: "/tmp/study-list-flipbook.png", fullPage: false });
  await turning.waitFor({ state: "hidden", timeout: 3_000 });
  assert.equal(await page.locator(".strata-flipbook-engine").count(), 0);
  await assertDate("15");
  assert.equal(new URL(page.url()).pathname, "/day/2026-07-15");

  await page.getByRole("button", { name: "前一天" }).click();
  await turning.waitFor({ state: "visible", timeout: 3_000 });
  await engine.waitFor({ state: "visible", timeout: 3_000 });
  const previousUnderlay = engine.locator(".st-flipbook-page-right .date-numeral");
  await previousUnderlay.waitFor({ state: "visible", timeout: 3_000 });
  assert.ok(await previousUnderlay.count());
  await turning.waitFor({ state: "hidden", timeout: 3_000 });
  assert.equal(await page.locator(".strata-flipbook-engine").count(), 0);
  await assertDate("14");

  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".day-page").waitFor();
  assert.equal(
    await page.locator(".day-flipbook").getAttribute("data-page-transition"),
    "flipbook",
  );
  for (const width of [360, 390, 430]) await assertNoHorizontalOverflow(width);

  await openSettings();
  assert.equal(await page.getByRole("radio", { name: "3D 翻书" }).isChecked(), true);
  await selectTransition("原有翻页");
  await openDay("2026-07-14");
  assert.equal(
    await page.locator(".day-flipbook").getAttribute("data-page-transition"),
    "classic",
  );
  await page.getByRole("button", { name: "后一天" }).click();
  await page.waitForTimeout(80);
  assert.equal(await page.locator(".day-flipbook--turning").count(), 0);
  await page.waitForTimeout(300);
  await assertDate("15");

  assert.deepEqual(errors, []);
  console.log("flipbook QA passed: settings, CSS 3D animation, persistence, direction and widths");
} catch (error) {
  if (errors.length) console.error(`browser diagnostics:\n${errors.join("\n")}`);
  throw error;
} finally {
  await browser.close();
}
