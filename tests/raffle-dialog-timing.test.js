import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const APP_URL = new URL("../src/App.vue", import.meta.url);

test("raffle result keeps the dialog open before closing and enqueueing the toast", async () => {
  const source = await readFile(APP_URL, "utf8");
  const executeDraw = source.slice(
    source.indexOf("async function executeDraw"),
    source.indexOf("async function redeemDraw"),
  );

  assert.match(source, /const DRAW_RESULT_DIALOG_HOLD_MS = 5000;/u);

  const resultIndex = executeDraw.indexOf("const result = await store.performDraw");
  const holdIndex = executeDraw.indexOf("setTimeout(resolve, DRAW_RESULT_DIALOG_HOLD_MS)");
  const closeIndex = executeDraw.indexOf("spinning.value = false");
  const renderIndex = executeDraw.indexOf("await nextTick()");
  const toastIndex = executeDraw.lastIndexOf("enqueue(");

  assert.ok(resultIndex >= 0, "应先取得抽奖结果");
  assert.ok(holdIndex > resultIndex, "取得结果后应保留 Dialog 5 秒");
  assert.ok(closeIndex > holdIndex, "等待结束后才应关闭 Dialog");
  assert.ok(renderIndex > closeIndex, "关闭 Dialog 后应等待界面更新");
  assert.ok(toastIndex > renderIndex, "结果 Toast 应在 Dialog 关闭后入队");
});
