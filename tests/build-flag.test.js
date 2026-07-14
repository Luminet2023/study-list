import assert from "node:assert/strict";
import test from "node:test";

import { installBuildFlag } from "../src/buildFlag.js";

test("build flag exposes an immutable commit hash", () => {
  const target = {};
  const commitHash = "0123456789abcdef0123456789abcdef01234567";

  const flag = installBuildFlag(target, commitHash);

  assert.deepEqual(flag, { ver: commitHash });
  assert.equal(target.flag, flag);
  assert.equal(Object.isFrozen(flag), true);
  assert.deepEqual(Object.getOwnPropertyDescriptor(target, "flag"), {
    configurable: false,
    enumerable: true,
    writable: false,
    value: flag,
  });
});
