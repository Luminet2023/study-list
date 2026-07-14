import { chromium } from "playwright";

const baseUrl = process.env.QA_URL || "http://127.0.0.1:4173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: "zh-CN",
  timezoneId: "Asia/Shanghai",
});
await context.route("**/v1/auth/session", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: false }) }),
);

let hitokotoCalls = 0;
const requestedCategories = [];
await context.route("https://v1.hitokoto.cn/**", async (route) => {
  hitokotoCalls += 1;
  requestedCategories.push(new URL(route.request().url()).searchParams.getAll("c"));
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      uuid: `qa-hitokoto-${hitokotoCalls}`,
      hitokoto: "山川异域，风月同天。",
      type: "i",
      from: "绣袈裟衣缘",
      from_who: null,
    }),
  });
});

const page = await context.newPage();
const errors = [];
const waitForTypedQuote = (text) => page.waitForFunction(
  (expected) => document.querySelector(".blessing-text")?.textContent === expected,
  text,
  { timeout: 5_000 },
);
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

await page.goto(new URL("/settings", baseUrl).href, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".settings-view");
await page.getByText("一言", { exact: true }).click();
await page.getByRole("checkbox", { name: /文学 · d/ }).check();
await page.getByRole("checkbox", { name: /诗词 · i/ }).check();
await page.screenshot({ path: "qa/implementation-hitokoto-settings.png", fullPage: true });
await page.getByRole("button", { name: "返回" }).click();

await page.waitForSelector(".blessing-skeleton");
await page.screenshot({ path: "qa/implementation-hitokoto-loading.png", fullPage: true });
await waitForTypedQuote("山川异域，风月同天。");
await page.waitForTimeout(1_200);
await page.screenshot({ path: "qa/implementation-hitokoto-day.png", fullPage: true });
if (hitokotoCalls !== 1) throw new Error(`同一日期首次绑定请求了 ${hitokotoCalls} 次`);
if (JSON.stringify(requestedCategories[0]) !== JSON.stringify(["d", "i"])) {
  throw new Error(`分类参数错误: ${JSON.stringify(requestedCategories[0])}`);
}

// 模拟登录云同步用旧快照短暂替换本地状态：页面应继续使用已确认的会话绑定，
// 不能因为持久状态瞬间缺失就再请求一言。
await page.evaluate(async () => {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("zako-study-list", 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const readState = () => new Promise((resolve, reject) => {
    const transaction = database.transaction("campaign", "readonly");
    const request = transaction.objectStore("campaign").get("state");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const writeState = (state) => new Promise((resolve, reject) => {
    const transaction = database.transaction("campaign", "readwrite");
    transaction.objectStore("campaign").put(state, "state");
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  const state = await readState();
  globalThis.__qaHitokotoBinding = structuredClone(
    state.days["2026-07-13"].blessing.hitokoto,
  );
  state.days["2026-07-13"].blessing.hitokoto = null;
  state.revision += 1;
  state.lastUpdatedAt = new Date().toISOString();
  await writeState(state);
  const channel = new BroadcastChannel("zako-study-list:state-changes");
  channel.postMessage({
    type: "campaign-state-revision",
    revision: state.revision,
    lastUpdatedAt: state.lastUpdatedAt,
  });
  channel.close();
  database.close();
});
await page.waitForTimeout(900);
await waitForTypedQuote("山川异域，风月同天。");
if (hitokotoCalls !== 1) {
  throw new Error(`同步旧快照触发了额外一言请求：共 ${hitokotoCalls} 次`);
}

await page.evaluate(async () => {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("zako-study-list", 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transaction = database.transaction("campaign", "readwrite");
  const store = transaction.objectStore("campaign");
  const state = await new Promise((resolve, reject) => {
    const request = store.get("state");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  state.days["2026-07-13"].blessing.hitokoto = globalThis.__qaHitokotoBinding;
  state.revision += 1;
  state.lastUpdatedAt = new Date().toISOString();
  store.put(state, "state");
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  const channel = new BroadcastChannel("zako-study-list:state-changes");
  channel.postMessage({
    type: "campaign-state-revision",
    revision: state.revision,
    lastUpdatedAt: state.lastUpdatedAt,
  });
  channel.close();
  database.close();
});
await page.waitForTimeout(500);

await page.reload({ waitUntil: "domcontentloaded" });
await waitForTypedQuote("山川异域，风月同天。");
await page.waitForTimeout(800);
if (hitokotoCalls !== 1) throw new Error(`已绑定日期刷新后又请求了 ${hitokotoCalls - 1} 次`);
if (errors.length) throw new Error(errors.join("\n"));

console.log(JSON.stringify({ status: "passed", hitokotoCalls, requestedCategories }, null, 2));
await browser.close();
