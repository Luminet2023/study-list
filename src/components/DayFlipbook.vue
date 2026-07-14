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

let jquery = null;
let turnModulePromise = null;
let finishActiveTurn = null;
let destroyed = false;

function setBusy(value) {
  busy.value = value;
  emit("update:busy", value);
}

function prefersReducedMotion() {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

async function loadTurnJs() {
  if (!turnModulePromise) {
    turnModulePromise = Promise.all([
      import("jquery"),
      import("@jaminearth/turn"),
    ]).then(([jqueryModule, turnModule]) => {
      const instance = jqueryModule.default ?? jqueryModule;
      if (typeof instance.fn?.turn !== "function") turnModule.turnjsInit(instance);
      return instance;
    });
  }
  jquery = await turnModulePromise;
  return jquery;
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
  page.className = "turn-flipbook-page paper-surface";
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

function cleanupBook() {
  finishActiveTurn = null;
  if (jquery && book.value) {
    try {
      const data = jquery(book.value).data();
      if (data?.pages && !data.destroying) jquery(book.value).turn("destroy");
    } catch {
      // turn.js may already have torn down its generated wrappers.
    }
  }
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

    let $;
    try {
      $ = await loadTurnJs();
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
    book.value.replaceChildren(...ordered.pages.map(wrapSnapshot));

    const rect = host.value.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
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
        $(book.value).turn({
          width,
          height,
          display: "single",
          page: ordered.startPage,
          duration: Math.max(120, props.duration),
          gradients: true,
          acceleration: true,
          autoCenter: false,
          when: {
            turned(_event, pageNumber) {
              if (targetRequested && pageNumber === ordered.targetPage) {
                if (globalThis.queueMicrotask) globalThis.queueMicrotask(finish);
                else globalThis.setTimeout?.(finish, 0);
              }
            },
          },
        });
        restoreSnapshotScrollPositions();
        targetRequested = true;
        globalThis.requestAnimationFrame?.(() => {
          try {
            $(book.value).turn("page", ordered.targetPage);
          } catch (error) {
            reject(error);
          }
        }) ?? $(book.value).turn("page", ordered.targetPage);
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
      <div ref="book" class="turn-flipbook" />
    </div>
  </div>
</template>

<style scoped>
.day-flipbook,
.day-flipbook__live,
.day-flipbook__overlay,
.turn-flipbook {
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

.turn-flipbook {
  filter: drop-shadow(0 18px 22px rgba(30, 18, 23, 0.2));
  transform-style: preserve-3d;
}

.turn-flipbook :deep(.turn-flipbook-page) {
  background-color: rgb(var(--v-theme-background));
  height: 100%;
  overflow: hidden;
  width: 100%;
}

.turn-flipbook :deep(.day-page) {
  height: 100%;
  width: 100%;
}

.turn-flipbook :deep(.shadow) {
  box-shadow: inset 0 0 26px rgba(43, 26, 31, 0.18);
}
</style>
