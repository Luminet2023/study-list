import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Wrangler retires the legacy Durable Object class explicitly", async () => {
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  const retirement = config.migrations?.find((migration) => (
    migration.tag === "v2-retire-user-sync"
  ));

  assert.deepEqual(retirement?.deleted_classes, ["UserSyncCoordinator"]);
  assert.equal(config.durable_objects, undefined);
  assert.equal(config.kv_namespaces, undefined);
});
