<script setup>
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onMounted,
  ref,
  shallowRef,
  watch,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { useDisplay } from "vuetify";

import AdjacentDayEar from "./components/AdjacentDayEar.vue";
import DayFlipbook from "./components/DayFlipbook.vue";
import DayPage from "./components/DayPage.vue";
import {
  CAMPAIGN_END,
  CAMPAIGN_START,
  DAY_TYPE,
  areWorkdayGoalInputsComplete,
  calculateStatsForDates,
  calculateTotalStats,
  calculateWeekStats,
  countCharacters,
  getCampaignDates,
  getCampaignWeek,
  getCampaignWeeks,
  getDayType,
  getItemText,
  getWeekdayName,
  isAwardRedeemed,
  isWorkdayJournalUnlocked,
} from "./domain/campaign.js";
import { PRIZE_DEFINITIONS } from "./domain/raffle.js";
import { quoteForDate } from "./data/quotes.js";
import { fetchUniqueHitokoto } from "./services/hitokoto.js";
import { resolveRouteSelectedDate } from "./router/routeState.js";
import {
  initializeCampaignStore,
  useCampaignStore,
} from "./composables/useCampaignStore.js";
import {
  initializeAuthSession,
  useAuthSession,
} from "./composables/useAuthSession.js";

const FavoritesView = defineAsyncComponent(() => import("./components/FavoritesView.vue"));
const CampaignEndingView = defineAsyncComponent(() => import("./components/CampaignEndingView.vue"));
const MonthOverview = defineAsyncComponent(() => import("./components/MonthOverview.vue"));
const RaffleView = defineAsyncComponent(() => import("./components/RaffleView.vue"));
const SettingsView = defineAsyncComponent(() => import("./components/SettingsView.vue"));
const TotalStatsView = defineAsyncComponent(() => import("./components/TotalStatsView.vue"));
const WeekOverview = defineAsyncComponent(() => import("./components/WeekOverview.vue"));
const WeekStatsView = defineAsyncComponent(() => import("./components/WeekStatsView.vue"));

const store = useCampaignStore();
const auth = useAuthSession();
const syncModule = shallowRef(null);
const syncControls = shallowRef(null);
const route = useRoute();
const router = useRouter();
const { mdAndUp } = useDisplay();
const drawer = ref(false);
const mobileCloudMenu = ref(false);
const viewMode = ref(route.meta.viewMode ?? "day");
const priorView = ref("day");
const statsReference = ref(null);
const returnDate = ref(null);
const dayFlipbook = ref(null);
const dayTurnBusy = ref(false);
const dayTurnEarState = ref(null);
const snackbarQueue = ref([]);
const spinning = ref(false);
const drawSettled = ref(false);
const drawLandingTarget = ref(null);
const DRAW_ANIMATION_DURATION_MS = 1800;
const DRAW_WHEEL_LANDING_TIMEOUT_MS = 3000;
const DRAW_RESULT_DIALOG_HOLD_MS = 5000;
const lastResult = ref(null);
const pendingDrawMode = ref(null);
const slot6Dialog = ref(false);
const goalLockDialog = ref(false);
const goalLockDate = ref(null);
const minimalModeDialog = ref(false);
const rulesDialog = ref(false);
const awardSlot6Confirmation = ref(null);
const redeemingDrawId = ref(null);
const baselineConfirmDialog = ref(false);
const baselineResolutionChoice = ref(null);
const hitokotoLoading = ref(false);
const hitokotoError = ref("");
const hitokotoRetryToken = ref(0);
const hitokotoSessionBindings = ref({});
let pendingDrawNotice = null;
let drawWheelSettleResolver = null;
let pinchStartDistance = 0;
let pinchTriggered = false;

const campaignDates = getCampaignDates();
const campaignWeeks = getCampaignWeeks();
const selectedDate = computed(
  () => store.state.preferences?.selectedDate ?? CAMPAIGN_START,
);
const currentDay = computed(() => store.state.days?.[selectedDate.value]);
const quoteSource = computed(() =>
  store.state.preferences?.quoteSource === "hitokoto" ? "hitokoto" : "native",
);
const hitokotoCategories = computed(() =>
  Array.isArray(store.state.preferences?.hitokotoCategories)
    ? store.state.preferences.hitokotoCategories
    : [],
);
const persistedHitokoto = computed(() => currentDay.value?.blessing?.hitokoto ?? null);
const currentHitokoto = computed(() =>
  persistedHitokoto.value ?? hitokotoSessionBindings.value[selectedDate.value] ?? null,
);

function hitokotoForDate(date) {
  return store.state.days?.[date]?.blessing?.hitokoto
    ?? hitokotoSessionBindings.value[date]
    ?? null;
}

function quoteForDay(date) {
  if (quoteSource.value === "hitokoto") {
    const binding = hitokotoForDate(date);
    if (!binding?.uuid || !binding?.hitokoto) return null;
    return {
      id: `hitokoto:${binding.uuid}`,
      uuid: binding.uuid,
      date,
      text: binding.hitokoto,
      source: "hitokoto",
      type: binding.type ?? null,
      from: binding.from ?? null,
      fromWho: binding.fromWho ?? null,
    };
  }
  const quote = quoteForDate(date);
  return quote ? { ...quote, source: "native" } : null;
}

function quoteAttributionFor(quote) {
  if (quote?.source !== "hitokoto") return "";
  const source = [quote.fromWho, quote.from].filter(Boolean).join(" · ");
  return source ? `一言 · ${source}` : "一言";
}

function quoteAttributionHrefFor(quote) {
  return quote?.source === "hitokoto" && quote.uuid
    ? `https://hitokoto.cn?uuid=${encodeURIComponent(quote.uuid)}`
    : "";
}

watch(
  () => [selectedDate.value, persistedHitokoto.value],
  ([date, binding]) => {
    if (!binding?.uuid || !binding?.hitokoto) return;
    if (hitokotoSessionBindings.value[date]?.uuid === binding.uuid) return;
    hitokotoSessionBindings.value = {
      ...hitokotoSessionBindings.value,
      [date]: { ...binding },
    };
  },
  { immediate: true, deep: true },
);

watch(
  () => store.state.baselineId,
  (nextBaseline, previousBaseline) => {
    if (previousBaseline && nextBaseline !== previousBaseline) {
      hitokotoSessionBindings.value = {};
    }
  },
);
const fontFamily = computed(() => {
  const value = store.state.preferences?.fontFamily;
  return ["system", "lxgw-wenka", "anthropic"].includes(value)
    ? value
    : "lxgw-wenka";
});
const minimalMode = computed(() => store.state.preferences?.minimalMode === true);
const cloudSyncTitle = computed(() => {
  if (!auth.user.value) return "通过 Linux DO 登录";
  if (syncControls.value?.baselineConflict.value) return "同步进度等待确认";
  if (syncControls.value?.syncing.value) return "正在同步到云端…";
  if (["connecting", "backoff"].includes(syncControls.value?.connectionState.value)) {
    return "正在重新连接云端…";
  }
  if (syncControls.value?.connectionState.value === "paused") return "云同步已暂停";
  if (syncControls.value?.error.value) return "云同步暂不可用";
  // if (syncControls.value?.conflictCount.value) {
  //   return `已自动合并 ${syncControls.value.conflictCount.value} 次冲突`;
  // }
  return "本地与云端已同步";
});
const cloudSyncSubtitle = computed(() => {
  if (!auth.user.value) return "登录后自动进行增量同步";
  const name = auth.user.value.name || auth.user.value.username || "Linux DO 用户";
  return `${name}`;
});
const localSaveTitle = computed(() => {
  if (store.saving.value) return "正在写入本地…";
  if (store.pendingSave.value) return "等待批量保存…";
  return "内容已在本地保存";
});
const mobileCloudFabIcon = computed(() => {
  if (!auth.user.value) return "mdi-cloud-off-outline";
  if (baselineConflictState.value) return "mdi-cloud-alert-outline";
  if (syncControls.value?.error.value) return "mdi-cloud-alert";
  return "mdi-cloud-check-outline";
});
const mobileCloudFabColor = computed(() => {
  if (baselineConflictState.value || syncControls.value?.error.value) return "error";
  return auth.user.value ? "primary" : "surface-variant";
});
const baselineConflictState = computed(
  () => syncControls.value?.baselineConflict.value ?? null,
);
const baselineResolving = computed(
  () => Boolean(syncControls.value?.resolvingBaseline.value),
);

watch(
  fontFamily,
  (value) => {
    if (typeof document !== "undefined") document.documentElement.dataset.font = value;
  },
  { immediate: true },
);

let hitokotoRequestSequence = 0;
watch(
  () => [
    store.ready.value,
    viewMode.value,
    quoteSource.value,
    selectedDate.value,
    hitokotoCategories.value.join(","),
    hitokotoRetryToken.value,
    currentHitokoto.value?.uuid ?? "",
  ],
  async ([ready, mode, source, date], _previous, onCleanup) => {
    const sequence = ++hitokotoRequestSequence;
    const controller = new AbortController();
    onCleanup(() => controller.abort());

    if (!ready || mode !== "day" || source !== "hitokoto" || currentHitokoto.value?.uuid) {
      hitokotoLoading.value = false;
      hitokotoError.value = "";
      return;
    }

    hitokotoLoading.value = true;
    hitokotoError.value = "";
    try {
      let bound = false;
      for (let bindingAttempt = 0; bindingAttempt < 3 && !bound; bindingAttempt += 1) {
        const result = await fetchUniqueHitokoto(hitokotoCategories.value, {
          usedUuids: store.boundHitokotoUuids(date),
          signal: controller.signal,
        });
        // 同步往返可能短暂用较旧的云端快照替换响应式状态。若本轮等待期间
        // 已经出现绑定，就直接结束，避免同一天再次向一言发起请求。
        const bindingThatAppeared =
          store.state.days?.[date]?.blessing?.hitokoto ?? hitokotoSessionBindings.value[date];
        if (bindingThatAppeared?.uuid) {
          bound = true;
          break;
        }
        try {
          await store.bindHitokoto(date, result);
          const confirmedBinding = store.state.days?.[date]?.blessing?.hitokoto;
          bound = Boolean(confirmedBinding?.uuid && confirmedBinding?.hitokoto);
          if (bound) {
            // 事务确认后立即写入会话稳定层，不等待 Vue watcher 的下一次调度。
            // 这样即使紧接着发生 /exchange 状态替换，也不会重新请求或换句。
            hitokotoSessionBindings.value = {
              ...hitokotoSessionBindings.value,
              [date]: { ...confirmedBinding },
            };
          }
        } catch (error) {
          if (error?.code !== "DUPLICATE_HITOKOTO_UUID") throw error;
        }
      }
      if (!bound) throw new Error("一言查重后仍无法绑定");
    } catch (error) {
      if (error?.name === "AbortError" || controller.signal.aborted) return;
      if (sequence === hitokotoRequestSequence) {
        hitokotoError.value = "一言暂时未抵达";
        enqueue("一言获取失败，可点击重新获取", "error", 4200);
      }
    } finally {
      if (sequence === hitokotoRequestSequence) hitokotoLoading.value = false;
    }
  },
  { immediate: true },
);

function retryHitokoto() {
  hitokotoError.value = "";
  hitokotoRetryToken.value += 1;
}

function dateMetaFor(date) {
  const [year, month, day] = date.split("-");
  return { year, month, day, weekday: getWeekdayName(date) };
}

const selectedIndex = computed(() => campaignDates.indexOf(selectedDate.value));
const previousDate = computed(() => campaignDates[selectedIndex.value - 1] ?? null);
const nextDate = computed(() => campaignDates[selectedIndex.value + 1] ?? null);
const previousEarLabel = computed(() =>
  dayTurnEarState.value?.previousLabel ?? earLabel(previousDate.value),
);
const nextEarLabel = computed(() =>
  dayTurnEarState.value?.nextLabel
  ?? (selectedDate.value === CAMPAIGN_END ? "旅程终章" : earLabel(nextDate.value)),
);
const nextEarAriaLabel = computed(() =>
  dayTurnEarState.value?.nextAriaLabel
  ?? (selectedDate.value === CAMPAIGN_END ? "进入旅程终章" : "后一天"),
);

function routeParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

function routeLocation(mode, date = selectedDate.value) {
  if (mode === "day") return { name: "day", params: { date } };
  if (mode === "week") return { name: "week", params: { date } };
  if (mode === "month") return { name: "month", params: { month: date.slice(0, 7) } };
  if (mode === "week-stats") {
    return {
      name: "week-stats",
      params: { date: getCampaignWeek(date).startDate },
      query: { from: selectedDate.value },
    };
  }
  if (mode === "total") return { name: "total" };
  if (mode === "favorites") return { name: "favorites" };
  if (mode === "raffle") return { name: "raffle" };
  if (mode === "ending") return { name: "ending" };
  return { name: "settings" };
}

function applyRouteState() {
  const mode = String(route.meta.viewMode ?? "day");
  const date = routeParam(route.params.date);
  const month = routeParam(route.params.month);
  const from = routeParam(route.query.from);

  if (mode !== "day") dayFlipbook.value?.cancelPendingTurn?.();
  viewMode.value = mode;
  if (mdAndUp.value) drawer.value = true;
  const routeSelectedDate = resolveRouteSelectedDate({
    mode,
    date,
    from,
    currentDate: selectedDate.value,
    campaignDates,
  });
  if (routeSelectedDate !== selectedDate.value) store.setSelectedDate(routeSelectedDate);
  if (mode === "month" && month && !selectedDate.value.startsWith(month)) {
    const firstDate = campaignDates.find((candidate) => candidate.startsWith(month));
    if (firstDate) store.setSelectedDate(firstDate);
  }
  if (mode === "week-stats") {
    const referenceDate = date && campaignDates.includes(date) ? date : selectedDate.value;
    statsReference.value = getCampaignWeek(referenceDate).startDate;
    returnDate.value = from && campaignDates.includes(from) ? from : null;
  }
}

watch(() => route.fullPath, applyRouteState, { immediate: true });
watch(mdAndUp, (desktop) => {
  drawer.value = desktop;
}, { immediate: true });

function earLabel(date) {
  if (!date) return "";
  const [, month, day] = date.split("-");
  return `${month}/${day} ${getWeekdayName(date).slice(-2)}`;
}

function handleDayTurnBusy(value) {
  const nextBusy = Boolean(value);
  if (nextBusy && !dayTurnBusy.value) {
    dayTurnEarState.value = {
      previousLabel: earLabel(previousDate.value),
      nextLabel: selectedDate.value === CAMPAIGN_END ? "旅程终章" : earLabel(nextDate.value),
      nextAriaLabel: selectedDate.value === CAMPAIGN_END ? "进入旅程终章" : "后一天",
    };
  }
  dayTurnBusy.value = nextBusy;
  if (!nextBusy) dayTurnEarState.value = null;
}

function enqueue(text, color = "primary", timeout = 2600) {
  snackbarQueue.value.push({ text, color, timeout });
}

async function commitDateNavigation(next) {
  statsReference.value = null;
  returnDate.value = null;
  store.setSelectedDate(next);
  await router.push(routeLocation("day", next));
  await nextTick();
}

function navigateDate(delta) {
  const next = campaignDates[selectedIndex.value + delta];
  if (!next || dayTurnBusy.value) return;
  const direction = delta > 0 ? "next" : "previous";
  const navigation =
    dayFlipbook.value
      ? dayFlipbook.value.turn(direction, next, () => commitDateNavigation(next))
      : commitDateNavigation(next);
  void Promise.resolve(navigation).catch((error) => {
    enqueue(error?.message || "翻页未能完成", "error", 3600);
  });
}

function advanceFromDay() {
  if (dayTurnBusy.value) return;
  if (selectedDate.value === CAMPAIGN_END) {
    statsReference.value = null;
    returnDate.value = null;
    void router.push(routeLocation("ending"));
    return;
  }
  navigateDate(1);
}

function selectDate(date) {
  if (date === "2026-08-30") {
    openWeekStats(CAMPAIGN_END);
    return;
  }
  dayFlipbook.value?.cancelPendingTurn?.();
  statsReference.value = null;
  returnDate.value = null;
  store.setSelectedDate(date);
  void router.push(routeLocation("day", date));
}

function selectWeekFromMonth(date) {
  if (!campaignDates.includes(date)) return;
  priorView.value = viewMode.value;
  store.setSelectedDate(date);
  drawer.value = mdAndUp.value;
  void router.push(routeLocation("week", date));
}

function navigateView(mode) {
  if (mode !== "day") dayFlipbook.value?.cancelPendingTurn?.();
  priorView.value = viewMode.value;
  drawer.value = mdAndUp.value;
  void router.push(routeLocation(mode));
}

function requestMinimalMode() {
  drawer.value = mdAndUp.value;
  if (minimalMode.value) {
    navigateView("settings");
    return;
  }
  minimalModeDialog.value = true;
}

function confirmMinimalMode() {
  store.setMinimalMode(true);
  minimalModeDialog.value = false;
  mobileCloudMenu.value = false;
  if (["week-stats", "total"].includes(viewMode.value)) navigateView("day");
  enqueue("已进入极简模式，可在设置页关闭", "secondary", 3600);
}

function disableMinimalMode() {
  store.setMinimalMode(false);
  enqueue("已退出极简模式", "outline");
}

function openWeekStats(date = selectedDate.value) {
  dayFlipbook.value?.cancelPendingTurn?.();
  const week = getCampaignWeek(date);
  returnDate.value = selectedDate.value;
  statsReference.value = week.startDate;
  drawer.value = mdAndUp.value;
  void router.push({
    name: "week-stats",
    params: { date: week.startDate },
    query: { from: selectedDate.value },
  });
}

function returnFromStats() {
  const targetDate = returnDate.value ?? selectedDate.value;
  store.setSelectedDate(targetDate);
  returnDate.value = null;
  statsReference.value = null;
  void router.push(routeLocation("day", targetDate));
}

function closeSundayStats() {
  if (returnDate.value) returnFromStats();
  else navigateDate(-1);
}

async function copyText(text, success = "已复制到剪贴板") {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    enqueue(success);
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    if (!copied) throw new Error("copy failed");
    enqueue(success);
  }
}

function toggleQuoteForDate(date) {
  const quote = quoteForDay(date);
  if (!quote) return;
  const wasLiked = Boolean(store.state.quoteLikes?.[quote.id]);
  store.toggleQuoteLike(quote);
  enqueue(wasLiked ? "已移出赠语收藏" : "已收藏这句赠语", wasLiked ? "outline" : "secondary");
}

const goalLockDay = computed(() =>
  goalLockDate.value ? store.state.days?.[goalLockDate.value] : null,
);
const goalPreviewItems = computed(() =>
  (goalLockDay.value?.items ?? []).map((item) => {
    const text = getItemText(item).trim();
    const keepsSlot6Blank = item.slot === 6 && !text;
    return {
      slot: item.slot,
      text: keepsSlot6Blank ? "留空（不计入今日计划）" : text,
      subtitle: keepsSlot6Blank
        ? "保持留空，不要求勾选"
        : [4, 6, 7].includes(item.slot)
          ? "你填写的内容"
          : "固定目标",
    };
  }),
);

function requestGoalLockForDate(date) {
  if (minimalMode.value) return;
  if (!areWorkdayGoalInputsComplete(store.state.days?.[date])) {
    enqueue("请先填写第 4、7 项留白；第 6 项可以留空", "outline");
    return;
  }
  goalLockDate.value = date;
  goalLockDialog.value = true;
}

function closeGoalLockDialog() {
  goalLockDialog.value = false;
  goalLockDate.value = null;
}

function confirmGoalLock() {
  if (!goalLockDate.value || !store.lockGoals(goalLockDate.value)) {
    enqueue(
      minimalMode.value ? "暂时无法锁定今日目标" : "目标尚未填写完整，暂不能锁定",
      "error",
    );
    return;
  }
  closeGoalLockDialog();
  enqueue("今日目标已锁定！", "secondary");
}

function undoGoalLockForDate(date) {
  if (!store.unlockGoals(date)) return;
  enqueue("已重新进入目标编辑状态", "outline");
}

function cycleDate(date, slotOrId) {
  const day = store.state.days?.[date];
  const slot =
    typeof slotOrId === "number"
      ? slotOrId
      : day?.items?.find((item) => item.id === slotOrId)?.slot;
  if (!slot) return;
  const viewItem = store.workdayViewItems(date).find((item) => item.slot === slot);
  if (day?.type === DAY_TYPE.WORKDAY && viewItem?.isPlanned === false) {
    enqueue("第 6 项保持留空，未列入今日计划", "outline");
    return;
  }
  if (!store.cycleStatus(date, slot)) {
    enqueue(
      day?.type === DAY_TYPE.WORKDAY
        && !minimalMode.value
        && !(Boolean(day?.goalsLocked)
          && areWorkdayGoalInputsComplete(day))
        ? "请先填写并锁定今日目标"
        : "该项已由转盘免除，并按完成统计",
      "secondary",
    );
  }
}

function authoredCharacters(dates) {
  let total = 0;
  for (const date of dates) {
    const day = store.state.days?.[date];
    if (!day) continue;
    if (day.type === DAY_TYPE.WORKDAY) {
      for (const item of day.items ?? []) {
        if ([4, 6, 7].includes(item.slot)) total += countCharacters(item.input ?? "");
      }
    } else if (day.type === DAY_TYPE.SATURDAY) {
      for (const item of day.items ?? []) total += countCharacters(getItemText(item));
    }
  }
  return total;
}

function mapStats(raw) {
  const dates = raw.includedDates ?? [];
  return {
    authoredPlanChars: authoredCharacters(dates),
    renderedPlanChars: raw.planCharacters ?? 0,
    diaryChars: raw.journalCharacters ?? 0,
    planCount: raw.planItems ?? 0,
    completedCount: raw.completedItems ?? 0,
    incompleteCount: raw.unfinishedItems ?? 0,
    incompleteBySubject: raw.unfinishedBySubject ?? {},
  };
}

function weekStatsForDate(date) {
  return mapStats(
    calculateWeekStats(store.state, getCampaignWeek(date), { asOf: store.today.value }),
  );
}

function weekLabelForDate(date) {
  const week = getCampaignWeek(date);
  return `${week.startDate.slice(5).replace("-", "/")}—${week.endDate.slice(5).replace("-", "/")}`;
}

const activeStatsWeek = computed(() =>
  getCampaignWeek(statsReference.value ?? selectedDate.value),
);
const rawWeekStats = computed(() =>
  calculateWeekStats(store.state, activeStatsWeek.value, { asOf: store.today.value }),
);
const weekStats = computed(() => mapStats(rawWeekStats.value));
const weekLabel = computed(() => {
  const week = activeStatsWeek.value;
  return `${week.startDate.slice(5).replace("-", "/")}—${week.endDate.slice(5).replace("-", "/")}`;
});

function hasRedeemedAllDayAward(date) {
  return (store.state.raffle?.awards ?? []).some(
    (award) =>
      isAwardRedeemed(award) &&
      award.targets?.some((target) => target?.date === date && target?.slots === "all"),
  );
}

function singleDaySummary(date) {
  if (date === "2026-08-30" || getDayType(date) === DAY_TYPE.SUNDAY) {
    const stats = calculateWeekStats(store.state, date, { asOf: CAMPAIGN_END });
    return { completed: stats.completedItems, total: stats.planItems, rewardComplete: false };
  }
  const stats = calculateStatsForDates(store.state, [date], { asOf: date });
  return {
    completed: stats.completedItems,
    total: stats.planItems,
    rewardComplete: hasRedeemedAllDayAward(date),
  };
}

const weekRows = computed(() => {
  const week = getCampaignWeek(selectedDate.value);
  const dates = week.virtualSummary ? [...week.dates, week.summaryDate] : week.dates;
  return dates.map((date) => {
    const summary = singleDaySummary(date);
    return {
      date,
      label: getWeekdayName(date),
      kind: date === week.summaryDate ? "sunday" : getDayType(date),
      ...summary,
      isSelected: date === selectedDate.value,
    };
  });
});

const monthDays = computed(() =>
  campaignDates.map((date) => ({
    date,
    dayNumber: Number(date.slice(-2)),
    weekday: getWeekdayName(date),
    kind: getDayType(date),
    ...singleDaySummary(date),
    inRange: true,
  })),
);

const rawTotalStats = computed(() =>
  calculateTotalStats(store.state, { asOf: store.today.value }),
);
const totalStats = computed(() => ({
  ...mapStats(rawTotalStats.value),
  attendanceWeeks: rawTotalStats.value.fullAttendanceWeeks,
  winCount: rawTotalStats.value.winCount,
  luckIndex: rawTotalStats.value.luckIndex,
}));

const rawEndingStats = computed(() =>
  calculateTotalStats(store.state, { asOf: CAMPAIGN_END }),
);
const endingStats = computed(() => ({
  ...mapStats(rawEndingStats.value),
  attendanceWeeks: Number(rawEndingStats.value.fullAttendanceWeeks ?? 0),
  winCount: Number(rawEndingStats.value.winCount ?? 0),
  luckIndex: Number(rawEndingStats.value.luckIndex ?? 0),
  campaignDays: campaignDates.length,
}));

function weekWinCount(week) {
  return (store.state.raffle?.draws ?? []).filter(
    (draw) => draw.drawDate >= week.startDate && draw.drawDate <= week.endDate && draw.prizeId !== "none",
  ).length;
}

const totalWeekRows = computed(() =>
  rawTotalStats.value.weeks.map((week) => ({
    id: week.startDate,
    label: `第 ${week.weekNumber} 周 · ${week.startDate.slice(5).replace("-", "/")}`,
    incompleteCount: week.unfinishedItems,
    completedCount: week.completedItems,
    winCount: weekWinCount(week),
  })),
);

const prizeRows = computed(() =>
  Object.entries(rawTotalStats.value.winDistribution ?? {}).map(([id, count]) => ({
    label: PRIZE_DEFINITIONS.find((prize) => prize.id === id)?.label ?? id,
    count,
  })),
);

const drawsToday = computed(() =>
  (store.state.raffle?.draws ?? [])
    .filter((draw) => draw.drawDate === store.today.value)
    .map((draw) => {
      const award = (store.state.raffle?.awards ?? []).find(
        (candidate) =>
          candidate?.drawId === draw.id ||
          candidate?.id === draw.awardId ||
          candidate?.id === `${draw.id}:award`,
      );
      const won = draw.prizeId !== "none";
      const redeemed = Boolean(award && isAwardRedeemed(award));
      return {
        ...draw,
        source:
          draw.mode === "paper-bonus"
            ? "paper"
            : draw.mode === "test-grant"
              ? "test"
              : "daily",
        sourceLabel:
          draw.mode === "paper-bonus"
            ? "试卷额外机会"
            : draw.mode === "test-grant"
              ? "Luminet 测试奖项"
              : "每日机会",
        won,
        redeemed,
        canRedeem: won && Boolean(award) && !redeemed,
        redeemedAt: redeemed ? award.redeemedAt ?? draw.createdAt ?? null : null,
        targetDates: award?.targets?.map((target) => target.date) ?? [],
      };
    }),
);

function redeemedDayAwardsForDate(date) {
  return (store.state.raffle?.awards ?? [])
    .filter(
      (award) =>
        isAwardRedeemed(award) &&
        award.targets?.some((target) => target?.date === date),
    )
    .map((award) => {
      const target = award.targets.find((candidate) => candidate?.date === date);
      const slots = Array.isArray(target?.slots) ? target.slots : [];
      return {
        id: award.id,
        title: `恭喜你兑现「${award.label}」`,
        detail:
          target?.slots === "all"
            ? "今天的计划已按奖励规则全部计为完成。愿这份幸运替努力留出一段从容。"
            : `今天的第 ${slots.join("、")} 项计划已按完成计入统计。`,
      };
    });
}

function buildDayPageModel(date) {
  const day = store.state.days?.[date];
  const dayType = getDayType(date);
  const quote = quoteForDay(date);
  const week = getCampaignWeek(date);
  const goalsReady = dayType === DAY_TYPE.WORKDAY && areWorkdayGoalInputsComplete(day);

  return {
    meta: dateMetaFor(date),
    day,
    dayType,
    quote,
    quoteLiked: Boolean(quote && store.state.quoteLikes?.[quote.id]),
    quoteAttribution: quoteAttributionFor(quote),
    quoteAttributionHref: quoteAttributionHrefFor(quote),
    redeemedAwards: redeemedDayAwardsForDate(date),
    workdayItems: dayType === DAY_TYPE.WORKDAY ? store.workdayViewItems(date) : [],
    saturdayItems: dayType === DAY_TYPE.SATURDAY ? store.saturdayViewItems(date) : [],
    goalsReady,
    goalsLocked: Boolean(day?.goalsLocked) && (minimalMode.value || goalsReady),
    journalUnlocked: dayType === DAY_TYPE.WORKDAY
      ? isWorkdayJournalUnlocked(day, store.state, { minimalMode: minimalMode.value })
      : false,
    weekStats: dayType === DAY_TYPE.SUNDAY ? weekStatsForDate(date) : null,
    weekLabel: weekLabelForDate(date),
    weekIndex: week.number,
  };
}

const dayPageModels = new Map(
  campaignDates.map((date) => [date, computed(() => buildDayPageModel(date))]),
);

function dayPageModel(date) {
  return dayPageModels.get(date)?.value ?? buildDayPageModel(date);
}
const todayInCampaign = computed(
  () => store.today.value >= CAMPAIGN_START && store.today.value <= CAMPAIGN_END,
);
const raffleCampaignPhase = computed(() => {
  if (store.today.value < CAMPAIGN_START) return "before";
  if (store.today.value > CAMPAIGN_END) return "after";
  return "active";
});
const dailyAvailable = computed(
  () => todayInCampaign.value && store.isDailyDrawAvailable(store.today.value),
);
const paperAvailable = computed(
  () => todayInCampaign.value && store.isPaperDrawAvailable(store.today.value),
);
const paperClaimsUsed = computed(() => store.state.raffle?.paperClaims?.length ?? 0);
const probabilitySummary = computed(() => {
  const date = store.today.value < CAMPAIGN_START
    ? CAMPAIGN_START
    : store.today.value > CAMPAIGN_END
      ? CAMPAIGN_END
      : store.today.value;
  return store.raffleProbabilitySummary(date);
});

async function requestDraw(mode) {
  if (!todayInCampaign.value) {
    enqueue("抽签会在 07 月 13 日零点开启", "outline");
    return;
  }
  const preparation = store.rafflePreparation(store.today.value);
  if (preparation.requiresSlot6Confirmation) {
    pendingDrawMode.value = mode;
    slot6Dialog.value = true;
    return;
  }
  await executeDraw(mode, false);
}

async function resolveSlot6(redistribute) {
  const mode = pendingDrawMode.value;
  slot6Dialog.value = false;
  pendingDrawMode.value = null;
  if (mode) await executeDraw(mode, redistribute);
}

async function executeDraw(mode, redistribute) {
  drawSettled.value = false;
  drawLandingTarget.value = null;
  spinning.value = true;
  try {
    await new Promise((resolve) => setTimeout(resolve, DRAW_ANIMATION_DURATION_MS));
    const result = await store.performDraw(store.today.value, mode, redistribute);
    const won = result.prize.kind !== "none";
    lastResult.value = {
      label: result.prize.label,
      type: result.prize.kind,
      won,
      description: won ? "奖励已收入今日抽签，点击兑现后生效" : "风停在空签上，把好运留给下一次",
    };
    pendingDrawNotice = {
      text: won ? "恭喜中奖，请在今日抽签中兑现" : "本次未中，记录已保存",
      color: won ? "secondary" : "outline",
    };
    const wheelSettled = waitForDrawWheelSettlement();
    drawLandingTarget.value = {
      key: result.drawRecord.id,
      prizeKind: result.prize.kind,
    };
    await wheelSettled;
    await new Promise((resolve) => setTimeout(resolve, DRAW_RESULT_DIALOG_HOLD_MS));
  } catch (error) {
    pendingDrawNotice = {
      text: error.message || "抽签未能完成",
      color: "error",
      timeout: 4200,
    };
  } finally {
    spinning.value = false;
  }
}

function waitForDrawWheelSettlement() {
  return new Promise((resolve) => {
    let timeoutId;
    const finish = () => {
      if (drawWheelSettleResolver !== finish) return;
      clearTimeout(timeoutId);
      drawWheelSettleResolver = null;
      drawSettled.value = true;
      resolve();
    };
    drawWheelSettleResolver = finish;
    timeoutId = setTimeout(finish, DRAW_WHEEL_LANDING_TIMEOUT_MS);
  });
}

function handleDrawWheelSettled() {
  drawWheelSettleResolver?.();
}

function handleDrawDialogClosed() {
  const resultNotice = pendingDrawNotice;
  pendingDrawNotice = null;
  drawSettled.value = false;
  drawLandingTarget.value = null;
  drawWheelSettleResolver = null;
  if (resultNotice) enqueue(resultNotice.text, resultNotice.color, resultNotice.timeout);
}

async function redeemDraw(drawId) {
  if (!drawId || redeemingDrawId.value) return;
  redeemingDrawId.value = drawId;
  try {
    const result = await store.redeemRaffleDraw(drawId);
    const targetDates = [...new Set(result.award.targets.map((target) => target.date))];
    lastResult.value = {
      label: result.award.label,
      type: "redeemed",
      won: true,
      description: `已兑现至 ${targetDates.join("、")}，对应奖励项已按完成统计`,
    };
    enqueue(
      targetDates.length === 1
        ? `奖励已兑现，已写入 ${targetDates[0].slice(5).replace("-", "/")}`
        : `奖励已兑现，已写入 ${targetDates.length} 个目标日`,
      "secondary",
      4200,
    );
    if (result.awardPreparation?.requiresBlankSlot6Confirmation) {
      awardSlot6Confirmation.value = {
        dates: result.awardPreparation.blankSlot6Dates,
        prizeId: result.draw.prizeId,
      };
    }
  } catch (error) {
    enqueue(error.message || "奖励未能兑现", "error", 4200);
  } finally {
    redeemingDrawId.value = null;
  }
}

function resolveAwardSlot6(payload) {
  const dates = Array.isArray(payload?.dates)
    ? payload.dates.filter((date) => campaignDates.includes(date))
    : [];
  awardSlot6Confirmation.value = null;
  if (payload?.keepBlank) {
    enqueue("已确认保持留白；第 6 项不计入计划", "secondary");
    return;
  }
  if (!dates.length) return;
  selectDate(dates[0]);
  enqueue(
    dates.length > 1
      ? `已前往 ${dates[0]}，其余留白日期可继续逐日填写`
      : `已前往 ${dates[0]} 填写第 6 项`,
    "tertiary",
    4200,
  );
}

async function claimPaper() {
  if (!todayInCampaign.value) {
    enqueue("试卷额外机会将在活动开始后开放", "outline");
    return;
  }
  try {
    await store.claimPaper(store.today.value);
    enqueue("试卷额外机会已登记，今天内可使用", "tertiary");
  } catch (error) {
    enqueue(error.message || "试卷登记失败", "error", 4200);
  }
}

function openCurrentWeekFromDrawer() {
  openWeekStats(selectedDate.value);
}

function touchDistance(touches) {
  if (touches.length < 2) return 0;
  const [first, second] = touches;
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
}

function onTouchStart(event) {
  if (event.touches.length !== 2) return;
  pinchStartDistance = touchDistance(event.touches);
  pinchTriggered = false;
}

function onTouchMove(event) {
  if (pinchTriggered || event.touches.length !== 2 || !pinchStartDistance) return;
  const ratio = touchDistance(event.touches) / pinchStartDistance;
  if (ratio < 0.78) {
    pinchTriggered = true;
    if (viewMode.value === "day") navigateView("week");
    else if (viewMode.value === "week") navigateView("month");
  } else if (ratio > 1.22) {
    pinchTriggered = true;
    if (viewMode.value === "month") navigateView("week");
    else if (viewMode.value === "week") navigateView("day");
  }
}

function onTouchEnd(event) {
  if (event.touches.length < 2) {
    pinchStartDistance = 0;
    pinchTriggered = false;
  }
}

async function startAuthenticatedSync(user) {
  if (!user?.id) return;
  const module = await import("./sync/syncEngine.js");
  syncModule.value = module;
  syncControls.value = module.useCloudSyncStatus();
  await module.startCloudSync(store, user.id, {
    onAuthRequired: async () => {
      const refreshed = await auth.refresh();
      if (!refreshed) {
        enqueue("Linux DO 登录已失效，请重新登录", "error", 5200);
        return;
      }
      module.stopCloudSync();
      await startAuthenticatedSync(refreshed);
    },
  });
}

async function logoutLinuxDo() {
  try {
    syncModule.value?.stopCloudSync();
    await auth.logout();
    enqueue("已退出 Linux DO，数据仍保留在本机", "secondary");
  } catch (error) {
    enqueue(error.message || "退出登录失败", "error", 4200);
  }
}

function formatSyncTime(value) {
  if (!value) return "尚无修改记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚无修改记录";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function shortBaselineId(value) {
  if (!value) return "未知";
  return `${value.slice(0, 13)}…${value.slice(-6)}`;
}

function requestBaselineResolution(choice) {
  baselineResolutionChoice.value = choice;
  baselineConfirmDialog.value = true;
}

async function confirmBaselineResolution() {
  const choice = baselineResolutionChoice.value;
  if (!choice || !syncControls.value) return;
  try {
    const resolved = choice === "local"
      ? await syncControls.value.resolveWithLocalProgress()
      : await syncControls.value.resolveWithServerProgress();
    if (resolved) {
      baselineConfirmDialog.value = false;
      baselineResolutionChoice.value = null;
      enqueue(
        choice === "local" ? "已用本地进度覆盖云端" : "已用云端进度覆盖本地",
        "secondary",
        4200,
      );
    }
  } catch (error) {
    baselineConfirmDialog.value = false;
    baselineResolutionChoice.value = null;
    enqueue(error.message || "同步进度处理失败", "error", 5200);
  }
}

onMounted(async () => {
  const [, user] = await Promise.all([
    initializeCampaignStore(),
    initializeAuthSession(),
  ]);
  applyRouteState();
  if (store.saveError.value) enqueue("本地存储初始化失败，请检查浏览器权限", "error", 4800);
  if (route.query.auth_error === "oauth_failed") {
    enqueue("Linux DO 登录失败，请检查 Client ID 与 Client Secret", "error", 5200);
    const { auth_error: _authError, ...query } = route.query;
    await router.replace({ path: route.path, query, hash: route.hash });
  }
  if (user) await startAuthenticatedSync(user);
});
</script>

<template>
  <v-app>
    <div
      class="mobile-prototype"
      :class="{ 'mobile-prototype--desktop': mdAndUp }"
      @touchstart.passive="onTouchStart"
      @touchmove.passive="onTouchMove"
      @touchend.passive="onTouchEnd"
    >
      <router-view />
      <v-navigation-drawer
        v-model="drawer"
        absolute
        :permanent="mdAndUp"
        :temporary="!mdAndUp"
        width="286"
        class="tool-drawer"
      >
        <v-list-item v-if="!minimalMode" class="drawer-brand py-5" lines="three">
          <template #prepend>
            <v-avatar color="secondary" variant="tonal">
              <v-icon icon="mdi-fountain-pen-tip" />
            </v-avatar>
          </template>
          <v-list-item-title>暁夕の箋</v-list-item-title>
          <v-list-item-subtitle>日々を光とし</v-list-item-subtitle>
        </v-list-item>
        <v-divider v-if="!minimalMode" />
        <v-list nav density="comfortable" class="pt-3">
          <v-list-item :active="viewMode === 'day'" prepend-icon="mdi-calendar-today-outline" title="日视图" @click="navigateView('day')" />
          <v-list-item :active="viewMode === 'week'" prepend-icon="mdi-calendar-week-outline" title="周视图" @click="navigateView('week')" />
          <v-list-item :active="viewMode === 'month'" prepend-icon="mdi-calendar-month-outline" title="月视图" @click="navigateView('month')" />
          <v-list-item v-if="!minimalMode" :active="viewMode === 'week-stats'" prepend-icon="mdi-chart-timeline-variant" title="本周统计" @click="openCurrentWeekFromDrawer" />
          <v-list-item v-if="!minimalMode" :active="viewMode === 'total'" prepend-icon="mdi-chart-box-outline" title="总统计" @click="navigateView('total')" />
          <v-list-item :active="viewMode === 'favorites'" prepend-icon="mdi-heart-multiple-outline" title="赠语收藏" @click="navigateView('favorites')" />
          <v-list-item :active="viewMode === 'raffle'" prepend-icon="mdi-dice-multiple-outline" title="摸鱼大转盘" @click="navigateView('raffle')" />
          <v-list-item v-if="!minimalMode" prepend-icon="mdi-feather" title="极简模式" @click="requestMinimalMode" />
          <v-list-item :active="viewMode === 'settings'" prepend-icon="mdi-cog-outline" title="设置" @click="navigateView('settings')" />
        </v-list>
        <template #append>
          <div class="drawer-persistence">
            <v-list-item
              v-if="auth.user.value && minimalMode"
              class="cloud-account-item"
              title="Linux DO 已登录"
              :subtitle="cloudSyncSubtitle"
            >
              <template #prepend>
                <v-icon icon="mdi-linux" />
              </template>
              <template #append>
                <v-btn
                  icon="mdi-logout-variant"
                  variant="text"
                  size="small"
                  aria-label="退出 Linux DO"
                  @click="logoutLinuxDo"
                />
              </template>
            </v-list-item>
            <v-list-item
              v-else-if="auth.user.value"
              class="cloud-account-item"
              :title="cloudSyncTitle"
              :subtitle="cloudSyncSubtitle"
            >
              <template #prepend>
                <v-progress-circular
                  v-if="syncControls?.syncing.value"
                  indeterminate
                  color="primary"
                  :size="24"
                  :width="2"
                  aria-label="正在同步到云端"
                />
                <v-icon
                  v-else
                  :icon="baselineConflictState ? 'mdi-cloud-alert-outline' : 'mdi-cloud-check-outline'"
                />
              </template>
              <template #append>
                <v-btn
                  icon="mdi-logout-variant"
                  variant="text"
                  size="small"
                  aria-label="退出 Linux DO"
                  @click="logoutLinuxDo"
                />
              </template>
            </v-list-item>
            <div v-else-if="!minimalMode" class="linuxdo-login-wrap">
              <v-btn
                block
                variant="tonal"
                color="primary"
                prepend-icon="mdi-linux"
                :loading="auth.loading.value"
                @click="auth.login"
              >
                通过 Linux DO 登录
              </v-btn>
            </div>
          </div>
        </template>
      </v-navigation-drawer>

      <v-btn
        v-if="!mdAndUp"
        class="alternate-menu"
        icon="mdi-menu"
        variant="outlined"
        size="44"
        aria-label="打开工具栏"
        @click="drawer = true"
      />

      <v-menu
        v-if="!mdAndUp && !minimalMode"
        v-model="mobileCloudMenu"
        :close-on-content-click="false"
        location="top start"
        :offset="12"
      >
        <template #activator="{ props }">
          <v-fab
            v-bind="props"
            app
            class="mobile-cloud-fab"
            :color="mobileCloudFabColor"
            location="bottom start"
            size="48"
            variant="elevated"
            :aria-label="`云同步状态：${cloudSyncTitle}`"
          >
            <v-progress-circular
              v-if="syncControls?.syncing.value"
              indeterminate
              color="on-primary"
              :size="23"
              :width="2"
            />
            <v-icon v-else :icon="mobileCloudFabIcon" size="24" />
            <span class="sr-only">{{ `云同步状态：${cloudSyncTitle}` }}</span>
          </v-fab>
        </template>

        <v-card class="mobile-cloud-menu-card" color="surface" elevation="14">
          <v-card-item prepend-icon="mdi-cloud-sync-outline">
            <v-card-title>保存与同步</v-card-title>
            <v-card-subtitle>
              {{ auth.user.value ? `${cloudSyncTitle} · ${cloudSyncSubtitle}` : cloudSyncTitle }}
            </v-card-subtitle>
          </v-card-item>
          <v-divider />
          <v-list bg-color="transparent" density="compact" lines="two">
            <!-- <v-list-item
              prepend-icon="mdi-database-check-outline"
              :title="localSaveTitle"
              subtitle="IndexedDB · 业务变更后 1 秒批量保存"
            />
            <v-list-item :title="cloudSyncTitle">
              <template #prepend>
                <v-progress-circular
                  v-if="syncControls?.syncing.value"
                  indeterminate
                  color="primary"
                  :size="22"
                  :width="2"
                />
                <v-icon v-else :icon="mobileCloudFabIcon" />
              </template>
              <v-list-item-subtitle>
                {{ auth.user.value ? "上传 5 秒合并 · 远端变更实时提示" : "登录后启用多设备增量同步" }}
              </v-list-item-subtitle>
            </v-list-item> -->
            <v-list-item
              v-if="auth.user.value"
              prepend-icon="mdi-clock-check-outline"
              title="最近一次同步"
              :subtitle="formatSyncTime(syncControls?.lastSyncedAt.value)"
            />
          </v-list>
          <v-divider />
          <v-card-actions class="px-3 py-3">
            <v-btn
              v-if="auth.user.value"
              block
              color="primary"
              prepend-icon="mdi-logout-variant"
              variant="tonal"
              @click="logoutLinuxDo"
            >
              退出 Linux DO
            </v-btn>
            <v-btn
              v-else
              block
              color="primary"
              prepend-icon="mdi-linux"
              variant="flat"
              :loading="auth.loading.value"
              @click="auth.login"
            >
              通过 Linux DO 登录
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-menu>

      <section v-show="viewMode === 'day'" class="day-stage paper-surface">
        <AdjacentDayEar
          v-if="!minimalMode"
          side="left"
          :label="previousEarLabel"
          :disabled="dayTurnBusy || !previousDate"
          @navigate="navigateDate(-1)"
        />
        <AdjacentDayEar
          v-if="!minimalMode"
          side="right"
          :label="nextEarLabel"
          :aria-label="nextEarAriaLabel"
          :disabled="dayTurnBusy"
          @navigate="advanceFromDay"
        />

        <DayFlipbook
          ref="dayFlipbook"
          :active="viewMode === 'day'"
          :dates="campaignDates"
          :selected-date="selectedDate"
          @navigate="navigateDate"
          @update:busy="handleDayTurnBusy"
          @animation-error="enqueue('3D 翻页暂不可用，已直接完成日期切换', 'error', 4200)"
        >
          <template #default="{ date, active }">
            <DayPage
              v-memo="[
                active,
                dayPageModel(date),
                minimalMode,
                active ? hitokotoLoading : false,
                active ? hitokotoError : '',
              ]"
              :date="date"
              :active="active"
              :page="dayPageModel(date)"
              :minimal-mode="minimalMode"
              :quote-loading="active && hitokotoLoading"
              :quote-error="active ? hitokotoError : ''"
              @copy-quote="copyText(quoteForDay(date)?.text, '今日赠语已复制')"
              @toggle-quote="toggleQuoteForDate(date)"
              @retry-quote="active && retryHitokoto()"
              @open-week-stats="openWeekStats(date)"
              @cycle="cycleDate(date, $event)"
              @request-lock="requestGoalLockForDate(date)"
              @unlock="undoGoalLockForDate(date)"
              @update-item="store.updateItem(date, $event.slot, $event.value)"
              @update-diary="store.updateJournal(date, $event)"
              @update-journal-draft="store.updateJournalDraft(date, $event)"
              @update-saturday-item="store.updateSaturdayItem(date, $event.id, $event.value)"
              @remove-saturday-item="store.removeSaturday(date, $event)"
              @add-saturday-item="store.addSaturdayItem(date, $event)"
              @add-saturday-items="store.addSaturdayItems(date, $event)"
              @close-stats="date === selectedDate && closeSundayStats()"
            />
          </template>
        </DayFlipbook>
      </section>

      <v-fade-transition mode="out-in">
        <section v-if="viewMode === 'ending'" key="ending" class="view-stage paper-surface">
          <CampaignEndingView
            :stats="endingStats"
            @back="selectDate(CAMPAIGN_END)"
          />
        </section>

        <section v-else-if="viewMode === 'week'" key="week" class="view-stage paper-surface">
          <WeekOverview
            :week-rows="weekRows"
            @select="selectDate"
            @pinch-out="navigateView('month')"
          />
        </section>

        <section v-else-if="viewMode === 'month'" key="month" class="view-stage paper-surface">
          <MonthOverview
            :days="monthDays"
            :minimal-mode="minimalMode"
            @select="selectWeekFromMonth"
            @pinch-out="navigateView('week')"
          />
        </section>

        <section v-else-if="viewMode === 'week-stats'" key="week-stats" class="view-stage paper-surface">
          <WeekStatsView
            :stats="weekStats"
            :week-label="weekLabel"
            :week-index="activeStatsWeek.number"
            show-return-action
            @back="returnFromStats"
          />
        </section>

        <section v-else-if="viewMode === 'total'" key="total" class="view-stage paper-surface">
          <TotalStatsView
            :stats="totalStats"
            :week-rows="totalWeekRows"
            :prize-rows="prizeRows"
            @back="navigateView(priorView === 'total' ? 'day' : priorView)"
          />
        </section>

        <section v-else-if="viewMode === 'favorites'" key="favorites" class="view-stage paper-surface">
          <FavoritesView
            :favorites="store.favorites.value"
            :minimal-mode="minimalMode"
            @copy="copyText($event.textSnapshot, '赠语已复制')"
            @unlike="store.unlikeQuote($event.quoteId)"
            @back="navigateView('day')"
          />
        </section>

        <section v-else-if="viewMode === 'raffle'" key="raffle" class="view-stage paper-surface">
          <RaffleView
            :daily-available="dailyAvailable"
            :paper-available="paperAvailable"
            :paper-claims-used="paperClaimsUsed"
            :campaign-phase="raffleCampaignPhase"
            :draws-today="drawsToday"
            :last-result="lastResult"
            :spinning="spinning"
            :draw-settled="drawSettled"
            :draw-landing-target="drawLandingTarget"
            :probability-summary="probabilitySummary"
            :award-slot6-confirmation="awardSlot6Confirmation"
            :redeeming-draw-id="redeemingDrawId"
            @draw="requestDraw"
            @redeem="redeemDraw"
            @claim-paper="claimPaper"
            @back="navigateView('day')"
            @rules="rulesDialog = true"
            @resolve-award-slot6="resolveAwardSlot6"
            @draw-wheel-settled="handleDrawWheelSettled"
            @draw-dialog-closed="handleDrawDialogClosed"
          />
        </section>

        <section v-else-if="viewMode === 'settings'" key="settings" class="view-stage paper-surface">
          <SettingsView
            :model-value="fontFamily"
            :quote-source="quoteSource"
            :hitokoto-categories="hitokotoCategories"
            :minimal-mode="minimalMode"
            @update:model-value="store.setFontFamily"
            @update:quote-source="store.setQuoteSource"
            @update:hitokoto-categories="store.setHitokotoCategories"
            @disable-minimal-mode="disableMinimalMode"
            @back="navigateView('day')"
          />
        </section>
      </v-fade-transition>

      <v-overlay
        :model-value="!store.ready.value"
        contained
        persistent
        class="align-center justify-center"
        scrim="background"
      >
        <div class="loading-note text-center">
          <v-progress-circular indeterminate color="primary" size="32" width="2" />
          <div class="mt-3">正在展开今日书页</div>
        </div>
      </v-overlay>

      <v-snackbar-queue
        v-model="snackbarQueue"
        close-text="关闭"
        closable
        collapsed
        :content-props="{ class: 'app-toast' }"
        display-strategy="overflow"
        location="bottom center"
        :total-visible="5"
      />
    </div>

    <v-dialog
      :model-value="Boolean(baselineConflictState)"
      max-width="720"
      persistent
      scrollable
    >
      <v-card class="baseline-conflict-card" color="surface" elevation="14">
        <v-card-item prepend-icon="mdi-cloud-alert-outline">
          <v-card-title>发现两份不同的学习进度</v-card-title>
          <v-card-subtitle>基线 ID 不一致，自动同步已暂停</v-card-subtitle>
        </v-card-item>

        <v-divider />

        <v-card-text class="baseline-conflict-content">
          <v-alert
            class="mb-4"
            density="compact"
            icon="mdi-information-outline"
            text="请选择要保留的一份进度。另一份会被完整覆盖，并统一使用所选版本的基线 ID。"
            type="warning"
            variant="tonal"
          />

          <div v-if="baselineConflictState" class="baseline-version-grid">
            <v-card class="baseline-version-card" variant="outlined">
              <v-card-item prepend-icon="mdi-database-outline">
                <v-card-title>本地数据库进度</v-card-title>
                <v-card-subtitle>{{ shortBaselineId(baselineConflictState.local.baselineId) }}</v-card-subtitle>
              </v-card-item>
              <v-list bg-color="transparent" density="compact">
                <v-list-item
                  prepend-icon="mdi-calendar-arrow-right"
                  title="进行到"
                  :subtitle="`day ${baselineConflictState.local.progressDay}`"
                />
                <v-list-item
                  prepend-icon="mdi-clock-outline"
                  title="最近一次更改"
                  :subtitle="formatSyncTime(baselineConflictState.local.updatedAt)"
                />
                <v-list-item
                  prepend-icon="mdi-source-commit"
                  title="本地版本"
                  :subtitle="`revision ${baselineConflictState.local.version}`"
                />
              </v-list>
              <v-card-actions class="pa-3 pt-0">
                <v-btn
                  block
                  color="primary"
                  variant="tonal"
                  @click="requestBaselineResolution('local')"
                >
                  用本地进度覆盖云端
                </v-btn>
              </v-card-actions>
            </v-card>

            <v-card class="baseline-version-card" variant="outlined">
              <v-card-item prepend-icon="mdi-cloud-outline">
                <v-card-title>云端进度</v-card-title>
                <v-card-subtitle>{{ shortBaselineId(baselineConflictState.server.baselineId) }}</v-card-subtitle>
              </v-card-item>
              <v-list bg-color="transparent" density="compact">
                <v-list-item
                  prepend-icon="mdi-calendar-arrow-right"
                  title="进行到"
                  :subtitle="`day ${baselineConflictState.server.progressDay}`"
                />
                <v-list-item
                  prepend-icon="mdi-clock-outline"
                  title="最近一次更改"
                  :subtitle="formatSyncTime(baselineConflictState.server.updatedAt)"
                />
                <v-list-item
                  prepend-icon="mdi-source-commit"
                  title="云端版本"
                  :subtitle="`version ${baselineConflictState.server.version}`"
                />
              </v-list>
              <v-card-actions class="pa-3 pt-0">
                <v-btn
                  block
                  color="secondary"
                  variant="tonal"
                  @click="requestBaselineResolution('server')"
                >
                  用云端进度覆盖本地
                </v-btn>
              </v-card-actions>
            </v-card>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog v-model="baselineConfirmDialog" max-width="440" persistent>
      <v-card class="baseline-confirm-card" color="surface" elevation="16">
        <v-card-item prepend-icon="mdi-alert-outline">
          <v-card-title>再次确认覆盖</v-card-title>
        </v-card-item>
        <v-card-text>
          <template v-if="baselineResolutionChoice === 'local'">
            即将使用本地数据库进度覆盖云端。其他设备下次同步时会发现新的基线，并需要重新选择。
          </template>
          <template v-else>
            即将使用云端进度完整覆盖当前浏览器的本地数据库。当前未同步的本地修改将无法自动恢复。
          </template>
        </v-card-text>
        <v-card-actions class="baseline-confirm-actions px-4 pb-4">
          <v-btn
            variant="text"
            :disabled="baselineResolving"
            @click="baselineConfirmDialog = false"
          >
            返回比较
          </v-btn>
          <v-btn
            color="error"
            variant="flat"
            :loading="baselineResolving"
            @click="confirmBaselineResolution"
          >
            确认覆盖
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="minimalModeDialog" max-width="440">
      <v-card class="minimal-mode-card" color="surface" elevation="14">
        <v-card-item prepend-icon="mdi-feather">
          <v-card-title>进入极简模式？</v-card-title>
        </v-card-item>

        <v-divider />

        <v-card-text class="minimal-mode-copy">
          极简模式会隐藏所有不符合你心意的功能，文字，卡片，Chip！
        </v-card-text>

        <v-card-actions class="px-4 pb-4">
          <v-spacer />
          <v-btn variant="text" @click="minimalModeDialog = false">暂不进入</v-btn>
          <v-btn color="primary" variant="flat" @click="confirmMinimalMode">进入极简模式</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="rulesDialog" max-width="560" scrollable>
      <v-card class="rules-card" color="surface" elevation="12">
        <v-card-item prepend-icon="mdi-book-open-variant-outline">
          <v-card-title>规则说明</v-card-title>
          <v-card-subtitle>暁夕の箋 · 2026.07.13—08.29</v-card-subtitle>
          <template #append>
            <v-btn
              icon="mdi-close"
              variant="text"
              aria-label="关闭规则说明"
              @click="rulesDialog = false"
            />
          </template>
        </v-card-item>

        <v-divider />

        <v-card-text class="rules-content pa-0">
          <v-list bg-color="transparent" lines="three">
            <v-list-item
              prepend-icon="mdi-lock-check-outline"
              title="填写并锁定目标"
              :subtitle="minimalMode
                ? '极简模式下无需锁定目标，可直接逐项勾选。'
                : '工作日先填写第 4、7 项；第 6 项可留空。核对锁定后，已计划项目才可逐项勾选。'"
            />
            <v-list-item
              prepend-icon="mdi-check-circle-outline"
              title="完成状态"
              subtitle="每项可依次标记为待完成、已完成或未完成；抽签获得的免项按已完成计入统计。"
            />
            <v-list-item
              prepend-icon="mdi-book-edit-outline"
              title="日记"
              :subtitle="minimalMode
                ? '极简模式下日记可随时书写，内容会自动保存在本地。'
                : '当日有效目标均标记为完成或未完成后解锁，内容会自动保存在本地。'"
            />
            <v-list-item
              prepend-icon="mdi-calendar-weekend-outline"
              title="周末安排"
              subtitle="周六可自行增删学习项目；周日进入本周统计，查看完成情况与日记字数。"
            />
            <v-list-item
              prepend-icon="mdi-dice-multiple-outline"
              title="摸鱼大转盘"
              subtitle="活动期间每日一次抽签；单日完成整张试卷可登记一次额外机会，整个假期最多登记三次。"
            />
            <v-list-item
              prepend-icon="mdi-database-check-outline"
              title="本地保存"
              subtitle="目标、状态、日记、收藏和抽签记录均保存在当前浏览器的 IndexedDB 中。"
            />
          </v-list>
        </v-card-text>

        <v-divider />

        <v-card-actions class="px-4 py-3">
          <v-spacer />
          <v-btn color="primary" variant="flat" @click="rulesDialog = false">我知道了</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="goalLockDialog" max-width="520" persistent>
      <v-card class="goal-lock-card" color="surface" elevation="12">
        <v-card-item prepend-icon="mdi-lock-check-outline">
          <v-card-title>锁定今日目标</v-card-title>
          <v-card-subtitle>{{ goalLockDate }} · 请确认最终清单</v-card-subtitle>
        </v-card-item>

        <v-divider />

        <v-card-text class="goal-lock-content pt-2 pb-1">
          <v-list bg-color="transparent" density="compact" lines="two">
            <v-list-item
              v-for="item in goalPreviewItems"
              :key="item.slot"
              :subtitle="item.subtitle"
              :title="`${item.slot}. ${item.text}`"
            />
          </v-list>

          <v-alert
            class="mt-2"
            density="compact"
            icon="mdi-information-outline"
            text="锁定后第 4、6、7 项将变为只读；第 6 项留空时不计入计划，也不要求勾选。"
            type="info"
            variant="outlined"
          />
        </v-card-text>

        <v-card-actions class="goal-lock-actions px-4 pb-4 pt-2">
          <v-btn block min-height="44" variant="text" @click="closeGoalLockDialog">继续修改</v-btn>
          <v-btn block color="primary" min-height="44" variant="flat" @click="confirmGoalLock">
            确认锁定目标
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="slot6Dialog" max-width="356" persistent>
      <v-card color="surface" variant="elevated" elevation="12">
        <v-card-item prepend-icon="mdi-dice-multiple-outline">
          <v-card-title>第 6 项仍是留白</v-card-title>
        </v-card-item>
        <v-card-text>
          下一工作日的第 6 项尚未填写。确认继续留空时，它原本的 1% 会平均分给其余七项；保留则仍按八项各 1% 抽取。
        </v-card-text>
        <v-card-actions class="flex-column align-stretch ga-2 px-4 pb-4">
          <v-btn variant="elevated" min-height="44" @click="resolveSlot6(false)">保留八项原概率</v-btn>
          <v-btn color="primary" variant="flat" min-height="44" @click="resolveSlot6(true)">确认留空并平分</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

  </v-app>
</template>

<style scoped>
.day-stage,
.view-stage {
  height: 100%;
  inset: 0;
  overflow: hidden;
  position: absolute;
  width: 100%;
}

.day-stage {
  perspective: 1200px;
}

.alternate-menu {
  left: 12px;
  position: absolute;
  top: max(20px, env(safe-area-inset-top));
  z-index: 12;
}

.tool-drawer {
  background: rgba(var(--v-theme-surface), 0.98) !important;
  border-right: 1px solid rgba(var(--v-theme-outline), 0.28);
}

.drawer-persistence {
  border-top: 1px solid rgba(var(--v-theme-outline), 0.2);
  padding-bottom: max(10px, env(safe-area-inset-bottom));
}

.linuxdo-login-wrap {
  padding: 12px 16px 4px;
  text-align: center;
}

.cloud-account-item :deep(.v-list-item-subtitle) {
  opacity: 0.72;
}

/* VListItem 只为 .v-icon 提供默认 32px spacer，进度环需显式对齐同一列。 */
.cloud-account-item :deep(.v-list-item__prepend > .v-progress-circular ~ .v-list-item__spacer) {
  width: var(--v-list-prepend-gap, 32px);
}

.mobile-cloud-fab {
  z-index: 18;
}

.mobile-cloud-fab :deep(.v-fab__container) {
  bottom: max(16px, env(safe-area-inset-bottom));
  left: 16px;
  margin: 0;
}

.mobile-cloud-menu-card {
  background: rgb(var(--v-theme-surface)) !important;
  border: 1px solid rgba(var(--v-theme-outline), 0.34);
  isolation: isolate;
  width: min(320px, calc(100vw - 32px));
}

.mobile-cloud-menu-card :deep(.v-list-item-subtitle) {
  line-height: 1.45;
  opacity: 0.76;
  white-space: normal;
}

.baseline-conflict-card {
  border: 1px solid rgba(var(--v-theme-outline), 0.34);
  max-height: min(88dvh, 720px);
}

.baseline-conflict-content {
  overflow-y: auto;
}

.baseline-version-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: 1fr;
}

.baseline-version-card {
  border-color: rgba(var(--v-theme-outline), 0.38);
  min-width: 0;
}

.baseline-version-card :deep(.v-list-item-subtitle) {
  opacity: 0.8;
}

.baseline-confirm-actions {
  display: grid;
  gap: 8px;
  grid-template-columns: 1fr 1fr;
}

.baseline-confirm-card {
  background: rgb(var(--v-theme-surface)) !important;
  border: 1px solid rgba(var(--v-theme-outline), 0.34);
  isolation: isolate;
}

.drawer-brand :deep(.v-list-item-title) {
  font-family: var(--app-font-family);
  font-size: 1.2rem;
  letter-spacing: 0.16em;
}

.loading-note {
  color: rgb(var(--v-theme-primary));
  font-family: var(--app-font-family);
  letter-spacing: 0.08em;
}

.rules-card {
  max-height: min(82dvh, 680px);
  border: 1px solid rgba(var(--v-theme-outline), 0.32);
}

.minimal-mode-card {
  background: rgb(var(--v-theme-surface)) !important;
  border: 1px solid rgba(var(--v-theme-outline), 0.34);
  isolation: isolate;
}

.minimal-mode-copy {
  line-height: 1.85;
}

.rules-content {
  min-height: 0;
  overflow-y: auto;
}

.rules-content :deep(.v-list-item) {
  padding-block: 8px;
}

.rules-content :deep(.v-list-item-subtitle) {
  line-height: 1.7;
  white-space: normal;
}

.goal-lock-card {
  background-color: rgb(var(--v-theme-surface)) !important;
  border: 1px solid rgba(var(--v-theme-outline), 0.42);
  display: flex;
  flex-direction: column;
  max-height: min(86dvh, 720px);
}

.goal-lock-content {
  min-height: 0;
  overflow-y: auto;
}

.goal-lock-actions {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.goal-lock-actions :deep(.v-btn) {
  margin: 0 !important;
}

@media (max-width: 360px) {
  .goal-lock-actions {
    grid-template-columns: 1fr;
  }

  .baseline-version-grid,
  .baseline-confirm-actions {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 959px) {
  .view-stage :deep(.v-toolbar) {
    padding-left: 56px;
  }
}

@media (min-width: 960px) {
  .day-stage,
  .view-stage {
    left: 286px;
    width: calc(100% - 286px);
  }

  .tool-drawer {
    box-shadow: 12px 0 38px rgba(var(--v-theme-background), 0.32) !important;
  }
}

@media (min-width: 600px) {
  .baseline-version-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
