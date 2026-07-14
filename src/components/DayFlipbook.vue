<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import {
  createDayFlipbookHydrationPositions,
  createDayFlipbookPages,
  findDayFlipbookPosition,
} from "../lib/dayPageTransition.js";

const props = defineProps({
  active: {
    type: Boolean,
    default: true,
  },
  dates: {
    type: Array,
    default: () => [],
  },
  selectedDate: {
    type: String,
    required: true,
  },
  duration: {
    type: Number,
    default: 850,
  },
});

const emit = defineEmits([
  "update:busy",
  "animation-error",
  "navigate",
]);

const host = ref(null);
const book = ref(null);
const busy = ref(false);
const phase = ref("idle");
const engineReady = ref(false);
const engineUnavailable = ref(false);
const engineInstanceId = ref(0);
const pageEntries = computed(() => createDayFlipbookPages(props.dates));
const hydrationAnchorDate = ref(props.selectedDate);
const hydrationRadius = ref(0);
const hydratedPositions = computed(() => new Set(
  createDayFlipbookHydrationPositions(props.dates, hydrationAnchorDate.value, {
    active: props.active && !engineUnavailable.value,
    radius: hydrationRadius.value,
  }),
));

let pageFlip = null;
let pageFlipModulePromise = null;
let ensureEnginePromise = null;
let pendingTurn = null;
let fallbackTimer;
let pendingSettleFrame;
let resizeObserver;
let resizeTimer;
let hydrationIdleHandle;
let hydrationIdleFallback = false;
let lastWidth = 0;
let lastHeight = 0;
let layoutDirty = false;
let destroyed = false;
let internalCommitDate = null;
let transitionEpoch = 0;
let requestEngineFrames = () => {};
let setEngineRenderingActive = () => {};

let swipeActive = false;
let swipeStartX = 0;
let swipeStartY = 0;
let swipeStartedOnControl = false;
let suppressClickUntil = 0;

function positionForDate(date) {
  return findDayFlipbookPosition(props.dates, date);
}

function cancelHydrationRecenter() {
  if (hydrationIdleHandle === undefined) return;
  if (hydrationIdleFallback) globalThis.clearTimeout?.(hydrationIdleHandle);
  else globalThis.cancelIdleCallback?.(hydrationIdleHandle);
  hydrationIdleHandle = undefined;
  hydrationIdleFallback = false;
}

function scheduleHydrationRecenter(date) {
  cancelHydrationRecenter();
  if (
    !props.active
    || destroyed
    || (hydrationAnchorDate.value === date && hydrationRadius.value === 1)
  ) return;

  const recenter = () => {
    hydrationIdleHandle = undefined;
    hydrationIdleFallback = false;
    if (!props.active || destroyed) return;
    if (busy.value) {
      scheduleHydrationRecenter(date);
      return;
    }
    hydrationAnchorDate.value = date;
    hydrationRadius.value = 1;
  };

  if (typeof globalThis.requestIdleCallback === "function") {
    hydrationIdleHandle = globalThis.requestIdleCallback(recenter, { timeout: 500 });
    return;
  }
  hydrationIdleFallback = true;
  hydrationIdleHandle = globalThis.setTimeout?.(recenter, 32);
}

function setBusy(value) {
  if (value) swipeActive = false;
  busy.value = value;
  emit("update:busy", value);
  if (!value) flushDeferredLayout();
}

function prefersReducedMotion() {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

function sourcePageAt(position) {
  return book.value?.querySelector?.(
    `[data-day-flipbook-source][data-page-position="${position}"]`,
  ) ?? null;
}

function scrollPageToTop(position = positionForDate(props.selectedDate)) {
  const page = sourcePageAt(position)?.querySelector?.(".day-page")
    ?? host.value?.querySelector?.(".day-flipbook__fallback .day-page");
  page?.scrollTo?.({ top: 0, behavior: "instant" });
  if (page && typeof page.scrollTo !== "function") page.scrollTop = 0;
}

function copyLiveDomState(source, clone) {
  if (!source || !clone) return;

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

  const sourceScroll = source.querySelector(".day-page");
  const clonedScroll = clone.querySelector(".day-page");
  if (sourceScroll && clonedScroll) {
    clonedScroll.scrollTop = sourceScroll.scrollTop;
    clonedScroll.scrollLeft = sourceScroll.scrollLeft;
  }
}

const clonedReferenceAttributes = [
  "id",
  "for",
  "aria-controls",
  "aria-describedby",
  "aria-labelledby",
  "aria-current",
];

function neutralizeTemporaryCopy(root) {
  if (!root) return;
  const selector = clonedReferenceAttributes.map((attribute) => `[${attribute}]`).join(",");
  const nodes = [root, ...root.querySelectorAll(selector)];
  nodes.forEach((element) => {
    clonedReferenceAttributes.forEach((attribute) => element.removeAttribute(attribute));
  });
  root.dataset.temporaryCopy = "true";
  root.removeAttribute("data-day-flipbook-source");
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("inert", "");
  root.style.pointerEvents = "none";
}

function hydrateTemporaryCopy(position) {
  const enginePage = pageFlip?.getPage?.(position);
  const source = enginePage?.getElement?.() ?? sourcePageAt(position);
  if (!source || !book.value) return;
  const hydrate = () => {
    const temporaryCopy = enginePage?.getTemporaryCopy?.()?.getElement?.();
    if (!temporaryCopy) return false;
    copyLiveDomState(source, temporaryCopy);
    neutralizeTemporaryCopy(temporaryCopy);
    return true;
  };
  if (!hydrate()) globalThis.requestAnimationFrame?.(hydrate);
}

async function loadPageFlip() {
  if (!pageFlipModulePromise) {
    pageFlipModulePromise = import("page-flip").then((module) => module.PageFlip);
  }
  return pageFlipModulePromise;
}

function installRenderGuards(engine) {
  const render = engine?.getRender?.();
  const originalClear = render?.clear;
  const originalDrawFrame = render?.drawFrame;
  if (!render || typeof originalDrawFrame !== "function") return;

  let renderingActive = props.active;
  let remainingFrames = 3;
  let wasAnimating = false;

  if (typeof originalClear === "function") {
    render.clear = function optimizedClear() {
      const pages = engine.getPageCollection?.().getPages?.();
      if (!Array.isArray(pages)) return originalClear.apply(this);
      for (const page of pages) {
        const visible = page === this.leftPage
          || page === this.rightPage
          || page === this.flippingPage
          || page === this.bottomPage;
        if (!visible) {
          const element = page.getElement?.();
          if (element && element.style.display !== "none") {
            element.style.cssText = "display: none";
          }
        }
        if (page.getTemporaryCopy?.() !== this.flippingPage) {
          page.hideTemporaryCopy?.();
        }
      }
    };
  }

  render.drawFrame = function guardedDrawFrame(...args) {
    if (!renderingActive) return undefined;
    const isAnimating = engine.getState?.() !== "read";
    if (isAnimating) {
      wasAnimating = true;
      return originalDrawFrame.apply(this, args);
    }
    if (wasAnimating) {
      wasAnimating = false;
      remainingFrames = Math.max(remainingFrames, 2);
    }
    if (remainingFrames <= 0) return undefined;
    remainingFrames -= 1;
    return originalDrawFrame.apply(this, args);
  };

  requestEngineFrames = (count = 2) => {
    remainingFrames = Math.max(remainingFrames, count);
  };
  setEngineRenderingActive = (active) => {
    renderingActive = active;
    if (active) requestEngineFrames(3);
    else remainingFrames = 0;
  };
}

function clearPendingSettleFrame() {
  globalThis.cancelAnimationFrame?.(pendingSettleFrame);
  pendingSettleFrame = undefined;
}

function schedulePendingTurnSettle(error = null) {
  const turn = pendingTurn;
  if (!turn || turn.finishing) return;
  if (error) turn.recoveryError = error;
  if (pendingSettleFrame !== undefined) return;

  pendingSettleFrame = globalThis.requestAnimationFrame?.(() => {
    pendingSettleFrame = undefined;
    if (pendingTurn !== turn || turn.finishing) return;
    if (turn.recoveryError) {
      void recoverPendingTurn(turn.recoveryError);
      return;
    }
    if (!turn.targetReached || !turn.engineRead) return;
    if (
      pageFlip?.getState?.() !== "read"
      || pageFlip?.getCurrentPageIndex?.() !== turn.targetPosition
    ) {
      void recoverPendingTurn(new Error("StPageFlip did not settle on the requested page"));
      return;
    }
    void finishPendingTurn();
  });
}

function handleEngineFlip(event) {
  const pageIndex = Number(event?.data);
  if (!pendingTurn || pendingTurn.finishing) return;
  if (pageIndex !== pendingTurn.targetPosition) {
    schedulePendingTurnSettle(
      new Error(
        `StPageFlip reached page ${pageIndex}, expected ${pendingTurn.targetPosition}`,
      ),
    );
    return;
  }
  pendingTurn.targetReached = true;
  schedulePendingTurnSettle();
}

function handleEngineState(event) {
  if (!pendingTurn || pendingTurn.finishing || event?.data !== "read") return;
  pendingTurn.engineRead = true;
  schedulePendingTurnSettle();
}

function syncPortraitGeometry(width, height) {
  if (!pageFlip) return;
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(320, Math.round(height));
  const settings = pageFlip.getSettings?.();
  if (settings) {
    settings.width = safeWidth;
    settings.height = safeHeight;
    // page-flip switches to two-page landscape when blockWidth >= minWidth * 2.
    // A Day is one physical page, so keep the threshold just above half the
    // current host width and update it before every layout recalculation.
    settings.minWidth = Math.floor(safeWidth / 2) + 1;
    settings.maxWidth = Math.max(settings.maxWidth || 0, safeWidth);
    settings.maxHeight = Math.max(settings.maxHeight || 0, safeHeight);
  }
  if (book.value) book.value.style.minWidth = "0px";
}

async function ensureEngine() {
  if (pageFlip || !props.active || destroyed) return pageFlip;
  if (ensureEnginePromise) return ensureEnginePromise;

  engineUnavailable.value = false;

  ensureEnginePromise = (async () => {
    try {
      await nextTick();
      const PageFlip = await loadPageFlip();
      await nextTick();
      if (destroyed || !book.value || !props.active) return null;

      const width = Math.max(1, Math.round(host.value?.clientWidth ?? 0));
      const height = Math.max(320, Math.round(host.value?.clientHeight ?? 0));
      const pages = book.value.querySelectorAll("[data-day-flipbook-source]");
      const startPage = Math.max(0, positionForDate(props.selectedDate));
      if (!width || pages.length !== pageEntries.value.length || !pages.length) {
        throw new Error("StPageFlip pages are not ready");
      }

      pageFlip = new PageFlip(book.value, {
        width,
        height,
        size: "stretch",
        minWidth: Math.floor(width / 2) + 1,
        maxWidth: Math.max(2048, width),
        minHeight: 320,
        maxHeight: Math.max(2048, height),
        autoSize: false,
        flippingTime: Math.max(120, Number(props.duration) || 850),
        maxShadowOpacity: 0.4,
        drawShadow: true,
        usePortrait: true,
        showCover: false,
        useMouseEvents: false,
        mobileScrollSupport: false,
        showPageCorners: false,
        // Built-in pointer handlers are disabled. Keeping this false also avoids
        // page-flip@2.0.7 rejecting programmatic flipPrev() in portrait mode.
        disableFlipByClick: false,
        startPage,
      });
      pageFlip.loadFromHTML(pages);
      // useMouseEvents=false leaves only page-flip's global resize listener.
      // ResizeObserver below owns layout updates so geometry is synchronized
      // before the engine can reconsider its orientation.
      pageFlip.getUI?.().removeHandlers?.();
      syncPortraitGeometry(width, height);
      pageFlip.update();
      installRenderGuards(pageFlip);
      requestEngineFrames(3);
      pageFlip.on("flip", handleEngineFlip);
      pageFlip.on("changeState", handleEngineState);
      engineReady.value = true;
      engineInstanceId.value += 1;
      book.value.dataset.engineReady = "true";
      lastWidth = host.value?.clientWidth ?? width;
      lastHeight = host.value?.clientHeight ?? height;
      return pageFlip;
    } catch (error) {
      engineUnavailable.value = true;
      engineReady.value = false;
      emit("animation-error", error);
      return null;
    } finally {
      ensureEnginePromise = null;
    }
  })();

  return ensureEnginePromise;
}

function clearFallbackTimer() {
  globalThis.clearTimeout?.(fallbackTimer);
  fallbackTimer = undefined;
}

function finishEngineAnimation() {
  if (!pageFlip) return;
  requestEngineFrames(3);
  try {
    pageFlip.getRender?.().finishAnimation?.();
  } catch {
    // A half-created animation is realigned by alignEngineToDate below.
  }
}

function clearEngineArtifacts() {
  if (!pageFlip) return;
  const pages = pageFlip.getPageCollection?.().getPages?.() ?? [];
  for (const page of pages) page.hideTemporaryCopy?.();
  pageFlip.getRender?.().clearShadow?.();
}

function alignEngineToDate(date, { update = false } = {}) {
  if (!pageFlip) return false;
  const position = positionForDate(date);
  if (position < 0) return false;
  requestEngineFrames(3);
  if (update && props.active) {
    syncPortraitGeometry(
      host.value?.clientWidth ?? lastWidth,
      host.value?.clientHeight ?? lastHeight,
    );
    pageFlip.update();
  }
  pageFlip.turnToPage(position);
  scrollPageToTop(position);
  return true;
}

function cancelPendingTurn() {
  const turn = pendingTurn;
  transitionEpoch += 1;
  pendingTurn = null;
  clearFallbackTimer();
  clearPendingSettleFrame();
  finishEngineAnimation();
  alignEngineToDate(props.selectedDate);
  phase.value = "idle";
  setBusy(false);
  turn?.resolve(false);
  return transitionEpoch;
}

async function commitWithoutAnimation(targetDate, commitNavigation, token = ++transitionEpoch) {
  internalCommitDate = targetDate;
  try {
    await commitNavigation();
    if (token !== transitionEpoch) return false;
    await nextTick();
    alignEngineToDate(targetDate);
    return true;
  } catch (error) {
    if (token === transitionEpoch) alignEngineToDate(props.selectedDate);
    throw error;
  } finally {
    if (internalCommitDate === targetDate) internalCommitDate = null;
  }
}

async function recoverPendingTurn(error) {
  const turn = pendingTurn;
  if (!turn || turn.finishing) return;
  turn.finishing = true;
  clearFallbackTimer();
  clearPendingSettleFrame();
  emit("animation-error", error);
  finishEngineAnimation();
  if (pageFlip?.getCurrentPageIndex?.() !== turn.targetPosition) {
    requestEngineFrames(3);
    pageFlip?.turnToPage?.(turn.targetPosition);
  }
  phase.value = "committing";
  internalCommitDate = turn.targetDate;
  try {
    await turn.commitNavigation();
    if (turn.token !== transitionEpoch || pendingTurn !== turn) return;
    await nextTick();
    alignEngineToDate(turn.targetDate);
    turn.resolve(true);
  } catch (commitError) {
    if (turn.token === transitionEpoch) {
      alignEngineToDate(props.selectedDate);
      turn.reject(commitError);
    }
  } finally {
    if (internalCommitDate === turn.targetDate) internalCommitDate = null;
    if (pendingTurn === turn) pendingTurn = null;
    if (turn.token === transitionEpoch) {
      phase.value = "idle";
      setBusy(false);
    }
  }
}

async function finishPendingTurn() {
  const turn = pendingTurn;
  if (!turn || turn.finishing) return;
  turn.finishing = true;
  clearFallbackTimer();
  clearPendingSettleFrame();
  phase.value = "committing";
  internalCommitDate = turn.targetDate;
  try {
    await turn.commitNavigation();
    if (turn.token !== transitionEpoch || pendingTurn !== turn) return;
    await nextTick();
    alignEngineToDate(turn.targetDate);
    turn.resolve(true);
  } catch (error) {
    if (turn.token === transitionEpoch) {
      alignEngineToDate(props.selectedDate);
      turn.reject(error);
    }
  } finally {
    if (internalCommitDate === turn.targetDate) internalCommitDate = null;
    if (pendingTurn === turn) pendingTurn = null;
    if (turn.token === transitionEpoch) {
      phase.value = "idle";
      setBusy(false);
    }
  }
}

async function turn(direction, targetDate, commitNavigation) {
  if (typeof commitNavigation !== "function") {
    throw new TypeError("commitNavigation must be a function");
  }
  if (busy.value) return false;

  const token = ++transitionEpoch;
  setBusy(true);
  try {
    const targetPosition = positionForDate(targetDate);
    if (!hydratedPositions.value.has(targetPosition)) {
      cancelHydrationRecenter();
      hydrationAnchorDate.value = props.selectedDate;
      hydrationRadius.value = 1;
      await nextTick();
    }

    if (prefersReducedMotion()) {
      return await commitWithoutAnimation(targetDate, commitNavigation, token);
    }

    const engine = await ensureEngine();
    if (token !== transitionEpoch || !props.active) return false;
    if (!engine || engineUnavailable.value) {
      return await commitWithoutAnimation(targetDate, commitNavigation, token);
    }

    const currentWidth = Math.max(1, Math.round(host.value?.clientWidth ?? 0));
    const currentHeight = Math.max(320, Math.round(host.value?.clientHeight ?? 0));
    if (
      engine.getOrientation?.() !== "portrait"
      || Math.abs(currentWidth - lastWidth) >= 8
      || Math.abs(currentHeight - lastHeight) >= 8
    ) {
      syncPortraitGeometry(currentWidth, currentHeight);
      requestEngineFrames(3);
      engine.update();
      lastWidth = currentWidth;
      lastHeight = currentHeight;
      layoutDirty = false;
      alignEngineToDate(props.selectedDate);
    }
    if (engine.getOrientation?.() !== "portrait") {
      const error = new Error("StPageFlip could not preserve single-page portrait mode");
      emit("animation-error", error);
      return await commitWithoutAnimation(targetDate, commitNavigation, token);
    }

    const sourcePosition = positionForDate(props.selectedDate);
    const expectedTarget = sourcePosition + (direction === "previous" ? -1 : 1);
    if (sourcePosition < 0 || targetPosition !== expectedTarget) {
      throw new RangeError(`target date is not adjacent to the current page: ${targetDate}`);
    }

    if (engine.getCurrentPageIndex() !== sourcePosition) {
      alignEngineToDate(props.selectedDate);
    }
    scrollPageToTop(targetPosition);
    phase.value = "animating";

    const result = new Promise((resolve, reject) => {
      pendingTurn = {
        token,
        targetDate,
        targetPosition,
        commitNavigation,
        resolve,
        reject,
        finishing: false,
        targetReached: false,
        engineRead: false,
        recoveryError: null,
      };
    });
    fallbackTimer = globalThis.setTimeout?.(
      () => void recoverPendingTurn(new Error("StPageFlip completion event timed out")),
      Math.max(120, Number(props.duration) || 850) + 1200,
    );

    try {
      if (direction === "previous") engine.flipPrev();
      else engine.flipNext();
      hydrateTemporaryCopy(sourcePosition);
      globalThis.requestAnimationFrame?.(() => {
        if (pendingTurn?.token !== token || pendingTurn.finishing) return;
        if (
          engine.getState?.() === "read"
          && engine.getCurrentPageIndex?.() !== targetPosition
        ) {
          schedulePendingTurnSettle(new Error("StPageFlip animation did not start"));
        }
      });
    } catch (error) {
      schedulePendingTurnSettle(error);
    }
    return await result;
  } finally {
    if (!pendingTurn && phase.value !== "committing") {
      phase.value = "idle";
      setBusy(false);
    }
  }
}

function beginSwipe(clientX, clientY, target, pointerType = "touch", button = 0) {
  if (!props.active || busy.value || (pointerType === "mouse" && button !== 0)) return;
  const element = target instanceof Element ? target : null;
  const editable = element?.closest?.("input, textarea, [contenteditable]") ?? null;
  if (editable && editable === document.activeElement) return;
  swipeActive = true;
  swipeStartX = clientX;
  swipeStartY = clientY;
  swipeStartedOnControl = Boolean(editable || element?.closest?.("button, a, select"));
}

function continueSwipe(clientX, clientY) {
  if (!swipeActive || busy.value) return;
  const deltaX = clientX - swipeStartX;
  const deltaY = clientY - swipeStartY;
  if (Math.abs(deltaX) < 26 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return;
  swipeActive = false;
  const now = Date.now();
  if (swipeStartedOnControl) suppressClickUntil = now + 500;
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused.closest("input, textarea, [contenteditable]")) {
    focused.blur();
  }
  emit("navigate", deltaX < 0 ? 1 : -1);
}

function handlePointerDown(event) {
  beginSwipe(event.clientX, event.clientY, event.target, event.pointerType, event.button);
}

function handlePointerMove(event) {
  if (event.pointerType === "mouse" && event.buttons === 0) {
    swipeActive = false;
    return;
  }
  continueSwipe(event.clientX, event.clientY);
}

function handleTouchStart(event) {
  if (event.touches.length !== 1) return;
  const touch = event.touches[0];
  beginSwipe(touch.clientX, touch.clientY, event.target);
}

function handleTouchMove(event) {
  if (event.touches.length !== 1) {
    swipeActive = false;
    return;
  }
  continueSwipe(event.touches[0].clientX, event.touches[0].clientY);
}

function endSwipe() {
  swipeActive = false;
}

function handleClickCapture(event) {
  if (Date.now() >= suppressClickUntil) return;
  event.preventDefault();
  event.stopPropagation();
}

function applyEngineLayout() {
  if (!pageFlip || !props.active || busy.value || destroyed) {
    layoutDirty ||= Boolean(pageFlip && props.active && busy.value);
    return;
  }
  const width = host.value?.clientWidth ?? 0;
  const height = host.value?.clientHeight ?? 0;
  if (!width || !height) return;
  lastWidth = width;
  lastHeight = height;
  layoutDirty = false;
  syncPortraitGeometry(width, height);
  requestEngineFrames(3);
  pageFlip.update();
  alignEngineToDate(props.selectedDate);
}

function flushDeferredLayout() {
  if (!layoutDirty || busy.value || destroyed) return;
  globalThis.clearTimeout?.(resizeTimer);
  resizeTimer = globalThis.setTimeout?.(() => {
    applyEngineLayout();
  }, 0);
}

function refreshEngineLayout() {
  if (!pageFlip || !props.active) return;
  const width = host.value?.clientWidth ?? 0;
  const height = host.value?.clientHeight ?? 0;
  if (Math.abs(width - lastWidth) < 8 && Math.abs(height - lastHeight) < 8) return;
  if (busy.value) {
    layoutDirty = true;
    return;
  }
  globalThis.clearTimeout?.(resizeTimer);
  resizeTimer = globalThis.setTimeout?.(applyEngineLayout, 80);
}

watch(
  () => props.selectedDate,
  (date) => {
    if (internalCommitDate === date) {
      scheduleHydrationRecenter(date);
      return;
    }
    cancelHydrationRecenter();
    hydrationAnchorDate.value = date;
    hydrationRadius.value = 0;
    const token = cancelPendingTurn();
    void nextTick().then(() => {
      if (token !== transitionEpoch) return;
      alignEngineToDate(date);
      scheduleHydrationRecenter(date);
    });
  },
);

watch(
  () => props.active,
  (active) => {
    if (!active) {
      cancelHydrationRecenter();
      hydrationRadius.value = 0;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && host.value?.contains(focused)) focused.blur();
      if (busy.value || phase.value !== "idle") cancelPendingTurn();
      clearEngineArtifacts();
      setEngineRenderingActive(false);
      return;
    }
    hydrationAnchorDate.value = props.selectedDate;
    hydrationRadius.value = 0;
    setEngineRenderingActive(true);
    void nextTick().then(async () => {
      const engine = await ensureEngine();
      if (!engine) return;
      setEngineRenderingActive(true);
      await nextTick();
      alignEngineToDate(props.selectedDate, { update: true });
      scheduleHydrationRecenter(props.selectedDate);
    });
  },
);

onMounted(() => {
  window.addEventListener("pointerup", endSwipe);
  window.addEventListener("touchend", endSwipe);
  window.addEventListener("touchcancel", endSwipe);
  resizeObserver = new ResizeObserver(refreshEngineLayout);
  if (host.value) resizeObserver.observe(host.value);
  if (props.active) {
    void ensureEngine().then((engine) => {
      if (engine) scheduleHydrationRecenter(props.selectedDate);
    });
  }
});

onBeforeUnmount(() => {
  destroyed = true;
  clearFallbackTimer();
  clearPendingSettleFrame();
  cancelHydrationRecenter();
  globalThis.clearTimeout?.(resizeTimer);
  resizeObserver?.disconnect();
  window.removeEventListener("pointerup", endSwipe);
  window.removeEventListener("touchend", endSwipe);
  window.removeEventListener("touchcancel", endSwipe);
  if (pendingTurn) {
    pendingTurn.resolve(false);
    pendingTurn = null;
  }
  if (pageFlip) {
    pageFlip.off("flip");
    pageFlip.off("changeState");
    try {
      finishEngineAnimation();
      const render = pageFlip.getRender?.();
      if (render) {
        render.drawFrame = () => {};
        render.render = () => {};
      }
      pageFlip.getUI?.().removeHandlers?.();
      pageFlip.destroy();
    } catch {
      // The document may already be tearing down.
    }
  }
  pageFlip = null;
  requestEngineFrames = () => {};
  setEngineRenderingActive = () => {};
  setBusy(false);
});

defineExpose({
  cancelPendingTurn,
  turn,
  scrollCurrentToTop: scrollPageToTop,
});
</script>

<template>
  <div
    ref="host"
    class="day-flipbook"
    :class="{ 'day-flipbook--turning': busy }"
    data-page-transition="flipbook"
    :data-flipbook-phase="phase"
    :data-engine-instance="engineInstanceId || undefined"
    :data-hydrated-page-count="hydratedPositions.size"
    :data-hydration-anchor-date="hydrationAnchorDate"
    :data-hydration-radius="hydrationRadius"
    :aria-busy="busy"
    @click.capture="handleClickCapture"
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
    @touchstart.passive="handleTouchStart"
    @touchmove.passive="handleTouchMove"
  >
    <div v-if="engineUnavailable && active" class="day-flipbook__fallback">
      <slot :date="selectedDate" :active="active" />
    </div>

    <div
      v-show="!engineUnavailable"
      ref="book"
      class="stpageflip-book"
      data-flipbook-engine="stpageflip"
      :data-engine-ready="engineReady"
      :data-page-count="pageEntries.length"
      :aria-hidden="!active"
      :inert="!active || undefined"
    >
      <div
        v-for="entry in pageEntries"
        :key="entry.date"
        class="day-flipbook-page paper-surface"
        data-day-flipbook-source
        data-density="soft"
        :data-page-position="entry.position"
        :data-page-date="entry.date"
        :aria-hidden="!active || entry.date !== selectedDate"
        :inert="!active || entry.date !== selectedDate || undefined"
      >
        <slot
          v-if="!engineUnavailable && hydratedPositions.has(entry.position)"
          :date="entry.date"
          :active="active && entry.date === selectedDate"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.day-flipbook,
.day-flipbook__fallback,
.stpageflip-book {
  height: 100%;
  inset: 0;
  position: absolute;
  width: 100%;
}

.day-flipbook__fallback {
  z-index: 1;
}

.day-flipbook--turning {
  pointer-events: none;
}

.stpageflip-book {
  background: rgb(var(--v-theme-background));
  contain: layout paint;
  isolation: isolate;
  overflow: hidden;
  z-index: 2;
}

.stpageflip-book:not([data-engine-ready="true"]) > .day-flipbook-page {
  display: none;
}

.stpageflip-book:not([data-engine-ready="true"])
  > .day-flipbook-page[aria-hidden="false"] {
  display: block;
  height: 100%;
  inset: 0;
  position: absolute;
  width: 100%;
}

.day-flipbook-page {
  background: rgb(var(--v-theme-background));
  box-shadow: inset 0 0 0 1px rgba(var(--v-theme-outline), 0.14);
  overflow: hidden;
}

.day-flipbook-page[aria-hidden="true"] {
  pointer-events: none;
}

.day-flipbook-page :deep(.day-page) {
  height: 100%;
  width: 100%;
}

.stpageflip-book :deep(.stf__wrapper),
.stpageflip-book :deep(.stf__block) {
  height: 100%;
  width: 100%;
}
</style>
