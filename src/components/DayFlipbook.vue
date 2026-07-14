<script setup>
import { nextTick, onBeforeUnmount, ref } from "vue";

import { orderFlipbookPages } from "../lib/dayPageTransition.js";

const props = defineProps({
  enabled: {
    type: Boolean,
    default: false,
  },
  duration: {
    type: Number,
    default: 760,
  },
});

const emit = defineEmits(["update:busy", "animation-error"]);

const host = ref(null);
const book = ref(null);
const overlayVisible = ref(false);
const busy = ref(false);

let flipbookEngine = null;
let flipbookEnginePromise = null;
let flipbookEventHandler = null;
let finishActiveTurn = null;
let destroyed = false;

function setBusy(value) {
  busy.value = value;
  emit("update:busy", value);
}

function prefersReducedMotion() {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

async function loadFlipbookEngine() {
  if (!flipbookEnginePromise) {
    flipbookEnginePromise = Promise.all([
      import("@strata-packages/flipbook"),
      import("@strata-packages/flipbook/css"),
    ]).then(([flipbookModule]) => flipbookModule.default ?? flipbookModule);
  }
  return flipbookEnginePromise;
}

function copyLiveControlState(source, clone) {
  const sourceControls = source.querySelectorAll("input, textarea, select, details");
  const clonedControls = clone.querySelectorAll("input, textarea, select, details");
  sourceControls.forEach((control, index) => {
    const clonedControl = clonedControls[index];
    if (!clonedControl) return;
    if (control instanceof HTMLInputElement) {
      clonedControl.value = control.value;
      clonedControl.checked = control.checked;
    } else if (control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) {
      clonedControl.value = control.value;
    } else if (control instanceof HTMLDetailsElement) {
      clonedControl.open = control.open;
    }
  });
}

function createSnapshot(source) {
  const clone = source.cloneNode(true);
  copyLiveControlState(source, clone);
  clone.querySelectorAll("[id], [for], [aria-controls], [aria-describedby], [aria-labelledby]")
    .forEach((element) => {
      element.removeAttribute("id");
      element.removeAttribute("for");
      element.removeAttribute("aria-controls");
      element.removeAttribute("aria-describedby");
      element.removeAttribute("aria-labelledby");
    });
  clone.removeAttribute("id");
  clone.setAttribute("aria-hidden", "true");
  clone.setAttribute("inert", "");
  clone.style.pointerEvents = "none";
  clone.dataset.snapshotScrollTop = String(source.scrollTop ?? 0);
  return clone;
}

function wrapSnapshot(snapshot) {
  const page = document.createElement("div");
  page.className = "day-flipbook-page paper-surface";
  page.setAttribute("aria-hidden", "true");
  page.setAttribute("inert", "");
  page.append(snapshot);
  return page;
}

function restoreSnapshotScrollPositions() {
  for (const snapshot of book.value?.querySelectorAll?.("[data-snapshot-scroll-top]") ?? []) {
    snapshot.scrollTop = Number(snapshot.dataset.snapshotScrollTop ?? 0);
  }
}

function revealDestinationUnderlay(engineHost, direction, destinationPage) {
  const selector = direction === "previous"
    ? ".st-flipbook-page-right"
    : ".st-flipbook-page-left";
  const underlay = engineHost.querySelector(selector);
  if (!underlay) return;
  underlay.replaceChildren(destinationPage.cloneNode(true));
  underlay.setAttribute("data-st-flip-blank", "false");
}

function cleanupBook() {
  finishActiveTurn = null;
  if (flipbookEngine && flipbookEventHandler) {
    flipbookEngine.off("flip", flipbookEventHandler);
  }
  flipbookEventHandler = null;
  if (flipbookEngine) {
    try {
      flipbookEngine.destroy();
    } catch {
      // The transient engine may already have completed its own teardown.
    }
  }
  flipbookEngine = null;
  book.value?.removeAttribute("data-engine-ready");
  book.value?.replaceChildren();
  overlayVisible.value = false;
}

function afterPaint() {
  return new Promise((resolve) => {
    const requestFrame = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0));
    requestFrame(() => requestFrame(resolve));
  });
}

async function turn(direction, commitNavigation) {
  if (typeof commitNavigation !== "function") {
    throw new TypeError("commitNavigation must be a function");
  }
  if (busy.value) return false;

  setBusy(true);
  try {
    if (!props.enabled || prefersReducedMotion()) {
      await commitNavigation();
      return true;
    }

    let createFlipbook;
    try {
      createFlipbook = await loadFlipbookEngine();
    } catch (error) {
      await commitNavigation();
      emit("animation-error", error);
      return true;
    }
    if (destroyed || !props.enabled) {
      await commitNavigation();
      return true;
    }

    const currentPage = host.value?.querySelector?.(".day-page");
    if (!currentPage) {
      await commitNavigation();
      return true;
    }
    const previousSnapshot = createSnapshot(currentPage);

    await commitNavigation();
    await nextTick();
    await afterPaint();

    const nextPage = host.value?.querySelector?.(".day-page");
    if (destroyed || !nextPage || !book.value || !host.value) return true;
    const nextSnapshot = createSnapshot(nextPage);
    const ordered = orderFlipbookPages(direction, previousSnapshot, nextSnapshot);
    const pages = ordered.pages.map(wrapSnapshot);
    const engineHost = document.createElement("div");
    engineHost.className = "strata-flipbook-engine";
    engineHost.dataset.flipbookEngine = "strata";
    engineHost.style.setProperty("--st-flip-duration", `${Math.max(120, props.duration)}ms`);
    book.value.replaceChildren(engineHost);

    overlayVisible.value = true;
    await nextTick();

    await new Promise((resolve, reject) => {
      let targetRequested = false;
      let settled = false;
      let fallbackTimer;

      const finish = () => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout?.(fallbackTimer);
        cleanupBook();
        resolve();
      };
      finishActiveTurn = finish;

      try {
        flipbookEngine = createFlipbook(engineHost, {
          source: "html",
          content: pages,
          preset: "minimal",
          pagination: "none",
          drag: false,
          loop: false,
          closed: true,
          sound: { enabled: false },
        });
        if (!flipbookEngine) throw new Error("Strata Flipbook initialization failed");
        flipbookEventHandler = (event) => {
          if (
            targetRequested
            && event.detail?.flipbook === flipbookEngine
            && event.detail?.spread === ordered.targetSpread
          ) {
            if (globalThis.queueMicrotask) globalThis.queueMicrotask(finish);
            else globalThis.setTimeout?.(finish, 0);
          }
        };
        flipbookEngine.on("flip", flipbookEventHandler);
        flipbookEngine.goTo(ordered.startSpread);
        restoreSnapshotScrollPositions();
        book.value.dataset.engineReady = "true";
        targetRequested = true;
        globalThis.requestAnimationFrame?.(() => {
          try {
            if (direction === "previous") flipbookEngine.prev();
            else flipbookEngine.next();
            revealDestinationUnderlay(
              engineHost,
              direction,
              pages[ordered.targetSpread],
            );
            restoreSnapshotScrollPositions();
          } catch (error) {
            reject(error);
          }
        }) ?? (() => {
          if (direction === "previous") flipbookEngine.prev();
          else flipbookEngine.next();
          revealDestinationUnderlay(engineHost, direction, pages[ordered.targetSpread]);
          restoreSnapshotScrollPositions();
        })();
        fallbackTimer = globalThis.setTimeout?.(finish, Math.max(120, props.duration) + 900);
      } catch (error) {
        reject(error);
      }
    }).catch((error) => {
      cleanupBook();
      emit("animation-error", error);
    });
    return true;
  } finally {
    cleanupBook();
    setBusy(false);
  }
}

onBeforeUnmount(() => {
  destroyed = true;
  finishActiveTurn?.();
  cleanupBook();
  setBusy(false);
});

defineExpose({ turn });
</script>

<template>
  <div
    ref="host"
    class="day-flipbook"
    :class="{ 'day-flipbook--turning': overlayVisible }"
    :data-page-transition="enabled ? 'flipbook' : 'classic'"
    :aria-busy="busy"
  >
    <div class="day-flipbook__live" :inert="overlayVisible || undefined">
      <slot />
    </div>
    <div
      v-show="overlayVisible"
      class="day-flipbook__overlay"
      aria-hidden="true"
    >
      <div ref="book" class="strata-flipbook" data-flipbook-engine="strata" />
    </div>
  </div>
</template>

<style scoped>
.day-flipbook,
.day-flipbook__live,
.day-flipbook__overlay,
.strata-flipbook {
  height: 100%;
  inset: 0;
  position: absolute;
  width: 100%;
}

.day-flipbook {
  perspective: 2200px;
}

.day-flipbook--turning .day-flipbook__live {
  visibility: hidden;
}

.day-flipbook__overlay {
  overflow: hidden;
  pointer-events: none;
  transform-style: preserve-3d;
  z-index: 4;
}

.strata-flipbook {
  background: rgb(var(--v-theme-background));
}

.strata-flipbook :deep(.strata-flipbook-engine),
.strata-flipbook :deep(.st-flipbook-scene),
.strata-flipbook :deep(.st-flipbook-book) {
  height: 100%;
  max-width: none;
  width: 100%;
}

.strata-flipbook :deep(.st-flipbook-book) {
  box-shadow: none;
  padding-bottom: 0 !important;
  transform: none !important;
}

.strata-flipbook :deep(.st-flipbook-page-left) {
  display: none;
}

.strata-flipbook :deep(.st-flipbook-page-right) {
  border-left: 0;
  left: 0;
  width: 100%;
}

.strata-flipbook :deep(.strata-flipbook-engine[data-st-flip-solo="left"] .st-flipbook-page-left) {
  border-right: 0;
  display: block;
  left: 0;
  width: 100%;
}

.strata-flipbook :deep(.strata-flipbook-engine[data-st-flip-solo="left"] .st-flipbook-page-right) {
  display: none;
}

.strata-flipbook :deep(.st-flipbook-flip-page) {
  left: 0;
  width: 100%;
}

.strata-flipbook :deep([data-st-flip-direction="forward"] .st-flipbook-flip-page) {
  transform-origin: left center;
}

.strata-flipbook :deep([data-st-flip-direction="backward"] .st-flipbook-flip-page) {
  transform-origin: right center;
}

.strata-flipbook :deep(.day-flipbook-page) {
  background-color: rgb(var(--v-theme-background));
  height: 100%;
  overflow: hidden;
  width: 100%;
}

.strata-flipbook :deep(.day-page) {
  height: 100%;
  width: 100%;
}
</style>
