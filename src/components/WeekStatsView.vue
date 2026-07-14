<script setup>
import { computed } from "vue";

const props = defineProps({
  active: {
    type: Boolean,
    default: true,
  },
  stats: {
    type: Object,
    default: () => ({
      authoredPlanChars: 0,
      renderedPlanChars: 0,
      diaryChars: 0,
      planCount: 0,
      completedCount: 0,
      incompleteCount: 0,
      incompleteBySubject: {},
    }),
  },
  weekLabel: {
    type: String,
    default: "",
  },
  weekIndex: {
    type: Number,
    default: 1,
  },
  showReturnAction: {
    type: Boolean,
    default: false,
  },
  titleId: {
    type: String,
    default: "week-stats-title",
  },
});

const emit = defineEmits(["back"]);

const subjects = ["语文", "数学", "英语", "物理", "化学", "生物"];

const numberValue = (key) => Number(props.stats?.[key] ?? 0);

const title = computed(
  () => props.weekLabel || `第 ${Math.max(props.weekIndex, 1)} 周`,
);

const completionRate = computed(() => {
  const total = numberValue("planCount");
  if (!total) return 0;
  return Math.min(100, Math.round((numberValue("completedCount") / total) * 100));
});

const presetPlanChars = computed(() =>
  Math.max(
    0,
    numberValue("renderedPlanChars") - numberValue("authoredPlanChars"),
  ),
);

const subjectRows = computed(() =>
  subjects.map((name) => ({
    name,
    count: Number(props.stats?.incompleteBySubject?.[name] ?? 0),
  })),
);

const subjectMax = computed(() =>
  Math.max(1, ...subjectRows.value.map((item) => item.count)),
);
</script>

<template>
  <section class="week-stats-view" :aria-labelledby="titleId">
    <v-toolbar color="transparent" density="compact">
      <v-btn
        icon="mdi-arrow-left"
        variant="text"
        aria-label="返回"
        @click="emit('back')"
      />
      <v-toolbar-title :id="titleId" class="view-title">
        本周留痕
      </v-toolbar-title>
      <v-chip size="small" variant="outlined" color="primary">
        {{ title }}
      </v-chip>
    </v-toolbar>

    <div v-if="showReturnAction" class="stats-return-wrap">
      <v-btn
        size="small"
        variant="text"
        append-icon="mdi-calendar-today-outline"
        @click="emit('back')"
      >
        返回日视图
      </v-btn>
    </div>

    <v-fade-transition :appear="active">
      <div>
        <v-card class="completion-card mt-3" variant="outlined" elevation="0">
          <v-card-item>
            <template #prepend>
              <v-icon icon="mdi-leaf-circle-outline" color="primary" />
            </template>
            <v-card-title class="section-title">完成率</v-card-title>
            <template #append>
              <span class="completion-number">{{ completionRate }}%</span>
            </template>
          </v-card-item>
          <v-card-text class="pt-0">
            <v-progress-linear
              class="completion-progress"
              :model-value="completionRate"
              color="primary"
              bg-color="outline"
              :bg-opacity="0.2"
              height="10"
              rounded
              :aria-label="`本周完成率 ${completionRate}%`"
            />
            <div class="d-flex justify-space-between mt-2 text-caption text-medium-emphasis">
              <span>完成 {{ numberValue("completedCount") }} 项</span>
              <span>未完成 {{ numberValue("incompleteCount") }} 项</span>
            </div>
          </v-card-text>
        </v-card>

        <v-row density="comfortable" class="mt-2">
          <v-col cols="6">
            <v-card class="metric-card" variant="outlined" elevation="0">
              <v-card-text>
                <div class="metric-value">{{ numberValue("renderedPlanChars") }}</div>
                <div class="metric-label">计划总字数</div>
              </v-card-text>
            </v-card>
          </v-col>
          <v-col cols="6">
            <v-card class="metric-card" variant="outlined" elevation="0">
              <v-card-text>
                <div class="metric-value">{{ numberValue("diaryChars") }}</div>
                <div class="metric-label">日记字数</div>
              </v-card-text>
            </v-card>
          </v-col>
          <v-col cols="6">
            <v-card class="metric-card" variant="outlined" elevation="0">
              <v-card-text>
                <div class="metric-value">{{ numberValue("planCount") }}</div>
                <div class="metric-label">本周计划项</div>
              </v-card-text>
            </v-card>
          </v-col>
          <v-col cols="6">
            <v-card class="metric-card" variant="outlined" elevation="0">
              <v-card-text>
                <div class="metric-value">{{ numberValue("authoredPlanChars") }}</div>
                <div class="metric-label">亲笔计划字数</div>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>

        <v-card class="mt-3" variant="outlined" elevation="0">
          <v-card-item>
            <v-card-title class="section-title">六科未完成分布</v-card-title>
            <v-card-subtitle>仅统计可识别科目的未完成任务</v-card-subtitle>
          </v-card-item>
          <v-list bg-color="transparent" density="compact" lines="one">
            <v-list-item v-for="subject in subjectRows" :key="subject.name">
              <template #prepend>
                <v-icon
                  icon="mdi-book-open-page-variant-outline"
                  size="18"
                  color="primary"
                />
              </template>
              <v-list-item-title>{{ subject.name }}</v-list-item-title>
              <v-progress-linear
                class="mt-1"
                :model-value="(subject.count / subjectMax) * 100"
                :color="subject.count ? 'error' : 'outline-variant'"
                bg-color="surface-variant"
                height="3"
                rounded
              />
              <template #append>
                <v-chip size="x-small" variant="outlined">
                  {{ subject.count }} 项
                </v-chip>
              </template>
            </v-list-item>
          </v-list>
        </v-card>

        <v-alert
          class="mt-3"
          type="info"
          variant="outlined"
          density="compact"
          icon="mdi-fountain-pen-tip"
        >
          计划总字数包含你写下的
          {{ numberValue("authoredPlanChars") }} 字，以及固定模板的
          {{ presetPlanChars }} 字。空白第 6 项未填写时不计入计划数，也不参与科目分布。
        </v-alert>
      </div>
    </v-fade-transition>
  </section>
</template>

<style scoped>
.week-stats-view {
  width: 100%;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  padding: 12px 14px 28px;
}

.stats-return-wrap {
  display: flex;
  justify-content: flex-end;
}

.view-title,
.section-title,
.metric-value,
.completion-number {
  font-family: var(--app-font-family);
}

.view-title,
.section-title {
  letter-spacing: 0.08em;
}

.completion-card,
.metric-card {
  background-color: rgba(var(--v-theme-surface), 0.58);
}

:global(.v-theme--poeticNight) .completion-card,
:global(.v-theme--poeticNight) .metric-card {
  background-color: rgba(var(--v-theme-surface), 0.92);
}

.completion-number {
  color: rgb(var(--v-theme-primary));
  font-size: 1.65rem;
  line-height: 1;
}

.metric-card {
  height: 100%;
  text-align: center;
}

.metric-value {
  color: rgb(var(--v-theme-on-surface));
  font-size: clamp(1.5rem, 7vw, 2rem);
  line-height: 1.1;
}

.metric-label {
  margin-top: 7px;
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
}

:global(.v-theme--poeticNight) .metric-label {
  color: rgba(var(--v-theme-on-surface), 0.74);
}

@media (max-width: 360px) {
  .week-stats-view {
    padding-inline: 10px;
  }
}
</style>
