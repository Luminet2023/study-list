<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

import { orderFlipbookPages } from "../lib/dayPageTransition.js";

const props = defineProps({
  enabled: {
    type: Boolean,
    default: false,
  },
  duration: {
    type: Number,
    default: 600,
  },
});

const emit = defineEmits(["update:busy", "animation-error"]);

const host = ref(null);
const book = ref(null);
const overlayVisible = ref(false);
const busy = ref(false);
const phase = ref("idle");

let flipbookEngine = null;
let flipbookEnginePromise = null;
let flipbookEventHandler = null;
let finishActiveTurn = null;
let cancelEnginePreload = null;
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
  // Strata clones every input page during initialization, so the original
  // destination wrapper is free to become the static page below the leaf.
  // Moving it avoids one more deep clone of the complete Day DOM.
  underlay.replaceChildren(destinationPage);
  underlay.setAttribute("data-st-flip-blank", "false");
}

function showHoldingPage(page) {
  const holdingPage = document.createElement("div");
  holdingPage.className = "day-flipbook__holding";
  holdingPage.setAttribute("aria-hidden", "true");
  holdingPage.setAttribute("inert", "");
  holdingPage.append(page);
  book.value.replaceChildren(holdingPage);
  phase.value = "holding";
  overlayVisible.value = true;
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
  phase.value = "idle";
  overlayVisible.value = false;
}

function scheduleEnginePreload() {
  cancelEnginePreload?.();
  if (typeof globalThis.requestIdleCallback === "function") {
    const handle = globalThis.requestIdleCallback(
      () => void loadFlipbookEngine().catch(() => {}),
      { timeout: 1200 },
    );
    cancelEnginePreload = () => globalThis.cancelIdleCallback?.(handle);
    return;
  }
  const handle = globalThis.setTimeout?.(() => void loadFlipbookEngine().catch(() => {}), 0);
  cancelEnginePreload = () => globalThis.clearTimeout?.(handle);
}

watch(
  () => props.enabled,
  (enabled) => {
    if (enabled) scheduleEnginePreload();
    else cancelEnginePreload?.();
  },
  { immediate: true },
);

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

    const currentPage = host.value?.querySelector?.(".day-page");
    if (!currentPage || !book.value || !host.value) {
      await commitNavigation();
      return true;
    }

    const previousPage = wrapSnapshot(createSnapshot(currentPage));
    cancelEnginePreload?.();
    const engineResultPromise = loadFlipbookEngine().then(
      (createFlipbook) => ({ createFlipbook, error: null }),
      (error) => ({ createFlipbook: null, error }),
    );

    // Freeze the source page before changing selectedDate. Vue flushes the
    // hidden live page only after the old snapshot is already visible.
    showHoldingPage(previousPage);
    await nextTick();
    restoreSnapshotScrollPositions();

    await commitNavigation();
    await nextTick();

    const nextPage = host.value?.querySelector?.(".day-page");
    if (destroyed || !props.enabled || !nextPage || !book.value || !host.value) return true;

    const { createFlipbook, error: engineError } = await engineResultPromise;
    if (engineError || !createFlipbook) {
      emit("animation-error", engineError ?? new Error("Strata Flipbook failed to load"));
      return true;
    }
    if (destroyed || !book.value || !host.value) return true;

    const destinationPage = wrapSnapshot(createSnapshot(nextPage));
    const ordered = orderFlipbookPages(direction, previousPage, destinationPage);
    const pages = ordered.pages;
    const engineHost = document.createElement("div");
    engineHost.className = "strata-flipbook-engine";
    engineHost.dataset.flipbookEngine = "strata";
    engineHost.style.setProperty("--st-flip-duration", `${Math.max(120, props.duration)}ms`);
    engineHost.style.setProperty("--st-flip-easing", "cubic-bezier(0.4, 0, 0.2, 1)");
    engineHost.style.setProperty("--st-flip-skew-k", "0deg");

    await new Promise((resolve, reject) => {
      let targetRequested = false;
      let settled = false;
      let fallbackTimer;
      let startFrame;

      const finish = () => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout?.(fallbackTimer);
        globalThis.cancelAnimationFrame?.(startFrame);
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
        if (ordered.startSpread !== 0) flipbookEngine.goTo(ordered.startSpread);

        // The detached engine is fully populated before it replaces the hold
        // layer, making the visual swap atomic instead of exposing a blank scene.
        book.value.replaceChildren(engineHost);
        restoreSnapshotScrollPositions();
        book.value.dataset.engineReady = "true";
        phase.value = "preparing";

        const startAnimation = () => {
          startFrame = undefined;
          if (settled || destroyed || !flipbookEngine) return;
          phase.value = "animating";
          targetRequested = true;
          try {
            if (direction === "previous") flipbookEngine.prev();
            else flipbookEngine.next();
            revealDestinationUnderlay(engineHost, direction, pages[ordered.targetSpread]);
            restoreSnapshotScrollPositions();
          } catch (error) {
            globalThis.clearTimeout?.(fallbackTimer);
            reject(error);
            return;
          }
        };

        fallbackTimer = globalThis.setTimeout?.(finish, Math.max(120, props.duration) + 1200);
        if (typeof globalThis.requestAnimationFrame === "function") {
          startFrame = globalThis.requestAnimationFrame(startAnimation);
        } else {
          startAnimation();
        }
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
  cancelEnginePreload?.();
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
    :data-flipbook-phase="phase"
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

.day-flipbook--turning .day-flipbook__live {
  visibility: hidden;
}

.day-flipbook__overlay {
  overflow: hidden;
  pointer-events: none;
  z-index: 4;
}

.strata-flipbook {
  background: rgb(var(--v-theme-background));
  contain: layout paint;
  isolation: isolate;
}

.strata-flipbook :deep(.day-flipbook__holding) {
  background: rgb(var(--v-theme-background));
  height: 100%;
  inset: 0;
  overflow: hidden;
  position: absolute;
  width: 100%;
}

.strata-flipbook :deep(.strata-flipbook-engine),
.strata-flipbook :deep(.st-flipbook-scene),
.strata-flipbook :deep(.st-flipbook-book) {
  height: 100%;
  max-width: none;
  width: 100%;
}

.strata-flipbook :deep(.st-flipbook[data-st-flip-open="true"] .st-flipbook-scene) {
  animation: none !important;
  opacity: 1;
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

.strata-flipbook :deep(.st-flipbook-flip-front),
.strata-flipbook :deep(.st-flipbook-flip-back) {
  clip-path: none !important;
}

.strata-flipbook :deep(.st-flipbook-flip-page::after) {
  display: none;
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

.strata-flipbook :deep(.day-flipbook-page *) {
  animation: none !important;
  caret-color: transparent !important;
  transition: none !important;
}

.strata-flipbook :deep(.day-page) {
  height: 100%;
  width: 100%;
}
</style>
