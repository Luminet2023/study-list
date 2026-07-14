import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const errors = [];

async function inspect(viewport, route, selector, screenshotPath) {
  const context = await browser.newContext({ viewport, locale: "zh-CN" });
  await context.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ authenticated: false }),
    }),
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  await page.goto(new URL(route, "http://127.0.0.1:4174/").href, { waitUntil: "networkidle" });
  await page.locator(selector).waitFor();
  await page.waitForTimeout(300);
  const state = await page.evaluate(() => {
    const app = document.querySelector(".v-application");
    const paper = document.querySelector(".paper-surface");
    const drawer = document.querySelector(".tool-drawer");
    const raffle = document.querySelector(".raffle-view");
    return {
      themeClass: [...(app?.classList ?? [])].find((name) => name.startsWith("v-theme--")),
      appBackground: app ? getComputedStyle(app).backgroundColor : null,
      paperImage: paper ? getComputedStyle(paper).backgroundImage : null,
      drawerBackground: drawer ? getComputedStyle(drawer).backgroundColor : null,
      raffleImage: raffle ? getComputedStyle(raffle).backgroundImage : null,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await context.close();
  return state;
}

const desktopTotal = await inspect(
  { width: 1440, height: 900 },
  "/stats/total",
  ".total-stats-view",
  "/tmp/dark-desktop-total.png",
);
const mobileDay = await inspect(
  { width: 390, height: 844 },
  "/day/2026-07-13",
  ".poetic-header",
  "/tmp/dark-mobile-day.png",
);
const desktopRaffle = await inspect(
  { width: 1440, height: 900 },
  "/raffle",
  ".raffle-view",
  "/tmp/dark-desktop-raffle.png",
);

for (const [name, state] of Object.entries({ desktopTotal, mobileDay, desktopRaffle })) {
  if (state.themeClass !== "v-theme--poeticNight") {
    throw new Error(`${name}: unexpected theme ${state.themeClass}`);
  }
  if (state.horizontalOverflow) throw new Error(`${name}: horizontal overflow`);
}
if (!desktopTotal.paperImage?.includes("study-wash-bg-dark.png")) {
  throw new Error("desktopTotal: dark paper asset was not selected");
}
if (!mobileDay.paperImage?.includes("study-wash-bg-dark.png")) {
  throw new Error("mobileDay: dark paper asset was not selected");
}
if (!desktopRaffle.raffleImage?.includes("raffle-wash-bg-dark.png")) {
  throw new Error("desktopRaffle: dark raffle asset was not selected");
}
if (errors.length) throw new Error(errors.join("\n"));

console.log(JSON.stringify({ desktopTotal, mobileDay, desktopRaffle, errors }, null, 2));
await browser.close();
