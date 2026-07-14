import { chromium } from "playwright";

const baseUrl = process.env.QA_URL || "http://127.0.0.1:4173/";
const routes = [
  ["#/day/2026-07-13", ".poetic-header"],
  ["#/week/2026-07-13", ".week-overview"],
  ["#/month/2026-07", ".month-overview"],
  ["#/stats/week/2026-07-13", ".week-stats-view"],
  ["#/stats/total", ".total-stats-view"],
  ["#/favorites", ".favorites-view"],
  ["#/raffle", ".raffle-view"],
  ["#/ending", ".campaign-ending-view"],
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.route("**/v1/auth/session", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: false }),
  }),
);
const page = await context.newPage();
const warnings = [];

page.on("pageerror", (error) => warnings.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  const text = message.text();
  if (message.type() === "error" || text.includes("[Vuetify UPGRADE]")) {
    warnings.push(`${message.type()}: ${text}`);
  }
});

for (const [hash, selector] of routes) {
  await page.goto(`${baseUrl}${hash}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(selector);
  await page.waitForTimeout(120);
  if (hash === "#/ending") {
    await page.waitForTimeout(580);
    await page.screenshot({ path: "qa/implementation-desktop-ending-fireworks-large.png", fullPage: false });
  }
}

await page.goto(`${baseUrl}#/raffle`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".raffle-view");
await page.getByRole("button", { name: "登记完成一张试卷", exact: true }).click();
await page.getByText("确认完成试卷", { exact: true }).waitFor();
const dialogColors = await page.locator(".confirm-card").first().evaluate((card) => {
  const title = card.querySelector(".v-card-title");
  const body = card.querySelector(".v-card-text");
  return {
    card: getComputedStyle(card).backgroundColor,
    title: title ? getComputedStyle(title).color : "",
    body: body ? getComputedStyle(body).color : "",
  };
});
await page.screenshot({ path: "qa/implementation-paper-dialog-color.png", fullPage: false });

const mobileContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
await mobileContext.addInitScript(() => {
  const nativeGetRandomValues = Crypto.prototype.getRandomValues;
  Crypto.prototype.getRandomValues = function deterministicRaffleRandom(values) {
    if (values instanceof Uint32Array && values.length === 1) {
      values[0] = 636_993;
      return values;
    }
    return nativeGetRandomValues.call(this, values);
  };
});
await mobileContext.route("**/v1/auth/session", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: false }),
  }),
);
const mobilePage = await mobileContext.newPage();
mobilePage.on("pageerror", (error) => warnings.push(`mobile pageerror: ${error.message}`));
mobilePage.on("console", (message) => {
  const text = message.text();
  if (message.type() === "error" || text.includes("[Vuetify UPGRADE]")) {
    warnings.push(`mobile ${message.type()}: ${text}`);
  }
});
const menuPositions = {};
for (const [hash, selector] of routes) {
  await mobilePage.goto(`${baseUrl}${hash}`, { waitUntil: "domcontentloaded" });
  await mobilePage.waitForSelector(selector);
  const menus = mobilePage.getByRole("button", { name: "打开工具栏", exact: true });
  if ((await menus.count()) !== 1) throw new Error(`${hash} 的手机菜单按钮数量不是 1`);
  const box = await menus.boundingBox();
  if (!box || Math.abs(box.x - 12) > 1 || Math.abs(box.y - 20) > 1) {
    throw new Error(`${hash} 的手机菜单位置不统一: ${JSON.stringify(box)}`);
  }
  menuPositions[hash] = { x: box.x, y: box.y };
  if (hash === "#/day/2026-07-13") {
    await mobilePage.screenshot({ path: "qa/implementation-mobile-menu-day.png", fullPage: false });
  }
  if (hash === "#/week/2026-07-13") {
    await mobilePage.screenshot({ path: "qa/implementation-mobile-menu-week.png", fullPage: false });
  }
  if (hash === "#/ending") {
    await mobilePage.waitForTimeout(700);
    await mobilePage.screenshot({ path: "qa/implementation-mobile-ending-fireworks-large.png", fullPage: false });
  }
}
await mobilePage.goto(`${baseUrl}#/day/2026-07-13`, { waitUntil: "domcontentloaded" });
await mobilePage.waitForSelector(".workday-list");
const slot4Field = mobilePage.getByRole("textbox", { name: "第 4 项补充内容" });
const slot7Field = mobilePage.getByRole("textbox", { name: "第 7 项补充内容" });
await slot4Field.fill("必修一");
await slot7Field.fill("第三章");
await mobilePage.getByRole("button", { name: "核对并锁定今日目标", exact: true }).click();
await mobilePage.getByRole("button", { name: "确认锁定目标", exact: true }).click();
await mobilePage.locator(".status-button").first().click();
const regretButton = mobilePage.getByRole("button", { name: "解锁并重新编辑今日目标", exact: true });
await regretButton.scrollIntoViewIfNeeded();
await mobilePage.waitForTimeout(2800);
await mobilePage.screenshot({ path: "qa/implementation-goal-regret-button.png", fullPage: false });
await regretButton.click();
const regretState = {
  disabledStatuses: await mobilePage.locator(".status-button:disabled").count(),
  editable4: await slot4Field.isEditable(),
  editable7: await slot7Field.isEditable(),
  slot4: await slot4Field.inputValue(),
  slot7: await slot7Field.inputValue(),
  completedItems: await mobilePage.locator(".study-item--completed").count(),
};
if (
  regretState.disabledStatuses !== 8 ||
  !regretState.editable4 ||
  !regretState.editable7 ||
  regretState.slot4 !== "必修一" ||
  regretState.slot7 !== "第三章" ||
  regretState.completedItems !== 1
) {
  throw new Error(`解锁状态异常: ${JSON.stringify(regretState)}`);
}
await mobilePage.screenshot({ path: "qa/implementation-goal-regret.png", fullPage: false });
await mobilePage.goto(`${baseUrl}#/raffle`, { waitUntil: "domcontentloaded" });
await mobilePage.waitForSelector(".raffle-view");
await mobilePage.getByRole("button", { name: "抽取今日签", exact: true }).click();
const keepBasePool = mobilePage.getByRole("button", { name: "保留八项原概率", exact: true });
await keepBasePool.waitFor();
await keepBasePool.click();
await keepBasePool.waitFor({ state: "hidden" });
const wheelDialog = mobilePage.locator(".draw-wheel-dialog-card");
await wheelDialog.waitFor();
await mobilePage.waitForTimeout(120);
const wheelState = await mobilePage.locator(".draw-wheel--spinning").evaluate((wheel) => ({
  animationName: getComputedStyle(wheel).animationName,
  labels: wheel.querySelectorAll(".draw-wheel-label").length,
  width: wheel.getBoundingClientRect().width,
}));
if (wheelState.animationName === "none" || wheelState.labels !== 8 || wheelState.width > 360) {
  throw new Error(`抽奖轮盘状态异常: ${JSON.stringify(wheelState)}`);
}
await mobilePage.screenshot({ path: "qa/implementation-raffle-wheel-dialog.png", fullPage: false });
await wheelDialog.waitFor({ state: "hidden", timeout: 12_000 });
const redeemButton = mobilePage.getByRole("button", { name: "兑现奖励：免下一个工作日第 1 项", exact: true });
await redeemButton.waitFor();
await mobilePage.screenshot({ path: "qa/implementation-raffle-redeem-pending.png", fullPage: false });
await redeemButton.click();
await mobilePage.getByText("已兑现", { exact: true }).waitFor();
await mobilePage.screenshot({ path: "qa/implementation-raffle-redeemed.png", fullPage: false });

await mobilePage.goto(`${baseUrl}#/day/2026-07-14`, { waitUntil: "domcontentloaded" });
await mobilePage.waitForSelector(".reward-notice");
const rewardNotice = await mobilePage.locator(".reward-notice").innerText();
const exemptItems = await mobilePage.locator(".study-item--exempt").count();
if (!rewardNotice.includes("免下一个工作日第 1 项") || exemptItems !== 1) {
  throw new Error(`兑现后的目标日状态异常: ${JSON.stringify({ rewardNotice, exemptItems })}`);
}
await mobilePage.screenshot({ path: "qa/implementation-day-reward-congratulations.png", fullPage: false });
await mobileContext.close();

await browser.close();
if (warnings.length) throw new Error(warnings.join("\n"));
console.log(JSON.stringify({ status: "passed", routes: routes.length, warnings: [], dialogColors, menuPositions, regretState, wheelState, rewardNotice, exemptItems }, null, 2));
