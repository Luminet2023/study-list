<script setup>
const props = defineProps({
  weekRows: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(["select", "pinch-out"]);

let startDistance = 0;
let pinchTriggered = false;

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
  if (startDistance - distance > 42) {
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

const rateFor = (row) => {
  if (row.rewardComplete) return 100;
  const total = Number(row.total ?? 0);
  if (!total) return 0;
  return Math.min(100, Math.round((Number(row.completed ?? 0) / total) * 100));
};

const dateText = (date) => {
  const value = String(date ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value.slice(5).replace("-", "/")
    : value;
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

const rowIcon = (row) => {
  if (row.rewardComplete) return "mdi-gift-outline";
  if (Number(row.total ?? 0) && Number(row.completed ?? 0) >= Number(row.total)) {
    return "mdi-check";
  }
  if (Number(row.total ?? 0)) return "mdi-circle-outline";
  return "mdi-minus";
};
</script>

<template>
  <section
    class="week-overview"
    aria-labelledby="week-overview-title"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
    @touchend.passive="onTouchEnd"
  >
    <v-toolbar color="transparent" density="compact">
      <v-toolbar-title id="week-overview-title" class="view-title">
        一周成诗
      </v-toolbar-title>
      <v-btn
        icon="mdi-calendar-month-outline"
        variant="text"
        aria-label="切换视图层级"
        title="双指捏合，或点击进入月视图"
        @click="emit('pinch-out')"
      />
    </v-toolbar>

    <p class="view-caption px-4 mb-2">
      七日沿一条细线展开；轻触某日回到当日，双指捏合可继续望向整月。
    </p>

    <v-fade-transition appear>
      <v-timeline
        v-if="props.weekRows.length"
        class="week-line"
        align="start"
        side="end"
        density="compact"
        truncate-line="both"
        line-color="outline-variant"
      >
        <v-timeline-item
          v-for="row in props.weekRows"
          :key="row.date"
          :dot-color="row.isSelected ? 'primary' : 'surface-variant'"
          :icon="rowIcon(row)"
          :icon-color="row.isSelected ? 'surface' : 'primary'"
          fill-dot
          size="small"
        >
          <v-card
            class="day-card"
            :class="{ 'day-card--selected': row.isSelected }"
            :color="row.isSelected ? 'primary' : undefined"
            variant="outlined"
            elevation="0"
            role="button"
            tabindex="0"
            :aria-label="`打开 ${row.label} ${dateText(row.date)}`"
            @click="emit('select', row.date)"
            @keydown.enter="emit('select', row.date)"
            @keydown.space.prevent="emit('select', row.date)"
          >
            <v-card-item>
              <template #prepend>
                <div class="date-number">{{ dateText(row.date) }}</div>
              </template>
              <v-card-title class="day-title">{{ row.label }}</v-card-title>
              <v-card-subtitle>{{ kindText(row.kind) }}</v-card-subtitle>
              <template #append>
                <v-chip
                  size="x-small"
                  :variant="row.isSelected ? 'flat' : 'outlined'"
                  :color="row.isSelected ? 'surface' : 'primary'"
                >
                  {{ row.rewardComplete && !Number(row.total ?? 0) ? "奖励满格" : `${Number(row.completed ?? 0)}/${Number(row.total ?? 0)}` }}
                </v-chip>
              </template>
            </v-card-item>
            <v-card-text class="pt-0">
              <v-progress-linear
                :model-value="rateFor(row)"
                :color="row.isSelected ? 'surface' : 'primary'"
                bg-color="surface-variant"
                height="4"
                rounded
              />
            </v-card-text>
          </v-card>
        </v-timeline-item>
      </v-timeline>

      <v-empty-state
        v-else
        icon="mdi-calendar-blank-outline"
        title="本周仍是空白"
        text="计划写下后，七日轨迹会在这里缓缓展开。"
      />
    </v-fade-transition>
  </section>
</template>

<style scoped>
.week-overview {
  width: 100%;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  padding: 12px 10px 28px;
  touch-action: pan-y;
}

.view-title,
.day-title,
.date-number {
  font-family: var(--app-font-family);
}

.view-title {
  letter-spacing: 0.12em;
}

.view-caption {
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-family: var(--app-font-family);
  font-size: 0.76rem;
  line-height: 1.8;
}

.week-line {
  padding-inline: 2px;
}

.day-card {
  width: 100%;
  background-color: rgba(var(--v-theme-surface), 0.5);
}

.day-card--selected {
  background-color: rgba(var(--v-theme-primary), 0.08);
}

:global(.v-theme--poeticNight) .day-card:not(.day-card--selected) {
  background-color: rgba(var(--v-theme-surface), 0.92);
}

:global(.v-theme--poeticNight) .view-caption {
  color: rgba(var(--v-theme-on-surface), 0.72);
}

.date-number {
  min-width: 3.25rem;
  font-size: 1.05rem;
  letter-spacing: 0.04em;
}

.day-title {
  font-size: 0.95rem;
  letter-spacing: 0.08em;
}

:deep(.v-timeline-item__body) {
  width: 100%;
  min-width: 0;
}

@media (max-width: 360px) {
  .week-overview {
    padding-inline: 6px;
  }

  .date-number {
    min-width: 2.8rem;
    font-size: 0.9rem;
  }
}
</style>
