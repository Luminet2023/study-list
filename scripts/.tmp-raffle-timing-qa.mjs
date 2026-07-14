import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: "zh-CN",
  timezoneId: "Asia/Taipei",
});
await context.route("**/v1/auth/session", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authenticated: false }),
  }),
);

try {
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4174/#/raffle", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".raffle-view");
  await page.getByRole("button", { name: "抽取今日签", exact: true }).click();

  const keepBasePool = page.getByRole("button", { name: "保留八项原概率", exact: true });
  if (await keepBasePool.isVisible()) await keepBasePool.click();

  const dialog = page.locator(".draw-wheel-dialog-card");
  await dialog.waitFor();
  await page.locator(".result-card").waitFor({ timeout: 4_000 });
  const resultAt = Date.now();

  if (!(await dialog.isVisible())) throw new Error("结果产生时转盘 Dialog 已提前关闭");
  if ((await page.locator(".v-snackbar--active").count()) !== 0) {
    throw new Error("结果产生时 Toast 已提前显示");
  }

  await page.waitForTimeout(4_500);
  if (!(await dialog.isVisible())) throw new Error("结果产生后未保持 Dialog 接近 5 秒");
  if ((await page.locator(".v-snackbar--active").count()) !== 0) {
    throw new Error("Dialog 关闭前 Toast 已提前显示");
  }

  await dialog.waitFor({ state: "hidden", timeout: 1_500 });
  const closedAt = Date.now();
  const toast = page.locator(".v-snackbar--active");
  await toast.waitFor({ timeout: 1_000 });

  const holdMs = closedAt - resultAt;
  if (holdMs < 4_900) throw new Error(`Dialog 仅停留 ${holdMs}ms`);

  console.log(JSON.stringify({
    status: "passed",
    resultToDialogCloseMs: holdMs,
    toast: (await toast.innerText()).trim(),
  }));
} finally {
  await browser.close();
}
