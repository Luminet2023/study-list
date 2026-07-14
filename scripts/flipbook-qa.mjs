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

async function startFlipFrameAudit() {
  await page.evaluate(() => {
    const frames = [];
    let sawBusy = false;

    const text = (selector, root = document) =>
      root.querySelector(selector)?.textContent?.trim() ?? "";
    const visibleStaticDay = (engine) => {
      if (!engine) return "";
      const page = [
        engine.querySelector(".st-flipbook-page-left"),
        engine.querySelector(".st-flipbook-page-right"),
      ].find((candidate) => candidate && getComputedStyle(candidate).display !== "none");
      return page?.querySelector(".date-numeral")?.textContent?.trim() ?? "";
    };

    const sample = () => {
      const root = document.querySelector(".day-flipbook");
      const live = root?.querySelector(".day-flipbook__live");
      const overlay = root?.querySelector(".day-flipbook__overlay");
      const engine = root?.querySelector(".strata-flipbook-engine");
      const scene = engine?.querySelector(".st-flipbook-scene");
      const busy = root?.getAttribute("aria-busy") === "true";
      sawBusy ||= busy;
      frames.push({
        time: performance.now(),
        busy,
        phase: root?.dataset.flipbookPhase ?? "missing",
        liveDay: text(".date-numeral", live),
        liveVisibility: live ? getComputedStyle(live).visibility : "missing",
        overlayDisplay: overlay ? getComputedStyle(overlay).display : "missing",
        holdDay: text(".day-flipbook__holding .date-numeral", root),
        staticDay: visibleStaticDay(engine),
        engineTurning: engine?.getAttribute("data-st-flip-turning") === "true",
        sceneAnimation: scene ? getComputedStyle(scene).animationName : "",
        sceneOpacity: scene ? getComputedStyle(scene).opacity : "",
        leftEar: text(".day-ear--left .day-ear__label"),
        rightEar: text(".day-ear--right .day-ear__label"),
      });

      if ((!sawBusy || busy) && frames.length < 240) {
        requestAnimationFrame(sample);
      } else {
        window.__flipbookFrameAuditDone = true;
      }
    };

    window.__flipbookFrameAudit = frames;
    window.__flipbookFrameAuditDone = false;
    requestAnimationFrame(sample);
  });
}

async function readFlipFrameAudit() {
  await page.waitForFunction(() => window.__flipbookFrameAuditDone === true);
  return page.evaluate(() => window.__flipbookFrameAudit);
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

  await openDay("2026-07-20");
  assert.equal(
    await page.locator(".day-flipbook").getAttribute("data-page-transition"),
    "flipbook",
  );

  const sourceLeftEar = (await page.locator(".day-ear--left .day-ear__label").textContent())?.trim();
  const sourceRightEar = (await page.locator(".day-ear--right .day-ear__label").textContent())?.trim();
  await startFlipFrameAudit();
  await swipeDayLeft();
  const turning = page.locator(".day-flipbook--turning");
  await turning.waitFor({ state: "visible", timeout: 3_000 });
  const engine = page.locator('[data-flipbook-engine="strata"][data-engine-ready="true"]');
  await engine.waitFor({ state: "visible", timeout: 3_000 });
  const activeEngine = engine.locator('[data-st-flip-turning="true"]');
  await activeEngine.waitFor({ state: "visible", timeout: 3_000 });
  await page.screenshot({ path: "/tmp/study-list-flipbook.png", fullPage: false });
  const renderingStyles = await engine.evaluate((root) => {
    const scene = root.querySelector(".st-flipbook-scene");
    const face = root.querySelector(".st-flipbook-flip-front");
    const leaf = root.querySelector(".st-flipbook-flip-page");
    const flipbook = root.querySelector(".strata-flipbook-engine");
    return {
      sceneAnimation: getComputedStyle(scene).animationName,
      sceneOpacity: getComputedStyle(scene).opacity,
      faceClipPath: getComputedStyle(face).clipPath,
      cornerDisplay: getComputedStyle(leaf, "::after").display,
      pageSkew: getComputedStyle(flipbook).getPropertyValue("--st-flip-skew-k").trim(),
    };
  });
  assert.deepEqual(renderingStyles, {
    sceneAnimation: "none",
    sceneOpacity: "1",
    faceClipPath: "none",
    cornerDisplay: "none",
    pageSkew: "0deg",
  });
  assert.ok(await engine.locator(".st-flipbook-flip-page").count());
  assert.ok(await engine.locator(".st-flipbook-page-left .date-numeral").count());
  await turning.waitFor({ state: "hidden", timeout: 3_000 });
  const frames = await readFlipFrameAudit();
  const busyFrames = frames.filter((frame) => frame.busy);
  assert.ok(busyFrames.length > 0, "未记录到 Flipbook busy 帧");
  assert.ok(
    busyFrames.some((frame) => ["holding", "preparing"].includes(frame.phase)),
    "动画前未显示旧页冻结层",
  );
  for (const frame of busyFrames) {
    if (frame.liveDay === "21") {
      assert.equal(frame.liveVisibility, "hidden", `21 日在动画前泄露: ${JSON.stringify(frame)}`);
    }
    assert.equal(frame.leftEar, sourceLeftEar, `翻页期间左侧日期抢跑: ${JSON.stringify(frame)}`);
    assert.equal(frame.rightEar, sourceRightEar, `翻页期间右侧日期抢跑: ${JSON.stringify(frame)}`);
    if (["holding", "preparing"].includes(frame.phase)) {
      assert.equal(frame.overlayDisplay, "block", `冻结层未显示: ${JSON.stringify(frame)}`);
      assert.equal(frame.holdDay || frame.staticDay, "20", `旧页冻结错误: ${JSON.stringify(frame)}`);
    }
    if (frame.sceneAnimation) {
      assert.equal(frame.sceneAnimation, "none", `插件淡入仍在运行: ${JSON.stringify(frame)}`);
      assert.equal(frame.sceneOpacity, "1", `插件场景未完全不透明: ${JSON.stringify(frame)}`);
    }
  }
  assert.equal(await page.locator(".strata-flipbook-engine").count(), 0);
  await assertDate("21");
  assert.equal(new URL(page.url()).pathname, "/day/2026-07-21");
  assert.notEqual(
    (await page.locator(".day-ear--right .day-ear__label").textContent())?.trim(),
    sourceRightEar,
  );

  await page.getByRole("button", { name: "前一天" }).click();
  await turning.waitFor({ state: "visible", timeout: 3_000 });
  await engine.waitFor({ state: "visible", timeout: 3_000 });
  const previousUnderlay = engine.locator(".st-flipbook-page-right .date-numeral");
  await previousUnderlay.waitFor({ state: "visible", timeout: 3_000 });
  assert.ok(await previousUnderlay.count());
  await turning.waitFor({ state: "hidden", timeout: 3_000 });
  assert.equal(await page.locator(".strata-flipbook-engine").count(), 0);
  await assertDate("20");

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
  await openDay("2026-07-20");
  assert.equal(
    await page.locator(".day-flipbook").getAttribute("data-page-transition"),
    "classic",
  );
  await page.getByRole("button", { name: "后一天" }).click();
  await page.waitForTimeout(80);
  assert.equal(await page.locator(".day-flipbook--turning").count(), 0);
  await page.waitForTimeout(300);
  await assertDate("21");

  assert.deepEqual(errors, []);
  console.log("flipbook QA passed: no date flash, smooth 3D rendering, frozen ears and persistence");
} catch (error) {
  if (errors.length) console.error(`browser diagnostics:\n${errors.join("\n")}`);
  throw error;
} finally {
  await browser.close();
}
