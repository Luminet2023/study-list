import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Vite development proxy targets the prefixed local Go API", async () => {
  const source = await readFile(new URL("../vite.config.mjs", import.meta.url), "utf8");

  assert.match(source, /"\/v1": \{/u);
  assert.match(source, /http:\/\/127\.0\.0\.1:8080\/hifumi/u);
  assert.doesNotMatch(source, /127\.0\.0\.1:8787/u);
  assert.match(source, /ws: true/u);
});
