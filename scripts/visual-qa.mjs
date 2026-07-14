import { chromium } from "playwright";

const baseUrl = process.env.QA_URL || "http://127.0.0.1:4173/";
const routeUrl = (path) => new URL(path, baseUrl).href;
const currentRoute = (url) => {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
};
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  locale: "zh-CN",
  timezoneId: "Asia/Shanghai",
});
await context.route("**/v1/auth/session", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: false }),
  }),
);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("response", (response) => {
  if (response.status() >= 400) {
    errors.push(`http ${response.status()}: ${response.url()}`);
  }
});
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
  if (message.type() === "warning" && message.text().includes("[Vuetify UPGRADE]")) {
    errors.push(`console warning: ${message.text()}`);
  }
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
const diaryTrigger = page.getByRole("button", { name: "打开日记编辑器" });

const assertDiaryLocked = async (message) => {
  if ((await diaryTrigger.getAttribute("aria-disabled")) !== "true") {
    throw new Error(message);
  }
};

const assertDiaryUnlocked = async (message) => {
  if ((await diaryTrigger.getAttribute("aria-disabled")) !== "false") {
    throw new Error(message);
  }
};

if ((await page.locator(".status-button:disabled").count()) !== 8) {
  throw new Error("目标锁定前 checkbox 未全部禁用");
}
await assertDiaryLocked("目标未锁定时日结不应可编辑");
await page.screenshot({ path: "qa/implementation-goal-gate.png", fullPage: false });

await page.getByRole("textbox", { name: "第 4 项补充内容" }).fill("必修一");
await page.getByRole("textbox", { name: "第 7 项补充内容" }).fill("第三章");

const lockButton = page.getByRole("button", { name: "核对并锁定今日目标" });
await lockButton.waitFor();
if ((await page.locator(".status-button:disabled").count()) !== 8) {
  throw new Error("填写完成但确认锁定前 checkbox 不应开放");
}
await lockButton.click();
await page.getByText("锁定今日目标", { exact: true }).waitFor();
await page.waitForTimeout(320);
await page.screenshot({ path: "qa/implementation-goal-lock-dialog.png", fullPage: false });
for (const text of ["生物必修一", "6. 留空（不计入今日计划）", "生物课本第三章阅读研习"]) {
  if (!(await page.getByText(new RegExp(text)).count())) {
    throw new Error(`锁定弹窗缺少目标: ${text}`);
  }
}
await page.getByRole("button", { name: "确认锁定目标" }).click();
await page.waitForTimeout(180);
if ((await page.locator(".status-button:enabled").count()) !== 7) {
  throw new Error("锁定目标后已计划 checkbox 未全部开放");
}
if ((await page.locator(".study-item--unplanned .status-button:disabled").count()) !== 1) {
  throw new Error("留空第 6 项未保持未计划禁用状态");
}
await assertDiaryLocked("尚未完成全部 checkbox 时日结不应开放");

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
for (const index of [1, 2, 3, 4, 6]) {
  await page.locator(".status-button").nth(index).click();
}
await assertDiaryUnlocked("全部目标已有完成或未完成结果时，日结应解锁");
await page.waitForTimeout(180);
await page.screenshot({ path: "qa/implementation-warning-settled.png", fullPage: false });
await firstStatus.click();
await lastStatus.click();
if ((await page.locator(".study-item--completed").count()) !== 7) {
  throw new Error("未能完成全部已计划 checkbox");
}
await assertDiaryUnlocked("完成全部 checkbox 后日结未解锁");
await diaryTrigger.click();
const diaryField = page.getByRole("textbox", { name: "日记内容" });
await diaryField.waitFor({ state: "visible" });
await diaryField.fill("今天把细小的疑问写清楚了。");
await page.getByRole("button", { name: "保存日记" }).click();
await diaryField.waitFor({ state: "hidden" });
await page.waitForTimeout(650);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".poetic-header");
if ((await page.getByRole("textbox", { name: "第 6 项补充内容" }).inputValue()) !== "") {
  throw new Error("IndexedDB 刷新恢复失败");
}
await assertDiaryUnlocked("目标锁定与日结解锁状态刷新后未恢复");
if ((await page.locator(".status-button:enabled").count()) !== 7) {
  throw new Error("目标锁定状态刷新后未恢复");
}
await diaryTrigger.click();
const restoredDiaryField = page.getByRole("textbox", { name: "日记内容" });
if ((await restoredDiaryField.inputValue()) !== "今天把细小的疑问写清楚了。") {
  throw new Error("日结内容刷新恢复失败");
}
await page.getByRole("button", { name: "关闭编辑器" }).click();

// 真实 TouchEvent 回归：左滑以拟真翻页动画直接进入下一日。
await dispatchTouchGesture(".day-page", [{ x: 330, y: 420 }], [{ x: 60, y: 420 }]);
await page.waitForSelector(".day-page");
await page.waitForTimeout(420);
if ((await page.locator(".date-numeral").textContent())?.trim() !== "14") {
  throw new Error("左滑直接翻到下一天失败");
}
// 双指捏合逐级进入周/月，再反向返回日视图。
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
  await page.waitForSelector(".day-page");
  await page.waitForTimeout(360);
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
if (!currentRoute(page.url()).startsWith("/week/")) {
  throw new Error("周视图未进入独立路由");
}
await page.waitForTimeout(450);
await page.screenshot({ path: "qa/implementation-week.png", fullPage: false });

const mobileRoutes = [
  ["/month/2026-07", ".month-overview", "qa/implementation-month.png"],
  ["/stats/total", ".total-stats-view", "qa/implementation-total.png"],
  ["/favorites", ".favorites-view", null],
  ["/stats/week/2026-07-13", ".week-stats-view", "qa/implementation-week-stats.png"],
  ["/raffle", ".raffle-view", "qa/implementation-raffle.png"],
  ["/ending", ".campaign-ending-view", "qa/implementation-ending.png"],
];

for (const [route, selector, screenshotPath] of mobileRoutes) {
  await page.goto(routeUrl(route), { waitUntil: "domcontentloaded" });
  await page.waitForSelector(selector);
  if (currentRoute(page.url()) !== route) {
    throw new Error(`手机独立路由未保持: ${route}`);
  }
  await page.waitForTimeout(450);
  if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: false });
  if (route === "/month/2026-07") {
    await page.locator("button").filter({ hasText: /^13$/ }).first().click();
    await page.waitForSelector(".week-overview");
    if (currentRoute(page.url()) !== "/week/2026-07-13") {
      throw new Error("月视图点击日期后未先进入所属周");
    }
    await page.getByRole("button", { name: /打开 星期一 07\/13/ }).click();
    await page.waitForSelector(".poetic-header");
    if (currentRoute(page.url()) !== "/day/2026-07-13") {
      throw new Error("周视图点击日期后未进入日视图");
    }
  }
  if (route === "/stats/week/2026-07-13") {
    await page.getByRole("button", { name: "返回日视图", exact: true }).click();
    await page.waitForSelector(".poetic-header");
  }
  if (route === "/raffle") {
    await page.getByText("查看概率与奖项", { exact: true }).click();
    await page.getByText("90.999%", { exact: true }).waitFor();
    const dailyDraw = page.getByRole("button", { name: "抽取今日签", exact: true });
    if (await dailyDraw.isEnabled()) {
      await dailyDraw.click();
      const keepBasePool = page.getByRole("button", { name: "保留八项原概率", exact: true });
      await keepBasePool.waitFor();
      await keepBasePool.click();
      await keepBasePool.waitFor({ state: "hidden" });
      const spinningStage = page.locator(".stage-center--spinning");
      await spinningStage.waitFor();
      await page.waitForTimeout(120);
      await page.screenshot({ path: "qa/implementation-raffle-spinning.png", fullPage: false });
      await spinningStage.waitFor({ state: "hidden", timeout: 12_000 });
    }
  }
  if (route === "/ending") {
    if ((await page.locator(".firework").count()) !== 8) {
      throw new Error("旅程终章烟花彩蛋未渲染");
    }
    await page.getByRole("main").getByRole("button", { name: "再放一次烟花", exact: true }).click();
  }
}

await page.goto(routeUrl("/day/2026-08-29"), { waitUntil: "domcontentloaded" });
await page.waitForSelector(".day-page");
const endingEar = page.getByRole("button", { name: "进入旅程终章" });
if (!(await endingEar.isEnabled())) throw new Error("最后一天的旅程终章入口被禁用");
await endingEar.click();
await page.waitForSelector(".campaign-ending-view");
if (currentRoute(page.url()) !== "/ending") {
  throw new Error("08/29 向后步进未进入旅程终章");
}

await page.goto(routeUrl("/day/2026-07-13"), { waitUntil: "domcontentloaded" });
await page.waitForSelector(".poetic-header");

const widths = [];
for (const width of [360, 390, 430, 700]) {
  await page.setViewportSize({ width, height: 844 });
  await page.waitForTimeout(120);
  widths.push(
    await page.evaluate((viewportWidth) => ({
      viewportWidth,
      viewportHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      appWidth: document.querySelector(".mobile-prototype")?.getBoundingClientRect().width ?? 0,
      appHeight: document.querySelector(".mobile-prototype")?.getBoundingClientRect().height ?? 0,
    }), width),
  );
  if (width === 700) {
    await page.screenshot({ path: "qa/implementation-mobile-fullscreen.png", fullPage: false });
  }
}

const desktopContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
  locale: "zh-CN",
  timezoneId: "Asia/Shanghai",
});
await desktopContext.route("**/v1/auth/session", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: false }),
  }),
);
const desktopPage = await desktopContext.newPage();
desktopPage.on("pageerror", (error) => errors.push(`desktop pageerror: ${error.message}`));
desktopPage.on("response", (response) => {
  if (response.status() >= 400) {
    errors.push(`desktop http ${response.status()}: ${response.url()}`);
  }
});
desktopPage.on("console", (message) => {
  if (message.type() === "error") errors.push(`desktop console: ${message.text()}`);
  if (message.type() === "warning" && message.text().includes("[Vuetify UPGRADE]")) {
    errors.push(`desktop console warning: ${message.text()}`);
  }
});

const desktopRoutes = [
  ["/day/2026-07-13", ".poetic-header"],
  ["/week/2026-07-13", ".week-overview"],
  ["/month/2026-07", ".month-overview"],
  ["/stats/week/2026-07-13", ".week-stats-view"],
  ["/stats/total", ".total-stats-view"],
  ["/favorites", ".favorites-view"],
  ["/raffle", ".raffle-view"],
  ["/ending", ".campaign-ending-view"],
];

for (const [route, selector] of desktopRoutes) {
  await desktopPage.goto(routeUrl(route), { waitUntil: "domcontentloaded" });
  await desktopPage.waitForSelector(selector);
  await desktopPage.reload({ waitUntil: "domcontentloaded" });
  await desktopPage.waitForSelector(selector);
  if (currentRoute(desktopPage.url()) !== route) {
    throw new Error(`路由刷新后未保持: ${route}`);
  }
  const drawerBox = await desktopPage.locator(".v-navigation-drawer").boundingBox();
  if (!drawerBox || drawerBox.x < -1 || drawerBox.width < 280) {
    throw new Error(`桌面侧边栏未常驻: ${route}`);
  }
  if (route === "/day/2026-07-13") {
    await desktopPage.screenshot({ path: "qa/implementation-desktop-day.png", fullPage: false });
  }
  if (route === "/stats/total") {
    await desktopPage.screenshot({ path: "qa/implementation-desktop-total.png", fullPage: false });
  }
  if (route === "/raffle") {
    await desktopPage.screenshot({ path: "qa/implementation-desktop-raffle.png", fullPage: false });
  }
  if (route === "/ending") {
    await desktopPage.screenshot({ path: "qa/implementation-desktop-ending.png", fullPage: false });
  }
}

await desktopPage.goto(routeUrl("/day/2026-07-13"), { waitUntil: "domcontentloaded" });
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
if (currentRoute(desktopPage.url()) !== "/day/2026-07-13") {
  throw new Error("浏览器后退未恢复日视图路由");
}
await desktopPage.goForward();
await desktopPage.waitForSelector(".total-stats-view");
if (currentRoute(desktopPage.url()) !== "/stats/total") {
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
const framedMobile = widths.filter(
  (entry) =>
    Math.abs(entry.appWidth - entry.viewportWidth) > 1 ||
    Math.abs(entry.appHeight - entry.viewportHeight) > 1,
);
if (framedMobile.length) {
  throw new Error(`手机页面未铺满视口: ${JSON.stringify(framedMobile)}`);
}
if (errors.length) throw new Error(`浏览器错误: ${errors.join(" | ")}`);

console.log(JSON.stringify({ status: "passed", widths, desktopLayout, errors }, null, 2));
