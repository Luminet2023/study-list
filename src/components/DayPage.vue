<script setup>
import PoeticHeader from "./PoeticHeader.vue";
import SaturdayView from "./SaturdayView.vue";
import WeekStatsView from "./WeekStatsView.vue";
import WorkdayView from "./WorkdayView.vue";

defineProps({
  active: {
    type: Boolean,
    default: false,
  },
  date: {
    type: String,
    required: true,
  },
  page: {
    type: Object,
    required: true,
  },
  quoteLoading: {
    type: Boolean,
    default: false,
  },
  quoteError: {
    type: String,
    default: "",
  },
});

defineEmits([
  "copy-quote",
  "toggle-quote",
  "retry-quote",
  "open-week-stats",
  "cycle",
  "request-lock",
  "unlock",
  "update-item",
  "update-diary",
  "update-journal-draft",
  "update-saturday-item",
  "remove-saturday-item",
  "add-saturday-item",
  "add-saturday-items",
  "close-stats",
]);
</script>

<template>
  <div
    class="paper-scroll day-page"
    :data-page-date="date"
    :aria-current="active ? 'page' : undefined"
  >
    <PoeticHeader
      :active="active"
      :meta="page.meta"
      :quote="page.quote?.text"
      :liked="page.quoteLiked"
      :quote-loading="quoteLoading"
      :quote-error="quoteError"
      :typewriter="page.quote?.source === 'hitokoto'"
      :attribution="page.quoteAttribution"
      :attribution-href="page.quoteAttributionHref"
      @copy="$emit('copy-quote')"
      @toggle-like="$emit('toggle-quote')"
      @retry="$emit('retry-quote')"
    />

    <div class="day-body">
      <VFadeTransition group>
        <VAlert
          v-for="award in page.redeemedAwards"
          :key="award.id"
          class="reward-notice"
          color="secondary"
          icon="mdi-party-popper"
          variant="tonal"
        >
          <div class="reward-notice__title">{{ award.title }}</div>
          <div class="reward-notice__detail">{{ award.detail }}</div>
        </VAlert>
      </VFadeTransition>

      <div v-if="page.dayType !== 'sunday'" class="week-jump-wrap">
        <v-btn
          size="small"
          variant="text"
          append-icon="mdi-chart-timeline-variant"
          @click="$emit('open-week-stats')"
        >
          本周统计
        </v-btn>
      </div>

      <WorkdayView
        v-if="page.dayType === 'workday'"
        :active="active"
        :date="date"
        :items="page.workdayItems"
        :diary="page.day?.journal ?? ''"
        :cloud-draft="page.day?.journalDraft ?? ''"
        :goals-ready="page.goalsReady"
        :goals-locked="page.goalsLocked"
        :journal-unlocked="page.journalUnlocked"
        @cycle="$emit('cycle', $event)"
        @request-lock="$emit('request-lock')"
        @unlock="$emit('unlock')"
        @update-item="$emit('update-item', $event)"
        @update:diary="$emit('update-diary', $event)"
        @update:cloud-draft="$emit('update-journal-draft', $event)"
      />

      <SaturdayView
        v-else-if="page.dayType === 'saturday'"
        :date="date"
        :items="page.saturdayItems"
        :label-id="`saturday-title-${date}`"
        @cycle="$emit('cycle', $event)"
        @update-item="$emit('update-saturday-item', $event)"
        @remove="$emit('remove-saturday-item', $event)"
        @add="$emit('add-saturday-item', $event)"
        @add-many="$emit('add-saturday-items', $event)"
      />

      <WeekStatsView
        v-else
        :active="active"
        :stats="page.weekStats"
        :week-label="page.weekLabel"
        :week-index="page.weekIndex"
        :title-id="`week-stats-title-${date}`"
        @back="$emit('close-stats')"
      />
    </div>
  </div>
</template>

<style scoped>
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

.reward-notice {
  margin: 0 0 14px;
}

.reward-notice__title {
  font-weight: 600;
  letter-spacing: 0.04em;
}

.reward-notice__detail {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.82rem;
  line-height: 1.65;
  margin-top: 4px;
}

@media (max-width: 360px) {
  .day-body {
    max-width: 332px;
    padding-inline: 14px;
  }
}

@media (min-width: 960px) {
  .day-page {
    align-items: start;
    display: grid;
    grid-template-columns: minmax(340px, 0.9fr) minmax(480px, 1.2fr);
  }

  .day-body {
    max-width: 680px;
    padding: 72px 48px 56px;
    width: 100%;
  }

  .week-jump-wrap {
    margin-bottom: 8px;
    margin-top: 0;
  }
}
</style>
