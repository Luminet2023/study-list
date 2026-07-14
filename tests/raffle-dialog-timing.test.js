import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const APP_URL = new URL("../src/App.vue", import.meta.url);
const RAFFLE_VIEW_URL = new URL("../src/components/RaffleView.vue", import.meta.url);

test("raffle result keeps the dialog open before closing and enqueueing the toast", async () => {
  const source = await readFile(APP_URL, "utf8");
  const raffleView = await readFile(RAFFLE_VIEW_URL, "utf8");
  const executeDraw = source.slice(
    source.indexOf("async function executeDraw"),
    source.indexOf("function handleDrawDialogClosed"),
  );
  const dialogClosedHandler = source.slice(
    source.indexOf("function handleDrawDialogClosed"),
    source.indexOf("async function redeemDraw"),
  );

  assert.match(source, /const DRAW_RESULT_DIALOG_HOLD_MS = 5000;/u);

  const resultIndex = executeDraw.indexOf("const result = await store.performDraw");
  const holdIndex = executeDraw.indexOf("setTimeout(resolve, DRAW_RESULT_DIALOG_HOLD_MS)");
  const closeIndex = executeDraw.indexOf("spinning.value = false");

  assert.ok(resultIndex >= 0, "应先取得抽奖结果");
  assert.ok(holdIndex > resultIndex, "取得结果后应保留 Dialog 5 秒");
  assert.ok(closeIndex > holdIndex, "等待结束后才应关闭 Dialog");
  assert.doesNotMatch(executeDraw, /enqueue\(/u, "Dialog 退场前不应入队结果 Toast");
  assert.match(raffleView, /@after-leave="emit\('draw-dialog-closed'\)"/u);
  assert.match(source, /@draw-dialog-closed="handleDrawDialogClosed"/u);
  assert.match(dialogClosedHandler, /if \(resultNotice\) enqueue\(/u);
});
