import assert from "node:assert/strict";
import test from "node:test";

import { createUndoHistory } from "../src/lib/undoHistory.js";

test("undo history moves backward and forward", () => {
  const history = createUndoHistory("初始");
  history.record("第一次修改");
  history.record("第二次修改");

  assert.equal(history.undo(), "第一次修改");
  assert.equal(history.undo(), "初始");
  assert.equal(history.redo(), "第一次修改");
  assert.equal(history.redo(), "第二次修改");
});

test("recording after undo discards the old redo branch", () => {
  const history = createUndoHistory("A");
  history.record("B");
  history.record("C");
  assert.equal(history.undo(), "B");

  history.record("D");
  assert.equal(history.redo(), "D");
  assert.equal(history.undo(), "B");
});
