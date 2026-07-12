<script setup>
import { computed, nextTick, onMounted, ref } from "vue";

import AdjacentDayEar from "./components/AdjacentDayEar.vue";
import FavoritesView from "./components/FavoritesView.vue";
import MonthOverview from "./components/MonthOverview.vue";
import PoeticHeader from "./components/PoeticHeader.vue";
import RaffleView from "./components/RaffleView.vue";
import SaturdayView from "./components/SaturdayView.vue";
import TotalStatsView from "./components/TotalStatsView.vue";
import WeekOverview from "./components/WeekOverview.vue";
import WeekStatsView from "./components/WeekStatsView.vue";
import WorkdayView from "./components/WorkdayView.vue";
import {
  CAMPAIGN_END,
  CAMPAIGN_START,
  DAY_TYPE,
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
} from "./domain/campaign.js";
import { PRIZE_DEFINITIONS } from "./domain/raffle.js";
import { quoteForDate } from "./data/quotes.js";
import {
  initializeCampaignStore,
  useCampaignStore,
} from "./composables/useCampaignStore.js";

const store = useCampaignStore();
const drawer = ref(false);
const viewMode = ref("day");
const priorView = ref("day");
const statsReference = ref(null);
const returnDate = ref(null);
const pageDirection = ref("page-next");
const dayScroll = ref(null);
const snackbarQueue = ref([]);
const spinning = ref(false);
const lastResult = ref(null);
const pendingDrawMode = ref(null);
const slot6Dialog = ref(false);
const awardDialog = ref(false);
const awardBlankDates = ref([]);
let pinchStartDistance = 0;
let pinchTriggered = false;

const campaignDates = getCampaignDates();
const campaignWeeks = getCampaignWeeks();
const selectedDate = computed(
  () => store.state.preferences?.selectedDate ?? CAMPAIGN_START,
);
const currentDay = computed(() => store.state.days?.[selectedDate.value]);
const currentDayType = computed(() => getDayType(selectedDate.value));
const currentQuote = computed(() => quoteForDate(selectedDate.value));
const quoteLiked = computed(() =>
  Boolean(currentQuote.value && store.state.quoteLikes?.[currentQuote.value.id]),
);

const dateMeta = computed(() => {
  const [year, month, day] = selectedDate.value.split("-");
  return { year, month, day, weekday: getWeekdayName(selectedDate.value) };
});

const selectedIndex = computed(() => campaignDates.indexOf(selectedDate.value));
const previousDate = computed(() => campaignDates[selectedIndex.value - 1] ?? null);
const nextDate = computed(() => campaignDates[selectedIndex.value + 1] ?? null);

function earLabel(date) {
  if (!date) return "";
  const [, month, day] = date.split("-");
  return `${month}/${day} ${getWeekdayName(date).slice(-2)}`;
}

function enqueue(text, color = "primary", timeout = 2600) {
  snackbarQueue.value.push({ text, color, timeout });
}

function navigateDate(delta) {
  const next = campaignDates[selectedIndex.value + delta];
  if (!next) return;
  pageDirection.value = delta > 0 ? "page-next" : "page-prev";
  statsReference.value = null;
  returnDate.value = null;
  store.setSelectedDate(next);
  nextTick(() => dayScroll.value?.scrollTo?.({ top: 0, behavior: "instant" }));
}

function selectDate(date) {
  if (date === "2026-08-30") {
    openWeekStats(CAMPAIGN_END);
    return;
  }
  pageDirection.value = date > selectedDate.value ? "page-next" : "page-prev";
  statsReference.value = null;
  returnDate.value = null;
  store.setSelectedDate(date);
  viewMode.value = "day";
}

function navigateView(mode) {
  priorView.value = viewMode.value;
  viewMode.value = mode;
  drawer.value = false;
}

function openWeekStats(date = selectedDate.value) {
  const week = getCampaignWeek(date);
  returnDate.value = selectedDate.value;
  statsReference.value = week.startDate;
  if (!week.virtualSummary) {
    pageDirection.value = "page-next";
    store.setSelectedDate(week.summaryDate);
    viewMode.value = "day";
  } else {
    navigateView("week-stats");
  }
  drawer.value = false;
}

function returnFromStats() {
  if (returnDate.value) store.setSelectedDate(returnDate.value);
  viewMode.value = "day";
  returnDate.value = null;
  statsReference.value = null;
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

function toggleQuote() {
  const wasLiked = quoteLiked.value;
  store.toggleQuoteLike(currentQuote.value);
  enqueue(wasLiked ? "已移出赠语收藏" : "已收藏这句赠语", wasLiked ? "outline" : "secondary");
}

const displayItems = computed(() =>
  currentDayType.value === DAY_TYPE.WORKDAY
    ? store.workdayViewItems(selectedDate.value)
    : [],
);
const saturdayItems = computed(() => store.saturdayViewItems(selectedDate.value));

function cycleCurrent(slotOrId) {
  const day = currentDay.value;
  const slot =
    typeof slotOrId === "number"
      ? slotOrId
      : day?.items?.find((item) => item.id === slotOrId)?.slot;
  if (!slot) return;
  if (!store.cycleStatus(selectedDate.value, slot)) {
    enqueue("该项已由转盘免除，并按完成统计", "secondary");
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

function singleDaySummary(date) {
  if (date === "2026-08-30" || getDayType(date) === DAY_TYPE.SUNDAY) {
    const stats = calculateWeekStats(store.state, date, { asOf: CAMPAIGN_END });
    return { completed: stats.completedItems, total: stats.planItems };
  }
  const stats = calculateStatsForDates(store.state, [date], { asOf: date });
  return { completed: stats.completedItems, total: stats.planItems };
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
    .map((draw) => ({
      ...draw,
      source: draw.mode === "paper-bonus" ? "paper" : "daily",
      sourceLabel: draw.mode === "paper-bonus" ? "试卷额外机会" : "每日机会",
    })),
);
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
const probabilitySummary = [
  { label: "免下一个工作日第 1—8 项", probability: "各 1% · 共 8%" },
  { label: "免周六努力", probability: "0.5%" },
  { label: "免下一对应工作日全天", probability: "各 0.1% · 共 0.5%" },
  { label: "免下一周工作日", probability: "0.001%" },
  { label: "未中", probability: "90.999%" },
];

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
  spinning.value = true;
  try {
    await new Promise((resolve) => setTimeout(resolve, 900));
    const result = await store.performDraw(store.today.value, mode, redistribute);
    const won = result.prize.kind !== "none";
    lastResult.value = {
      label: result.prize.label,
      type: result.prize.kind,
      won,
      description: won ? "免项已写入对应日期，并按完成统计" : "风停在空签上，把好运留给下一次",
    };
    enqueue(won ? "恭喜，免项已即时保存" : "本次未中，记录已保存", won ? "secondary" : "outline");
    if (result.awardPreparation?.requiresBlankSlot6Confirmation) {
      awardBlankDates.value = result.awardPreparation.blankSlot6Dates;
      awardDialog.value = true;
    }
  } catch (error) {
    enqueue(error.message || "抽签未能完成", "error", 4200);
  } finally {
    spinning.value = false;
  }
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

onMounted(async () => {
  await initializeCampaignStore();
  if (store.saveError.value) enqueue("本地存储初始化失败，请检查浏览器权限", "error", 4800);
});
</script>

<template>
  <v-app>
    <div
      class="mobile-prototype"
      @touchstart.passive="onTouchStart"
      @touchmove.passive="onTouchMove"
      @touchend.passive="onTouchEnd"
    >
      <v-navigation-drawer
        v-model="drawer"
        absolute
        temporary
        width="286"
        class="tool-drawer"
      >
        <v-list-item class="drawer-brand py-5" lines="three">
          <template #prepend>
            <v-avatar color="secondary" variant="tonal">
              <v-icon icon="mdi-fountain-pen-tip" />
            </v-avatar>
          </template>
          <v-list-item-title>朝夕笺</v-list-item-title>
          <v-list-item-subtitle>07.13—08.29 · 把日子写成光</v-list-item-subtitle>
        </v-list-item>
        <v-divider />
        <v-list nav density="comfortable" class="pt-3">
          <v-list-item prepend-icon="mdi-calendar-today-outline" title="日视图" @click="navigateView('day')" />
          <v-list-item prepend-icon="mdi-calendar-week-outline" title="周视图" @click="navigateView('week')" />
          <v-list-item prepend-icon="mdi-calendar-month-outline" title="月视图" @click="navigateView('month')" />
          <v-list-item prepend-icon="mdi-chart-timeline-variant" title="本周统计" @click="openCurrentWeekFromDrawer" />
          <v-list-item prepend-icon="mdi-chart-box-outline" title="总统计" @click="navigateView('total')" />
          <v-list-item prepend-icon="mdi-heart-multiple-outline" title="赠语收藏" @click="navigateView('favorites')" />
          <v-list-item prepend-icon="mdi-dice-multiple-outline" title="摸鱼大转盘" @click="navigateView('raffle')" />
        </v-list>
        <template #append>
          <v-list-item
            class="text-caption text-medium-emphasis"
            prepend-icon="mdi-database-check-outline"
            :title="store.saving.value ? '正在写入本地…' : '内容已在本地保存'"
            subtitle="IndexedDB · 即时持久化"
          />
        </template>
      </v-navigation-drawer>

      <v-btn
        v-if="viewMode !== 'day'"
        class="alternate-menu"
        icon="mdi-menu"
        variant="text"
        size="44"
        aria-label="打开工具栏"
        @click="drawer = true"
      />

      <v-fade-transition mode="out-in">
        <section v-if="viewMode === 'day'" key="day" class="day-stage paper-surface">
          <AdjacentDayEar
            side="left"
            :label="earLabel(previousDate)"
            :disabled="!previousDate"
            @navigate="navigateDate(-1)"
          />
          <AdjacentDayEar
            side="right"
            :label="earLabel(nextDate)"
            :disabled="!nextDate"
            @navigate="navigateDate(1)"
          />

          <transition :name="pageDirection" mode="out-in">
            <div
              :key="selectedDate"
              ref="dayScroll"
              v-touch="{ left: () => navigateDate(1), right: () => navigateDate(-1) }"
              class="paper-scroll day-page"
            >
              <PoeticHeader
                :meta="dateMeta"
                :quote="currentQuote?.text"
                :liked="quoteLiked"
                @menu="drawer = true"
                @copy="copyText(currentQuote?.text, '今日赠语已复制')"
                @toggle-like="toggleQuote"
              />

              <div class="day-body">
                <div v-if="currentDayType !== DAY_TYPE.SUNDAY" class="week-jump-wrap">
                  <v-btn
                    size="small"
                    variant="text"
                    append-icon="mdi-chart-timeline-variant"
                    @click="openWeekStats()"
                  >
                    本周统计
                  </v-btn>
                </div>

                <WorkdayView
                  v-if="currentDayType === DAY_TYPE.WORKDAY"
                  :items="displayItems"
                  :diary="currentDay?.journal ?? ''"
                  @cycle="cycleCurrent"
                  @update-item="store.updateItem(selectedDate, $event.slot, $event.value)"
                  @update:diary="store.updateJournal(selectedDate, $event)"
                />

                <SaturdayView
                  v-else-if="currentDayType === DAY_TYPE.SATURDAY"
                  :items="saturdayItems"
                  @cycle="cycleCurrent"
                  @update-item="store.updateSaturdayItem(selectedDate, $event.id, $event.value)"
                  @remove="store.removeSaturday(selectedDate, $event)"
                  @add="store.addSaturdayItem(selectedDate, $event)"
                  @add-many="store.addSaturdayItems(selectedDate, $event)"
                />

                <WeekStatsView
                  v-else
                  :stats="weekStats"
                  :week-label="weekLabel"
                  :week-index="activeStatsWeek.number"
                  @back="closeSundayStats"
                />
              </div>
            </div>
          </transition>
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
            @select="selectDate"
            @pinch-out="navigateView('week')"
          />
        </section>

        <section v-else-if="viewMode === 'week-stats'" key="week-stats" class="view-stage paper-surface">
          <WeekStatsView
            :stats="weekStats"
            :week-label="weekLabel"
            :week-index="activeStatsWeek.number"
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
            @copy="copyText($event.textSnapshot, '赠语已复制')"
            @unlike="store.unlikeQuote($event.quoteId)"
            @back="navigateView('day')"
          />
        </section>

        <section v-else key="raffle" class="view-stage paper-surface">
          <RaffleView
            :daily-available="dailyAvailable"
            :paper-available="paperAvailable"
            :paper-claims-used="paperClaimsUsed"
            :campaign-phase="raffleCampaignPhase"
            :draws-today="drawsToday"
            :last-result="lastResult"
            :spinning="spinning"
            :probability-summary="probabilitySummary"
            @draw="requestDraw"
            @claim-paper="claimPaper"
            @back="navigateView('day')"
          />
        </section>
      </v-fade-transition>

      <v-overlay
        :model-value="!store.ready.value"
        contained
        persistent
        class="align-center justify-center"
        scrim="#FDFBF8"
      >
        <div class="loading-note text-center">
          <v-progress-circular indeterminate color="primary" size="32" width="2" />
          <div class="mt-3">正在展开今日书页</div>
        </div>
      </v-overlay>

      <v-snackbar-queue
        v-model="snackbarQueue"
        closable
        location="bottom center"
      />
    </div>

    <v-dialog v-model="slot6Dialog" max-width="356" persistent>
      <v-card variant="outlined">
        <v-card-item prepend-icon="mdi-dice-multiple-outline">
          <v-card-title>第 6 项仍是留白</v-card-title>
        </v-card-item>
        <v-card-text>
          下一工作日的第 6 项尚未填写。确认继续留空时，它原本的 1% 会平均分给其余七项；保留则仍按八项各 1% 抽取。
        </v-card-text>
        <v-card-actions class="flex-column align-stretch ga-2 px-4 pb-4">
          <v-btn variant="outlined" min-height="44" @click="resolveSlot6(false)">保留八项原概率</v-btn>
          <v-btn color="primary" variant="flat" min-height="44" @click="resolveSlot6(true)">确认留空并平分</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="awardDialog" max-width="356">
      <v-card variant="outlined">
        <v-card-item prepend-icon="mdi-calendar-check-outline">
          <v-card-title>全天免项已生效</v-card-title>
        </v-card-item>
        <v-card-text>
          目标日期 {{ awardBlankDates.join("、") }} 的第 6 项目前为空。保持留白不会计入计划；若之后填写，也会自动继承本次免项。
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn color="primary" variant="text" min-height="44" @click="awardDialog = false">知道了</v-btn>
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

.day-page {
  padding-bottom: calc(30px + env(safe-area-inset-bottom));
  touch-action: pan-y;
}

.day-body {
  margin: 0 auto;
  max-width: 354px;
  padding: 0 18px 28px;
  position: relative;
}

.day-body :deep(.week-stats-view) {
  height: auto;
  overflow: visible;
  padding-inline: 0;
}

.week-jump-wrap {
  display: flex;
  justify-content: flex-end;
  margin: -8px 0 0;
}

.alternate-menu {
  right: 6px;
  position: absolute;
  top: max(6px, env(safe-area-inset-top));
  z-index: 12;
}

.tool-drawer {
  background: rgba(253, 251, 248, 0.98) !important;
  border-right: 1px solid rgba(132, 124, 127, 0.28);
}

.drawer-brand :deep(.v-list-item-title) {
  font-family: "Noto Serif SC Variable", "Noto Serif SC", serif;
  font-size: 1.2rem;
  letter-spacing: 0.16em;
}

.loading-note {
  color: rgb(var(--v-theme-primary));
  font-family: "Noto Serif SC Variable", "Noto Serif SC", serif;
  letter-spacing: 0.08em;
}

@media (max-width: 360px) {
  .day-body {
    max-width: 332px;
    padding-inline: 14px;
  }
}
</style>
