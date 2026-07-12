<script setup>
import { computed, ref } from "vue";

const props = defineProps({
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
      attendanceWeeks: 0,
      winCount: 0,
      luckIndex: 0,
    }),
  },
  weekRows: {
    type: Array,
    default: () => [],
  },
  prizeRows: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(["back"]);
const distributionMode = ref("subject");
const subjects = ["语文", "数学", "英语", "物理", "化学", "生物"];
const numberValue = (key) => Number(props.stats?.[key] ?? 0);

const completionRate = computed(() => {
  const total = numberValue("planCount");
  if (!total) return 0;
  return Math.min(100, Math.round((numberValue("completedCount") / total) * 100));
});

const subjectRows = computed(() =>
  subjects.map((label) => ({
    label,
    count: Number(props.stats?.incompleteBySubject?.[label] ?? 0),
  })),
);

const subjectMax = computed(() =>
  Math.max(1, ...subjectRows.value.map((item) => item.count)),
);

const maxWeekIncomplete = computed(() =>
  Math.max(0, ...props.weekRows.map((row) => Number(row.incompleteCount ?? 0))),
);

const busiestWeekLabel = computed(() => {
  if (!maxWeekIncomplete.value) return "尚无未完成项";
  return props.weekRows
    .filter(
      (row) => Number(row.incompleteCount ?? 0) === maxWeekIncomplete.value,
    )
    .map((row) => row.label)
    .join("、");
});

const luckProgress = computed(() =>
  Math.max(0, Math.min(100, numberValue("luckIndex"))),
);
</script>

<template>
  <section class="total-stats-view" aria-labelledby="total-stats-title">
    <v-toolbar color="transparent" density="compact">
      <v-btn
        icon="mdi-arrow-left"
        variant="text"
        aria-label="返回"
        @click="emit('back')"
      />
      <v-toolbar-title id="total-stats-title" class="view-title">
        假期总卷
      </v-toolbar-title>
      <v-chip size="small" color="primary" variant="outlined">
        07.13 — 08.29
      </v-chip>
    </v-toolbar>

    <v-fade-transition appear>
      <div>
        <v-card class="mt-3 summary-card" variant="outlined" elevation="0">
          <v-card-item>
            <template #prepend>
              <v-icon icon="mdi-chart-line-variant" color="primary" />
            </template>
            <v-card-title class="section-title">全程完成率</v-card-title>
            <template #append>
              <span class="completion-number">{{ completionRate }}%</span>
            </template>
          </v-card-item>
          <v-card-text class="pt-0">
            <v-progress-linear
              :model-value="completionRate"
              color="primary"
              bg-color="surface-variant"
              height="6"
              rounded
            />
            <div class="d-flex flex-wrap ga-2 mt-3">
              <v-chip size="small" variant="outlined" prepend-icon="mdi-check-all">
                完成 {{ numberValue("completedCount") }}
              </v-chip>
              <v-chip size="small" variant="outlined" prepend-icon="mdi-alert-circle-outline">
                未完成 {{ numberValue("incompleteCount") }}
              </v-chip>
              <v-chip size="small" variant="outlined" prepend-icon="mdi-calendar-check-outline">
                满勤 {{ numberValue("attendanceWeeks") }} 周
              </v-chip>
            </div>
          </v-card-text>
        </v-card>

        <v-row dense class="mt-2">
          <v-col cols="6">
            <v-card class="metric-card" variant="outlined" elevation="0">
              <v-card-text>
                <div class="metric-value">{{ numberValue("renderedPlanChars") }}</div>
                <div class="metric-label">计划总字数</div>
                <div class="metric-detail">
                  亲笔 {{ numberValue("authoredPlanChars") }} 字
                </div>
              </v-card-text>
            </v-card>
          </v-col>
          <v-col cols="6">
            <v-card class="metric-card" variant="outlined" elevation="0">
              <v-card-text>
                <div class="metric-value">{{ numberValue("diaryChars") }}</div>
                <div class="metric-label">日结 / 日记字数</div>
                <div class="metric-detail">留给夜晚的回声</div>
              </v-card-text>
            </v-card>
          </v-col>
          <v-col cols="6">
            <v-card class="metric-card" variant="outlined" elevation="0">
              <v-card-text>
                <div class="metric-value">{{ numberValue("planCount") }}</div>
                <div class="metric-label">累计计划项</div>
                <div class="metric-detail">空白第 6 项按规则剔除</div>
              </v-card-text>
            </v-card>
          </v-col>
          <v-col cols="6">
            <v-card class="metric-card" variant="outlined" elevation="0">
              <v-card-text>
                <div class="metric-value">{{ numberValue("winCount") }}</div>
                <div class="metric-label">转盘中奖次数</div>
                <div class="metric-detail">幸运也被认真收藏</div>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>

        <v-card class="mt-3" variant="outlined" elevation="0">
          <v-card-item>
            <v-card-title class="section-title">未完成分布</v-card-title>
            <template #append>
              <v-btn-toggle
                v-model="distributionMode"
                mandatory
                divided
                density="compact"
                variant="outlined"
                color="primary"
                aria-label="切换未完成分布方式"
              >
                <v-btn value="subject" size="small">按科目</v-btn>
                <v-btn value="week" size="small">按周</v-btn>
              </v-btn-toggle>
            </template>
          </v-card-item>

          <v-fade-transition mode="out-in">
            <v-list
              v-if="distributionMode === 'subject'"
              key="subject-distribution"
              bg-color="transparent"
              density="compact"
              lines="one"
            >
              <v-list-item v-for="subject in subjectRows" :key="subject.label">
                <v-list-item-title>{{ subject.label }}</v-list-item-title>
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

            <div v-else key="week-distribution">
              <v-list
                v-if="weekRows.length"
                bg-color="transparent"
                density="compact"
                lines="one"
              >
                <v-list-item v-for="week in weekRows" :key="week.id">
                  <v-list-item-title>{{ week.label }}</v-list-item-title>
                  <v-list-item-subtitle>
                    完成 {{ Number(week.completedCount ?? 0) }} 项 · 中奖
                    {{ Number(week.winCount ?? 0) }} 次
                  </v-list-item-subtitle>
                  <v-progress-linear
                    class="mt-1"
                    :model-value="
                      maxWeekIncomplete
                        ? (Number(week.incompleteCount ?? 0) / maxWeekIncomplete) * 100
                        : 0
                    "
                    :color="week.incompleteCount ? 'error' : 'outline-variant'"
                    bg-color="surface-variant"
                    height="3"
                    rounded
                  />
                  <template #append>
                    <v-chip size="x-small" variant="outlined">
                      {{ Number(week.incompleteCount ?? 0) }} 项
                    </v-chip>
                  </template>
                </v-list-item>
              </v-list>
              <v-empty-state
                v-else
                icon="mdi-chart-timeline-variant"
                title="暂无周统计"
                text="每个周日会在这里留下本周的完成轨迹。"
              />
              <v-alert
                class="ma-3 mt-0"
                variant="tonal"
                color="primary"
                density="compact"
                icon="mdi-calendar-search"
              >
                未完成最多：{{ busiestWeekLabel }}<template v-if="maxWeekIncomplete">
                  · {{ maxWeekIncomplete }} 项
                </template>
              </v-alert>
            </div>
          </v-fade-transition>
        </v-card>

        <v-card class="mt-3" variant="outlined" elevation="0">
          <v-card-item>
            <v-card-title class="section-title">欧皇指数</v-card-title>
            <template #append>
              <v-chip color="tertiary" variant="outlined">
                {{ numberValue("luckIndex") }} / 100
              </v-chip>
            </template>
          </v-card-item>
          <v-card-text class="pt-1">
            <v-progress-linear
              :model-value="luckProgress"
              color="tertiary"
              bg-color="surface-variant"
              height="7"
              rounded
            />
            <p class="index-note mb-0 mt-3">
              指数综合中奖频率、稀有奖项权重与试卷加抽表现；越接近 100，越有“心愿被风听见”的好运。
            </p>
          </v-card-text>
        </v-card>

        <v-card class="mt-3" variant="outlined" elevation="0">
          <v-card-item>
            <v-card-title class="section-title">奖品分布</v-card-title>
            <v-card-subtitle>累计中奖 {{ numberValue("winCount") }} 次</v-card-subtitle>
          </v-card-item>
          <v-list
            v-if="prizeRows.length"
            bg-color="transparent"
            density="compact"
          >
            <v-list-item v-for="prize in prizeRows" :key="prize.label">
              <template #prepend>
                <v-icon icon="mdi-ticket-confirmation-outline" size="19" />
              </template>
              <v-list-item-title>{{ prize.label }}</v-list-item-title>
              <template #append>
                <v-chip size="x-small" variant="outlined">
                  {{ Number(prize.count ?? 0) }} 次
                </v-chip>
              </template>
            </v-list-item>
          </v-list>
          <v-empty-state
            v-else
            icon="mdi-clover-outline"
            title="幸运尚在路上"
            text="转盘结果会按奖项汇总在这里。"
          />
        </v-card>
      </div>
    </v-fade-transition>
  </section>
</template>

<style scoped>
.total-stats-view {
  width: 100%;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  padding: 12px 14px 32px;
}

.view-title,
.section-title,
.metric-value,
.completion-number {
  font-family: "Noto Serif SC", "Songti SC", STSong, serif;
}

.view-title,
.section-title {
  letter-spacing: 0.08em;
}

.summary-card,
.metric-card {
  background-color: rgba(var(--v-theme-surface), 0.58);
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
  font-size: clamp(1.45rem, 7vw, 1.95rem);
  line-height: 1.1;
}

.metric-label {
  margin-top: 6px;
  font-size: 0.72rem;
  letter-spacing: 0.07em;
}

.metric-detail,
.index-note {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.68rem;
  line-height: 1.6;
}

.metric-detail {
  margin-top: 5px;
}

@media (max-width: 360px) {
  .total-stats-view {
    padding-inline: 10px;
  }

  .section-title {
    font-size: 0.95rem;
  }
}
</style>
