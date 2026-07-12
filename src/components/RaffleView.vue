<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  dailyAvailable: {
    type: Boolean,
    default: false,
  },
  campaignPhase: {
    type: String,
    default: "active",
    validator: (value) => ["before", "active", "after"].includes(value),
  },
  paperAvailable: {
    type: Boolean,
    default: false,
  },
  paperClaimsUsed: {
    type: Number,
    default: 0,
  },
  drawsToday: {
    type: Array,
    default: () => [],
  },
  lastResult: {
    type: Object,
    default: null,
  },
  spinning: {
    type: Boolean,
    default: false,
  },
  probabilitySummary: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(["draw", "claim-paper", "back"]);

const paperDialog = ref(false);

const paperClaimsLeft = computed(() => Math.max(0, 3 - props.paperClaimsUsed));
const campaignLocked = computed(() => props.campaignPhase !== "active");
const dailyStatusLabel = computed(() => {
  if (props.campaignPhase === "before") return "07.13 开放";
  if (props.campaignPhase === "after") return "假期已结束";
  return props.dailyAvailable ? "机会可用" : "今日已抽";
});
const dailyActionLabel = computed(() => {
  if (props.campaignPhase === "before") return "7 月 13 日开启";
  if (props.campaignPhase === "after") return "本次假期已收官";
  return props.dailyAvailable ? "抽取今日签" : "每日机会已使用";
});

const resultTitle = computed(() => {
  if (!props.lastResult) return "";
  return (
    props.lastResult.label ||
    props.lastResult.title ||
    props.lastResult.name ||
    props.lastResult.result ||
    "本次抽签已记录"
  );
});

const resultDetail = computed(() => {
  if (!props.lastResult) return "";
  return props.lastResult.description || props.lastResult.message || "结果已保存至本地";
});

const resultIcon = computed(() => {
  if (!props.lastResult) return "mdi-ticket-outline";
  const type = String(props.lastResult.type || props.lastResult.kind || "").toLowerCase();
  const missed = props.lastResult.won === false || ["none", "miss", "empty"].includes(type);
  return missed ? "mdi-weather-windy" : "mdi-star-four-points-outline";
});

const normalizedDraws = computed(() =>
  props.drawsToday.map((draw, index) => {
    if (typeof draw === "string") {
      return { id: `${index}-${draw}`, label: draw, detail: "今日记录" };
    }

    return {
      id: draw.id || `${index}-${draw.label || draw.title || "draw"}`,
      label: draw.label || draw.title || draw.name || draw.result || "抽签结果",
      detail:
        draw.sourceLabel ||
        draw.detail ||
        (draw.source === "paper" || draw.type === "paper" ? "试卷额外机会" : "每日机会"),
    };
  }),
);

function confirmPaperClaim() {
  paperDialog.value = false;
  emit("claim-paper");
}
</script>

<template>
  <VSheet class="raffle-view" color="transparent">
    <VToolbar class="raffle-toolbar" color="transparent" density="compact">
      <VBtn
        aria-label="返回上一页"
        icon="mdi-arrow-left"
        min-width="44"
        variant="text"
        @click="emit('back')"
      />
      <VToolbarTitle class="raffle-title">摸鱼大转盘</VToolbarTitle>
      <VBtn aria-label="抽奖规则" icon="mdi-information-outline" min-width="44" variant="text" />
    </VToolbar>

    <main class="raffle-content">
      <section aria-labelledby="raffle-stage-heading">
        <VCard class="raffle-stage" variant="outlined">
          <VCardItem class="pb-0">
            <template #prepend>
              <VIcon color="primary" icon="mdi-clover-outline" size="22" />
            </template>
            <VCardTitle id="raffle-stage-heading" class="stage-title">今日手气</VCardTitle>
            <template #append>
              <VChip
                :color="dailyAvailable ? 'primary' : undefined"
                :prepend-icon="dailyAvailable ? 'mdi-circle-medium' : 'mdi-check'"
                label
                size="small"
                variant="outlined"
              >
                {{ dailyStatusLabel }}
              </VChip>
            </template>
          </VCardItem>

          <VCardText class="stage-body">
            <VProgressCircular
              :indeterminate="spinning"
              :model-value="spinning ? undefined : 100"
              :rotate="-90"
              :size="148"
              :width="2"
              color="primary"
            >
              <VFadeTransition mode="out-in">
                <div :key="spinning ? 'spinning' : 'ready'" class="stage-center">
                  <VIcon
                    :icon="spinning ? 'mdi-shimmer' : 'mdi-dice-multiple-outline'"
                    size="34"
                  />
                  <span>{{ spinning ? "正在落签" : "轻触抽签" }}</span>
                  <small>{{ spinning ? "请稍候" : "让努力喘口气" }}</small>
                </div>
              </VFadeTransition>
            </VProgressCircular>

            <VBtn
              block
              class="primary-action"
              color="primary"
              :disabled="!dailyAvailable || spinning"
              :loading="spinning && dailyAvailable"
              prepend-icon="mdi-dice-5-outline"
              size="large"
              variant="flat"
              @click="emit('draw', 'daily')"
            >
              {{ dailyActionLabel }}
            </VBtn>

            <div class="refresh-note">
              <VIcon icon="mdi-clock-outline" size="16" />
              <span>每日一次 · 0 点刷新</span>
            </div>
          </VCardText>
        </VCard>
      </section>

      <VFadeTransition mode="out-in">
        <VCard
          v-if="lastResult"
          :key="resultTitle"
          aria-live="polite"
          class="result-card"
          color="surface-variant"
          variant="flat"
        >
          <VCardItem>
            <template #prepend>
              <VIcon color="secondary" :icon="resultIcon" size="26" />
            </template>
            <VCardTitle class="result-title">{{ resultTitle }}</VCardTitle>
            <VCardSubtitle>{{ resultDetail }}</VCardSubtitle>
          </VCardItem>
        </VCard>
      </VFadeTransition>

      <section aria-labelledby="paper-chance-heading">
        <VCard class="paper-card" variant="outlined">
          <VListItem class="paper-summary" lines="two">
            <template #prepend>
              <VIcon color="tertiary" icon="mdi-file-document-check-outline" size="26" />
            </template>
            <VListItemTitle id="paper-chance-heading">试卷额外机会</VListItemTitle>
            <VListItemSubtitle>单日一次性完成 · 全假期最多 3 次</VListItemSubtitle>
            <template #append>
              <VChip label size="small" variant="outlined">
                {{ paperClaimsUsed }} / 3
              </VChip>
            </template>
          </VListItem>

          <VDivider />

          <VCardActions class="paper-actions">
            <VBtn
              v-if="paperAvailable"
              block
              color="tertiary"
              :disabled="spinning"
              prepend-icon="mdi-ticket-confirmation-outline"
              size="large"
              variant="tonal"
              @click="emit('draw', 'paper')"
            >
              使用试卷额外机会
            </VBtn>
            <VBtn
              v-else
              block
              :disabled="campaignLocked || paperClaimsLeft === 0 || spinning"
              prepend-icon="mdi-plus-circle-outline"
              size="large"
              variant="text"
              @click="paperDialog = true"
            >
              {{
                campaignLocked
                  ? campaignPhase === "before"
                    ? "7 月 13 日开放登记"
                    : "本次假期已收官"
                  : paperClaimsLeft > 0
                    ? "登记完成一张试卷"
                    : "假期额外机会已用完"
              }}
            </VBtn>
          </VCardActions>
        </VCard>
      </section>

      <section v-if="normalizedDraws.length" aria-labelledby="today-draws-heading">
        <div class="section-heading">
          <VIcon icon="mdi-history" size="20" />
          <h2 id="today-draws-heading">今日抽签</h2>
        </div>
        <VCard variant="outlined">
          <VList bg-color="transparent" density="comfortable" lines="two">
            <template v-for="(draw, index) in normalizedDraws" :key="draw.id">
              <VListItem :subtitle="draw.detail" :title="draw.label">
                <template #prepend>
                  <VAvatar color="surface-variant" size="32">
                    <VIcon icon="mdi-ticket-outline" size="18" />
                  </VAvatar>
                </template>
              </VListItem>
              <VDivider v-if="index < normalizedDraws.length - 1" inset />
            </template>
          </VList>
        </VCard>
      </section>

      <section aria-label="抽奖概率">
        <VExpansionPanels class="probability-panels" variant="accordion">
          <VExpansionPanel elevation="0">
            <VExpansionPanelTitle>
              <div class="probability-title">
                <VIcon icon="mdi-chart-donut" size="20" />
                <span>查看概率与奖项</span>
              </div>
            </VExpansionPanelTitle>
            <VExpansionPanelText>
              <VList bg-color="transparent" density="compact">
                <VListItem
                  v-for="entry in probabilitySummary"
                  :key="`${entry.label}-${entry.probability}`"
                  :title="entry.label"
                >
                  <template #append>
                    <VChip label size="small" variant="outlined">
                      {{ entry.probability }}
                    </VChip>
                  </template>
                </VListItem>
                <VListItem v-if="!probabilitySummary.length" subtitle="奖项概率将在数据载入后显示">
                  <template #prepend>
                    <VIcon icon="mdi-information-outline" size="20" />
                  </template>
                </VListItem>
              </VList>
              <p class="probability-note">未中概率为全部奖项概率扣除后的剩余概率。</p>
            </VExpansionPanelText>
          </VExpansionPanel>
        </VExpansionPanels>
      </section>
    </main>

    <VDialog v-model="paperDialog" max-width="340">
      <VCard class="confirm-card" variant="outlined">
        <VCardItem>
          <template #prepend>
            <VIcon color="tertiary" icon="mdi-file-check-outline" />
          </template>
          <VCardTitle>确认完成试卷</VCardTitle>
        </VCardItem>
        <VCardText>
          仅在今天一次性完成整张试卷时登记。确认后会获得一次额外抽签机会，整个假期最多登记 3 次。
        </VCardText>
        <VCardActions>
          <VSpacer />
          <VBtn min-height="44" variant="text" @click="paperDialog = false">再想想</VBtn>
          <VBtn color="primary" min-height="44" variant="flat" @click="confirmPaperClaim">
            确认登记
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>
  </VSheet>
</template>

<style scoped>
.raffle-view {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  color: rgb(var(--v-theme-on-surface));
  background-color: rgb(var(--v-theme-background));
  background-image: url("/assets/raffle-wash-bg.png");
  background-position: right center;
  background-repeat: no-repeat;
  background-size: auto 100%;
  overscroll-behavior-y: contain;
}

.raffle-toolbar {
  position: sticky;
  top: 0;
  z-index: 3;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
  background: rgba(var(--v-theme-background), 0.96) !important;
}

.raffle-title {
  font-family: "Noto Serif SC", "Songti SC", serif;
  font-size: 1rem;
  letter-spacing: 0.16em;
  text-align: center;
}

.raffle-content {
  display: grid;
  gap: 16px;
  width: 100%;
  max-width: 390px;
  margin-inline: auto;
  padding: 16px 16px calc(28px + env(safe-area-inset-bottom));
}

.raffle-stage,
.paper-card,
.probability-panels,
.confirm-card {
  border-color: rgb(var(--v-theme-outline-variant));
  box-shadow: none !important;
}

.stage-title,
.result-title {
  font-family: "Noto Serif SC", "Songti SC", serif;
  font-size: 1rem;
  letter-spacing: 0.08em;
}

.stage-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding-top: 18px;
}

.stage-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  color: rgb(var(--v-theme-primary));
  font-family: "Noto Serif SC", "Songti SC", serif;
  letter-spacing: 0.08em;
}

.stage-center small {
  color: rgb(var(--v-theme-on-surface));
  font-family: inherit;
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  opacity: 0.62;
}

.primary-action {
  min-height: 48px;
  letter-spacing: 0.08em;
}

.refresh-note {
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.75rem;
  opacity: 0.64;
}

.result-card {
  border: 1px solid rgb(var(--v-theme-outline-variant));
}

.paper-summary {
  min-height: 76px;
  padding-inline: 14px;
}

.paper-actions {
  min-height: 60px;
  padding: 8px 12px;
}

.paper-actions :deep(.v-btn) {
  min-height: 44px;
}

.section-heading,
.probability-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-heading {
  margin: 2px 4px 10px;
}

.section-heading h2 {
  margin: 0;
  font-family: "Noto Serif SC", "Songti SC", serif;
  font-size: 0.92rem;
  font-weight: 500;
  letter-spacing: 0.12em;
}

.probability-panels :deep(.v-expansion-panel) {
  border: 1px solid rgb(var(--v-theme-outline-variant));
  background: transparent;
  box-shadow: none;
}

.probability-panels :deep(.v-expansion-panel-title) {
  min-height: 52px;
}

.probability-note {
  margin: 8px 16px 4px;
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.75rem;
  line-height: 1.6;
  opacity: 0.64;
}

.confirm-card {
  background: rgb(var(--v-theme-surface));
}

@media (max-width: 359px) {
  .raffle-content {
    padding-inline: 12px;
  }

  .paper-summary {
    padding-inline: 10px;
  }
}

@media (min-width: 960px) {
  .raffle-view {
    background-position: center;
    background-size: cover;
  }
}
</style>
