import { chromium } from "playwright";

const baseUrl = process.env.QA_URL || "http://127.0.0.1:4173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  locale: "zh-CN",
  timezoneId: "Asia/Shanghai",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

async function dispatchTouchGesture(selector, startPoints, movePoints) {
  await page.locator(selector).evaluate(
    (target, { startPoints: starts, movePoints: moves }) => {
      const createTouches = (points) =>
        points.map(
          (point, index) =>
            new Touch({
              identifier: index + 1,
              target,
              clientX: point.x,
              clientY: point.y,
              pageX: point.x,
              pageY: point.y,
              screenX: point.x,
              screenY: point.y,
              radiusX: 8,
              radiusY: 8,
              force: 0.5,
            }),
        );
      const startTouches = createTouches(starts);
      const moveTouches = createTouches(moves);
      target.dispatchEvent(
        new TouchEvent("touchstart", {
          bubbles: true,
          cancelable: true,
          touches: startTouches,
          targetTouches: startTouches,
          changedTouches: startTouches,
        }),
      );
      target.dispatchEvent(
        new TouchEvent("touchmove", {
          bubbles: true,
          cancelable: true,
          touches: moveTouches,
          targetTouches: moveTouches,
          changedTouches: moveTouches,
        }),
      );
      target.dispatchEvent(
        new TouchEvent("touchend", {
          bubbles: true,
          cancelable: true,
          touches: [],
          targetTouches: [],
          changedTouches: moveTouches,
        }),
      );
    },
    { startPoints, movePoints },
  );
}

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.waitForSelector(".poetic-header");
await page.waitForTimeout(450);

const firstStatus = page.locator(".status-button").first();
const lastStatus = page.locator(".status-button").last();

// 与选定视觉稿保持同一状态：第 1 项完成，第 8 项未完成。
await firstStatus.click();
await lastStatus.click();
await lastStatus.click();
await page.waitForTimeout(180);
await page.screenshot({ path: "qa/implementation-day.png", fullPage: false });

// 再次切换已完成项，单独留存双未完成状态的交互证据。
await firstStatus.click();
if ((await page.locator(".study-item--missed").count()) < 2) {
  throw new Error("任务未完成状态没有出现");
}
await page.waitForTimeout(180);
await page.screenshot({ path: "qa/implementation-states.png", fullPage: false });
await firstStatus.click();

const slotSix = page.getByRole("textbox", { name: "第 6 项补充内容" });
await slotSix.fill("晚间复盘");
await page.getByRole("textbox", { name: "日结或日记" }).fill("今天把细小的疑问写清楚了。");
await page.waitForTimeout(650);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".poetic-header");
if ((await page.getByRole("textbox", { name: "第 6 项补充内容" }).inputValue()) !== "晚间复盘") {
  throw new Error("IndexedDB 刷新恢复失败");
}

// 真实 TouchEvent 回归：横滑翻日、双指捏合逐级进入周/月，再反向返回日视图。
await dispatchTouchGesture(".day-page", [{ x: 330, y: 420 }], [{ x: 60, y: 420 }]);
await page.waitForTimeout(520);
if ((await page.locator(".date-numeral").textContent())?.trim() !== "14") {
  throw new Error("左滑翻日失败");
}
await dispatchTouchGesture(
  ".mobile-prototype",
  [
    { x: 55, y: 380 },
    { x: 335, y: 380 },
  ],
  [
    { x: 135, y: 380 },
    { x: 255, y: 380 },
  ],
);
await page.waitForSelector(".week-overview");
await dispatchTouchGesture(
  ".mobile-prototype",
  [
    { x: 55, y: 380 },
    { x: 335, y: 380 },
  ],
  [
    { x: 135, y: 380 },
    { x: 255, y: 380 },
  ],
);
await page.waitForSelector(".month-overview");
for (const selector of [".week-overview", ".day-page"]) {
  await dispatchTouchGesture(
    ".mobile-prototype",
    [
      { x: 135, y: 380 },
      { x: 255, y: 380 },
    ],
    [
      { x: 45, y: 380 },
      { x: 345, y: 380 },
    ],
  );
  await page.waitForSelector(selector);
}
await page.locator(".day-ear--left").click();
await page.waitForTimeout(480);

for (let index = 0; index < 5; index += 1) {
  await page.locator(".day-ear--right").click();
  await page.waitForTimeout(480);
}
await page.waitForSelector(".saturday-view");
await page.screenshot({ path: "qa/implementation-saturday.png", fullPage: false });
const saturdayDraft = page.getByPlaceholder("写下这一项，回车继续");
await saturdayDraft.fill("完成化学专题卷");
await saturdayDraft.press("Enter");
if ((await page.locator(".saturday-row:not(.saturday-row--draft)").count()) !== 1) {
  throw new Error("周六自动编号新增失败");
}

await page.getByRole("button", { name: "打开工具栏" }).click();
await page.getByText("周视图", { exact: true }).click();
await page.waitForSelector(".week-overview");
if (!new URL(page.url()).hash.startsWith("#/week/")) {
  throw new Error("周视图未进入独立路由");
}
await page.waitForTimeout(450);
await page.screenshot({ path: "qa/implementation-week.png", fullPage: false });

await page.getByRole("button", { name: "打开工具栏" }).click();
await page.getByText("月视图", { exact: true }).click();
await page.waitForSelector(".month-overview");
if (!new URL(page.url()).hash.startsWith("#/month/")) {
  throw new Error("月视图未进入独立路由");
}
await page.waitForTimeout(450);
await page.screenshot({ path: "qa/implementation-month.png", fullPage: false });

await page.getByRole("button", { name: "打开工具栏" }).click();
await page.getByText("总统计", { exact: true }).click();
await page.waitForSelector(".total-stats-view");
if (new URL(page.url()).hash !== "#/stats/total") {
  throw new Error("总统计未进入独立路由");
}
await page.waitForTimeout(450);
await page.screenshot({ path: "qa/implementation-total.png", fullPage: false });

await page.getByRole("button", { name: "打开工具栏" }).click();
await page.getByText("赠语收藏", { exact: true }).click();
await page.waitForSelector(".favorites-view");
if (new URL(page.url()).hash !== "#/favorites") {
  throw new Error("赠语收藏未进入独立路由");
}

await page.getByRole("button", { name: "打开工具栏" }).click();
await page.getByText("日视图", { exact: true }).click();
await page.waitForSelector(".poetic-header");
await page.getByRole("button", { name: "打开工具栏" }).click();
await page.locator(".v-navigation-drawer").getByText("本周统计", { exact: true }).click();
await page.waitForSelector(".week-stats-view");
if (!new URL(page.url()).hash.startsWith("#/stats/week/")) {
  throw new Error("本周统计未进入独立路由");
}
await page.waitForTimeout(450);
await page.screenshot({ path: "qa/implementation-week-stats.png", fullPage: false });
await page.getByRole("button", { name: "返回", exact: true }).click();
await page.waitForSelector(".poetic-header");

await page.getByRole("button", { name: "打开工具栏" }).click();
await page.getByText("摸鱼大转盘", { exact: true }).click();
await page.waitForSelector(".raffle-view");
if (new URL(page.url()).hash !== "#/raffle") {
  throw new Error("摸鱼大转盘未进入独立路由");
}
await page.waitForTimeout(450);
await page.screenshot({ path: "qa/implementation-raffle.png", fullPage: false });

const widths = [];
for (const width of [360, 390, 430]) {
  await page.setViewportSize({ width, height: 844 });
  await page.waitForTimeout(120);
  widths.push(
    await page.evaluate((viewportWidth) => ({
      viewportWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
    }), width),
  );
}

const desktopContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
  locale: "zh-CN",
  timezoneId: "Asia/Shanghai",
});
const desktopPage = await desktopContext.newPage();
desktopPage.on("pageerror", (error) => errors.push(`desktop pageerror: ${error.message}`));
desktopPage.on("console", (message) => {
  if (message.type() === "error") errors.push(`desktop console: ${message.text()}`);
});

const desktopRoutes = [
  ["#/day/2026-07-13", ".poetic-header"],
  ["#/week/2026-07-13", ".week-overview"],
  ["#/month/2026-07", ".month-overview"],
  ["#/stats/week/2026-07-13", ".week-stats-view"],
  ["#/stats/total", ".total-stats-view"],
  ["#/favorites", ".favorites-view"],
  ["#/raffle", ".raffle-view"],
];

for (const [hash, selector] of desktopRoutes) {
  await desktopPage.goto(`${baseUrl}${hash}`, { waitUntil: "domcontentloaded" });
  await desktopPage.waitForSelector(selector);
  await desktopPage.reload({ waitUntil: "domcontentloaded" });
  await desktopPage.waitForSelector(selector);
  if (new URL(desktopPage.url()).hash !== hash) {
    throw new Error(`路由刷新后未保持: ${hash}`);
  }
  const drawerBox = await desktopPage.locator(".v-navigation-drawer").boundingBox();
  if (!drawerBox || drawerBox.x < -1 || drawerBox.width < 280) {
    throw new Error(`桌面侧边栏未常驻: ${hash}`);
  }
  if (hash.startsWith("#/day/")) {
    await desktopPage.screenshot({ path: "qa/implementation-desktop-day.png", fullPage: false });
  }
  if (hash === "#/stats/total") {
    await desktopPage.screenshot({ path: "qa/implementation-desktop-total.png", fullPage: false });
  }
  if (hash === "#/raffle") {
    await desktopPage.screenshot({ path: "qa/implementation-desktop-raffle.png", fullPage: false });
  }
}

await desktopPage.goto(`${baseUrl}#/day/2026-07-13`, { waitUntil: "domcontentloaded" });
await desktopPage.waitForSelector(".poetic-header");
const desktopCopy = desktopPage.getByRole("button", { name: "复制今日赠语" }).last();
for (let index = 0; index < 3; index += 1) await desktopCopy.click();
await desktopPage.waitForTimeout(320);
const snackbarState = await desktopPage.evaluate(() => ({
  active: document.querySelectorAll(".v-snackbar--active").length,
  collapsed: document.querySelectorAll(".v-snackbar--active.v-snackbar--collapsed").length,
}));
if (snackbarState.active < 3 || snackbarState.collapsed < 2) {
  throw new Error(`Snackbar Queue 未正确折叠: ${JSON.stringify(snackbarState)}`);
}
await desktopPage.screenshot({ path: "qa/implementation-desktop-snackbar-queue.png", fullPage: false });
await desktopPage.locator(".v-navigation-drawer").getByText("总统计", { exact: true }).click();
await desktopPage.waitForSelector(".total-stats-view");
await desktopPage.goBack();
await desktopPage.waitForSelector(".poetic-header");
if (new URL(desktopPage.url()).hash !== "#/day/2026-07-13") {
  throw new Error("浏览器后退未恢复日视图路由");
}
await desktopPage.goForward();
await desktopPage.waitForSelector(".total-stats-view");
if (new URL(desktopPage.url()).hash !== "#/stats/total") {
  throw new Error("浏览器前进未恢复总统计路由");
}

const desktopLayout = await desktopPage.evaluate(() => ({
  viewportWidth: window.innerWidth,
  documentWidth: document.documentElement.scrollWidth,
  appWidth: document.querySelector(".mobile-prototype")?.getBoundingClientRect().width ?? 0,
  drawerWidth: document.querySelector(".v-navigation-drawer")?.getBoundingClientRect().width ?? 0,
}));
if (desktopLayout.documentWidth > desktopLayout.viewportWidth) {
  throw new Error(`桌面横向溢出: ${JSON.stringify(desktopLayout)}`);
}
if (Math.abs(desktopLayout.appWidth - desktopLayout.viewportWidth) > 1 || desktopLayout.drawerWidth < 280) {
  throw new Error(`桌面布局未展开: ${JSON.stringify(desktopLayout)}`);
}

await desktopContext.close();

await browser.close();

const overflow = widths.filter(
  (entry) => entry.scrollWidth > entry.viewportWidth || entry.bodyScrollWidth > entry.viewportWidth,
);
if (overflow.length) throw new Error(`横向溢出: ${JSON.stringify(overflow)}`);
if (errors.length) throw new Error(`浏览器错误: ${errors.join(" | ")}`);

console.log(JSON.stringify({ status: "passed", widths, desktopLayout, errors }, null, 2));
