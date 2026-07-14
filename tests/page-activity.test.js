import assert from "node:assert/strict";
import test from "node:test";

import { isPageActive } from "../src/lib/pageActivity.js";

function withDocument(document, callback) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  try {
    callback();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "document", descriptor);
    else delete globalThis.document;
  }
}

test("page activity requires both visibility and focus", () => {
  withDocument({ visibilityState: "hidden", hasFocus: () => true }, () => {
    assert.equal(isPageActive(), false);
  });
  withDocument({ visibilityState: "visible", hasFocus: () => false }, () => {
    assert.equal(isPageActive(), false);
  });
  withDocument({ visibilityState: "visible", hasFocus: () => true }, () => {
    assert.equal(isPageActive(), true);
  });
});
