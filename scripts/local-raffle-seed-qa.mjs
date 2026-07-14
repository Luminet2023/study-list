import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const runtimeErrors = [];
page.on("pageerror", (error) => runtimeErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") runtimeErrors.push(message.text());
});

await page.goto("http://localhost:8790/login", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".raffle-view");

const serverChoice = page.getByRole("button", { name: "用云端进度覆盖本地", exact: true });
await Promise.race([
  serverChoice.waitFor({ state: "visible", timeout: 10_000 }).catch(() => null),
  page.waitForFunction(
    () => document.querySelectorAll('button[aria-label^="兑现奖励："]').length >= 15,
    null,
    { timeout: 10_000 },
  ).catch(() => null),
]);
if (await serverChoice.isVisible().catch(() => false)) {
  await serverChoice.click();
  await page.getByRole("button", { name: "确认覆盖", exact: true }).click();
}

await page.waitForFunction(
  () => document.querySelectorAll('button[aria-label^="兑现奖励："]').length >= 15,
  null,
  { timeout: 15_000 },
);

const session = await page.evaluate(async () =>
  fetch("/api/v1/auth/session", { credentials: "same-origin" }).then((response) => response.json()),
);
const redeemButtons = await page.locator('button[aria-label^="兑现奖励："]').count();
assert.equal(session.authenticated, true);
assert.equal(session.user.id, "395868");
assert.equal(redeemButtons >= 15, true);
assert.deepEqual(runtimeErrors, []);
await page.screenshot({ path: "qa/implementation-local-all-prizes.png", fullPage: true });
await browser.close();

console.log(JSON.stringify({
  status: "passed",
  user: session.user,
  pendingRedeemButtons: redeemButtons,
  screenshot: "qa/implementation-local-all-prizes.png",
}, null, 2));
