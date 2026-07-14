import { chromium } from "playwright";

const baseUrl = process.env.QA_URL || "http://127.0.0.1:4173/";
const browser = await chromium.launch({ headless: true });

async function capture(viewport, path, route = "/day/2026-07-13", selector = ".poetic-header") {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: viewport.width < 960,
    hasTouch: viewport.width < 960,
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
  await page.goto(new URL(route, baseUrl).href, { waitUntil: "networkidle" });
  await page.waitForSelector(selector);
  await page.waitForTimeout(500);
  await page.screenshot({ path, fullPage: false });
  await context.close();
}

await capture({ width: 390, height: 844 }, "qa/latest-mobile-day.png");
await capture({ width: 1440, height: 900 }, "qa/latest-desktop-day.png");
await capture({ width: 390, height: 844 }, "qa/latest-mobile-raffle.png", "/raffle", ".raffle-view");
await capture({ width: 1440, height: 900 }, "qa/latest-desktop-raffle.png", "/raffle", ".raffle-view");
await browser.close();

console.log("qa/latest-mobile-day.png\nqa/latest-desktop-day.png\nqa/latest-mobile-raffle.png\nqa/latest-desktop-raffle.png");
