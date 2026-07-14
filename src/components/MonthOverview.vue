<script setup>
import { computed, ref, watch } from "vue";

const props = defineProps({
  days: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(["select", "pinch-out"]);

const firstAvailableDate = () =>
  props.days.find((day) => day.inRange)?.date ?? "2026-07-13";

const selectedDate = ref(firstAvailableDate());
const activeMonth = ref(6);
const activeYear = ref(2026);

let startDistance = 0;
let pinchTriggered = false;

const toIsoDate = (value) => {
  if (!value) return "";
  if (typeof value === "string") {
    const match = value.match(/^\d{4}-\d{2}-\d{2}/);
    return match?.[0] ?? "";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const dayMap = computed(
  () => new Map(props.days.map((day) => [String(day.date), day])),
);

const allowedDateSet = computed(
  () =>
    new Set(
      props.days.filter((day) => day.inRange).map((day) => String(day.date)),
    ),
);

const eventDates = computed(() =>
  props.days.filter((day) => day.inRange).map((day) => day.date),
);

const selectedDay = computed(() => dayMap.value.get(toIsoDate(selectedDate.value)));

const monthPrefix = computed(
  () => `${activeYear.value}-${String(activeMonth.value + 1).padStart(2, "0")}`,
);

const monthTotals = computed(() => {
  const visible = props.days.filter(
    (day) => day.inRange && String(day.date).startsWith(monthPrefix.value),
  );
  return visible.reduce(
    (totals, day) => ({
      completed: totals.completed + Number(day.completed ?? 0),
      total: totals.total + Number(day.total ?? 0),
    }),
    { completed: 0, total: 0 },
  );
});

const monthRate = computed(() => {
  if (!monthTotals.value.total) return 0;
  return Math.min(
    100,
    Math.round((monthTotals.value.completed / monthTotals.value.total) * 100),
  );
});

const monthLabel = computed(() =>
  activeMonth.value === 6 ? "七月卷" : "八月卷",
);

const isAllowedDate = (value) => allowedDateSet.value.has(toIsoDate(value));

const eventColor = (value) => {
  const day = dayMap.value.get(toIsoDate(value));
  if (!day?.inRange) return false;
  if (day.rewardComplete) return "primary";
  const total = Number(day.total ?? 0);
  if (!total) return "outline";
  return Number(day.completed ?? 0) >= total ? "primary" : "error";
};

const kindText = (kind) => {
  const labels = {
    weekday: "工作日",
    workday: "工作日",
    saturday: "周六计划",
    sunday: "周统计",
  };
  return labels[kind] ?? kind ?? "日计划";
};

const onSelect = (value) => {
  const isoDate = toIsoDate(value);
  if (!isoDate || !allowedDateSet.value.has(isoDate)) return;
  emit("select", isoDate);
};

const touchDistance = (touches) => {
  if (touches.length < 2) return 0;
  const [first, second] = touches;
  return Math.hypot(
    second.clientX - first.clientX,
    second.clientY - first.clientY,
  );
};

const onTouchStart = (event) => {
  if (event.touches.length !== 2) return;
  startDistance = touchDistance(event.touches);
  pinchTriggered = false;
};

const onTouchMove = (event) => {
  if (pinchTriggered || event.touches.length !== 2 || !startDistance) return;
  const distance = touchDistance(event.touches);
  if (distance - startDistance > 42) {
    pinchTriggered = true;
    emit("pinch-out");
  }
};

const onTouchEnd = (event) => {
  if (event.touches.length < 2) {
    startDistance = 0;
    pinchTriggered = false;
  }
};

watch(
  () => props.days,
  () => {
    if (!allowedDateSet.value.has(toIsoDate(selectedDate.value))) {
      selectedDate.value = firstAvailableDate();
    }
  },
  { deep: true },
);
</script>

<template>
  <section
    class="month-overview"
    aria-labelledby="month-overview-title"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
    @touchend.passive="onTouchEnd"
  >
    <v-toolbar color="transparent" density="compact">
      <v-toolbar-title id="month-overview-title" class="view-title">
        月色总览
      </v-toolbar-title>
      <v-btn
        icon="mdi-calendar-week-outline"
        variant="text"
        aria-label="返回当前周视图"
        title="双指反向展开，或点击返回当前周"
        @click="emit('pinch-out')"
      />
    </v-toolbar>

    <v-fade-transition appear>
      <div>
        <v-card class="month-progress mx-1 mt-2" variant="outlined" elevation="0">
          <v-card-item>
            <v-card-title class="section-title">{{ monthLabel }}</v-card-title>
            <v-card-subtitle>
              {{ monthTotals.completed }} / {{ monthTotals.total }} 项完成
            </v-card-subtitle>
            <template #append>
              <v-chip size="small" variant="outlined" color="primary">
                {{ monthRate }}%
              </v-chip>
            </template>
          </v-card-item>
          <v-card-text class="pt-0">
            <v-progress-linear
              :model-value="monthRate"
              color="primary"
              bg-color="surface-variant"
              height="5"
              rounded
            />
          </v-card-text>
        </v-card>

        <v-date-picker
          v-model="selectedDate"
          v-model:month="activeMonth"
          v-model:year="activeYear"
          class="paper-calendar mt-2"
          width="100%"
          color="primary"
          bg-color="transparent"
          elevation="0"
          min="2026-07-13"
          max="2026-08-29"
          :allowed-dates="isAllowedDate"
          :allowed-months="[6, 7]"
          :allowed-years="[2026]"
          :events="eventDates"
          :event-color="eventColor"
          :first-day-of-week="1"
          weekday-format="narrow"
          weeks-in-month="static"
          show-adjacent-months
          hide-header
          hide-title
          @update:model-value="onSelect"
        />

        <div class="d-flex flex-wrap justify-center ga-2 px-3 mt-1">
          <v-chip size="x-small" color="primary" variant="outlined">
            <v-icon start icon="mdi-circle-small" /> 已完成
          </v-chip>
          <v-chip size="x-small" color="error" variant="outlined">
            <v-icon start icon="mdi-circle-small" /> 有未完成
          </v-chip>
          <v-chip size="x-small" variant="outlined">
            灰色日期不在计划期
          </v-chip>
        </div>

        <v-card
          v-if="selectedDay"
          class="selected-day mx-1 mt-3"
          variant="outlined"
          elevation="0"
        >
          <v-card-item>
            <template #prepend>
              <v-avatar color="surface-variant" size="42">
                <span class="selected-number">{{ selectedDay.dayNumber }}</span>
              </v-avatar>
            </template>
            <v-card-title class="section-title">{{ selectedDay.weekday }}</v-card-title>
            <v-card-subtitle>
              {{ selectedDay.date }} · {{ kindText(selectedDay.kind) }}
            </v-card-subtitle>
            <template #append>
              <v-btn
                icon="mdi-arrow-right"
                variant="text"
                color="primary"
                aria-label="查看所选日期所在周"
                @click="emit('select', selectedDay.date)"
              />
            </template>
          </v-card-item>
          <v-card-text class="pt-0">
            <template v-if="selectedDay.rewardComplete && !Number(selectedDay.total ?? 0)">
              奖励已兑现 · 当日状态满格 · 点击日期先查看所在周
            </template>
            <template v-else>
              当日完成 {{ Number(selectedDay.completed ?? 0) }} / {{ Number(selectedDay.total ?? 0) }} 项 · 点击日期先查看所在周
            </template>
          </v-card-text>
        </v-card>
      </div>
    </v-fade-transition>
  </section>
</template>

<style scoped>
.month-overview {
  width: 100%;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  padding: 12px 8px 28px;
  touch-action: pan-y;
}

.view-title,
.section-title,
.selected-number {
  font-family: var(--app-font-family);
}

.view-title,
.section-title {
  letter-spacing: 0.1em;
}

.month-progress,
.selected-day {
  background-color: rgba(var(--v-theme-surface), 0.5);
}

:global(.v-theme--poeticNight) .month-progress,
:global(.v-theme--poeticNight) .selected-day {
  background-color: rgba(var(--v-theme-surface), 0.92);
}

.paper-calendar {
  max-width: 100%;
  margin-inline: auto;
}

.selected-number {
  font-size: 1.25rem;
}

:deep(.v-picker) {
  max-width: 100%;
}

:deep(.v-date-picker-month__day-btn) {
  font-family: var(--app-font-family);
}

@media (max-width: 360px) {
  .month-overview {
    padding-inline: 4px;
  }
}
</style>
