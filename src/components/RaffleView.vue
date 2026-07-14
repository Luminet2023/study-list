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
  awardSlot6Confirmation: {
    type: Object,
    default: null,
  },
  redeemingDrawId: {
    type: String,
    default: null,
  },
});

const emit = defineEmits([
  "draw",
  "redeem",
  "claim-paper",
  "back",
  "rules",
  "resolve-award-slot6",
]);

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
      won: draw.won ?? draw.prizeId !== "none",
      canRedeem: Boolean(draw.canRedeem),
      redeemed: Boolean(draw.redeemed),
    };
  }),
);

const wheelEntries = computed(() => {
  const labels = props.probabilitySummary
    .map((entry) => String(entry?.label ?? "").trim())
    .filter(Boolean);
  const fallbacks = ["未中", "免任务", "免周六", "免全天", "免整周", "好运", "喘口气", "再接再厉"];
  return [...new Set([...labels, ...fallbacks])].slice(0, 8);
});

function shortWheelLabel(label) {
  return String(label)
    .replace("下一个工作日", "工作日")
    .replace("下一工作日", "工作日")
    .replace("下一周工作日", "整周")
    .slice(0, 7);
}

function wheelLabelStyle(index) {
  const angle = index * 45;
  return { transform: `rotate(${angle}deg) translateY(-88px) rotate(${-angle}deg)` };
}

const awardSlot6Dates = computed(() =>
  Array.isArray(props.awardSlot6Confirmation?.dates)
    ? props.awardSlot6Confirmation.dates
    : [],
);

function resolveAwardSlot6(keepBlank) {
  emit("resolve-award-slot6", {
    keepBlank,
    dates: awardSlot6Dates.value,
    prizeId: props.awardSlot6Confirmation?.prizeId ?? null,
  });
}

function confirmPaperClaim() {
  paperDialog.value = false;
  emit("claim-paper");
}
</script>

<template>
  <VSheet class="raffle-view" color="transparent">
    <VToolbar class="raffle-toolbar" color="transparent" density="compact">
      <VToolbarTitle class="raffle-title">摸鱼大转盘</VToolbarTitle>
    </VToolbar>

    <main class="raffle-content">
      <div class="raffle-column raffle-column--primary">
      <section class="raffle-stage-section" aria-labelledby="raffle-stage-heading">
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
                <div
                  :key="spinning ? 'spinning' : 'ready'"
                  class="stage-center"
                  :class="{ 'stage-center--spinning': spinning }"
                >
                  <span class="fortune-token" aria-hidden="true">
                    <VIcon
                      class="fortune-token__icon"
                      :icon="spinning ? 'mdi-dice-multiple' : 'mdi-dice-multiple-outline'"
                      size="34"
                    />
                    <i v-if="spinning" class="fortune-token__slip fortune-token__slip--left" />
                    <i v-if="spinning" class="fortune-token__slip fortune-token__slip--right" />
                  </span>
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

      <section v-if="normalizedDraws.length" class="history-section" aria-labelledby="today-draws-heading">
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
                    <VIcon :icon="draw.won ? 'mdi-star-four-points-outline' : 'mdi-ticket-outline'" size="18" />
                  </VAvatar>
                </template>
                <template v-if="draw.canRedeem || draw.redeemed" #append>
                  <VBtn
                    v-if="draw.canRedeem"
                    :aria-label="`兑现奖励：${draw.label}`"
                    color="primary"
                    :loading="redeemingDrawId === draw.id"
                    min-height="36"
                    prepend-icon="mdi-gift-open-outline"
                    size="small"
                    variant="tonal"
                    @click.stop="emit('redeem', draw.id)"
                  >
                    兑现
                  </VBtn>
                  <VChip
                    v-else
                    color="secondary"
                    prepend-icon="mdi-check-decagram-outline"
                    size="small"
                    variant="tonal"
                  >
                    已兑现
                  </VChip>
                </template>
              </VListItem>
              <VDivider v-if="index < normalizedDraws.length - 1" inset />
            </template>
          </VList>
        </VCard>
      </section>
      </div>

      <div class="raffle-column raffle-column--secondary">

      <VFadeTransition mode="out-in">
        <VCard
          v-if="lastResult"
          :key="resultTitle"
          aria-live="polite"
          class="result-card"
          variant="outlined"
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

      <section class="paper-section" aria-labelledby="paper-chance-heading">
        <VCard class="paper-card" variant="outlined">
          <VListItem class="paper-summary" lines="two">
            <template #prepend>
              <VIcon color="tertiary" icon="mdi-file-document-check-outline" size="26" />
            </template>
            <VListItemTitle id="paper-chance-heading">试卷额外机会</VListItemTitle>
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
      </div>
    </main>

    <VDialog
      :model-value="spinning"
      max-width="390"
      persistent
      scrim="background"
      transition="fade-transition"
    >
      <VCard class="draw-wheel-dialog-card" variant="outlined" aria-live="polite">
        <VCardItem class="pb-0">
          <template #prepend>
            <VAvatar color="secondary" size="38" variant="tonal">
              <VIcon icon="mdi-dice-multiple-outline" size="22" />
            </VAvatar>
          </template>
          <VCardTitle class="draw-dialog-title">正在抽取今日签</VCardTitle>
          <VCardSubtitle>轮盘转动中，请稍候片刻</VCardSubtitle>
        </VCardItem>

        <VCardText class="draw-dialog-body">
          <div class="draw-wheel-shell" role="img" aria-label="抽奖轮盘正在旋转">
            <span class="draw-wheel-pointer" aria-hidden="true" />
            <div class="draw-wheel draw-wheel--spinning" aria-hidden="true">
              <span
                v-for="(label, index) in wheelEntries"
                :key="`${label}-${index}`"
                class="draw-wheel-label"
                :style="wheelLabelStyle(index)"
              >
                {{ shortWheelLabel(label) }}
              </span>
            </div>
            <div class="draw-wheel-hub" aria-hidden="true">
              <VIcon icon="mdi-clover-outline" size="26" />
            </div>
          </div>

          <VProgressLinear
            class="draw-progress"
            color="primary"
            height="4"
            indeterminate
            rounded
          />
          <p class="draw-dialog-note">分区用于展示抽取过程，实际结果仍按今日动态概率池计算。</p>
        </VCardText>
      </VCard>
    </VDialog>

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

    <VDialog :model-value="Boolean(awardSlot6Confirmation)" max-width="380" persistent>
      <VCard class="confirm-card" variant="outlined">
        <VCardItem prepend-icon="mdi-calendar-check-outline">
          <VCardTitle>确认第 6 项安排</VCardTitle>
          <VCardSubtitle>全天免项已生效，概率不会改变</VCardSubtitle>
        </VCardItem>
        <VCardText>
          {{ awardSlot6Dates.join("、") }} 的第 6 项仍为空。保持留白时不计入计划；选择填写时，可返回对应日期补充，且仍会继承本次免项。
        </VCardText>
        <VCardActions class="flex-column align-stretch ga-2 px-4 pb-4">
          <VBtn min-height="44" variant="text" @click="resolveAwardSlot6(false)">返回填写第 6 项</VBtn>
          <VBtn color="primary" min-height="44" variant="flat" @click="resolveAwardSlot6(true)">确认保持留白</VBtn>
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

:global(.v-theme--poeticNight) .raffle-view {
  background-image: url("/assets/raffle-wash-bg-dark.png");
}

.raffle-toolbar {
  position: sticky;
  top: 0;
  z-index: 3;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
  background: rgba(var(--v-theme-background), 0.96) !important;
}

.raffle-title {
  font-family: var(--app-font-family);
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

.raffle-column {
  display: contents;
}

.raffle-stage-section {
  order: 1;
}

.result-card {
  order: 2;
}

.paper-section {
  order: 3;
}

.history-section {
  order: 4;
}

.probability-section {
  order: 5;
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
  font-family: var(--app-font-family);
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
  font-family: var(--app-font-family);
  letter-spacing: 0.08em;
}

.stage-center small {
  color: rgb(var(--v-theme-on-surface));
  font-family: inherit;
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  opacity: 0.62;
}

.fortune-token {
  display: grid;
  place-items: center;
  width: 54px;
  height: 50px;
  position: relative;
  transform-origin: 50% 72%;
}

.fortune-token__icon {
  position: relative;
  z-index: 2;
}

.fortune-token__slip {
  width: 3px;
  height: 24px;
  border-radius: 2px;
  position: absolute;
  top: -5px;
  background: rgb(var(--v-theme-secondary));
  opacity: 0.72;
  transform-origin: bottom center;
}

.fortune-token__slip--left { transform: translateX(-10px) rotate(-18deg); }
.fortune-token__slip--right { transform: translateX(10px) rotate(18deg); }

.stage-center--spinning .fortune-token {
  animation: fortune-cup-shake 520ms cubic-bezier(.36, .07, .19, .97) infinite;
}

.stage-center--spinning .fortune-token__icon {
  animation: fortune-dice-tumble 780ms cubic-bezier(.5, .08, .35, .95) infinite;
}

.stage-center--spinning .fortune-token__slip {
  animation: fortune-slip-rise 620ms ease-in-out infinite alternate;
}

@keyframes fortune-cup-shake {
  0%, 100% { transform: translate3d(0, 0, 0) rotate(-5deg); }
  35% { transform: translate3d(-5px, -3px, 0) rotate(7deg); }
  70% { transform: translate3d(5px, -1px, 0) rotate(-7deg); }
}

@keyframes fortune-dice-tumble {
  0% { transform: rotate(0deg) scale(.92); }
  50% { transform: rotate(190deg) scale(1.08); }
  100% { transform: rotate(360deg) scale(.92); }
}

@keyframes fortune-slip-rise {
  from { margin-top: 5px; opacity: .42; }
  to { margin-top: -5px; opacity: .9; }
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
  font-family: var(--app-font-family);
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
  color: rgb(var(--v-theme-on-surface));
  background-color: rgb(var(--v-theme-surface));
}

.confirm-card :deep(.v-card-title) {
  color: rgb(var(--v-theme-on-surface));
}

.confirm-card :deep(.v-card-text) {
  color: rgba(var(--v-theme-on-surface), 0.82);
}

.draw-wheel-dialog-card {
  color: rgb(var(--v-theme-on-surface));
  border-color: rgba(var(--v-theme-outline), 0.42);
  background-color: rgb(var(--v-theme-surface));
  box-shadow: none !important;
}

.draw-dialog-title {
  color: rgb(var(--v-theme-on-surface));
  font-family: var(--app-font-family);
  letter-spacing: 0.08em;
}

.draw-dialog-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 18px;
}

.draw-wheel-shell {
  position: relative;
  display: grid;
  place-items: center;
  width: 246px;
  height: 246px;
}

.draw-wheel {
  position: relative;
  width: 222px;
  height: 222px;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-outline), 0.72);
  border-radius: 50%;
  background:
    repeating-conic-gradient(
      from -22.5deg,
      rgba(var(--v-theme-outline), 0.5) 0 1deg,
      transparent 1deg 45deg
    ),
    conic-gradient(
      from -22.5deg,
      rgba(var(--v-theme-primary), 0.2) 0 45deg,
      rgba(var(--v-theme-secondary), 0.16) 45deg 90deg,
      rgba(var(--v-theme-tertiary), 0.18) 90deg 135deg,
      rgba(var(--v-theme-primary), 0.1) 135deg 180deg,
      rgba(var(--v-theme-secondary), 0.2) 180deg 225deg,
      rgba(var(--v-theme-tertiary), 0.12) 225deg 270deg,
      rgba(var(--v-theme-primary), 0.18) 270deg 315deg,
      rgba(var(--v-theme-secondary), 0.12) 315deg 360deg
    );
  box-shadow: inset 0 0 0 6px rgba(var(--v-theme-surface), 0.76);
}

.draw-wheel--spinning {
  animation: draw-wheel-spin 560ms linear infinite;
}

.draw-wheel-label {
  position: absolute;
  left: calc(50% - 34px);
  top: calc(50% - 9px);
  width: 68px;
  color: rgb(var(--v-theme-on-surface));
  font-family: var(--app-font-family);
  font-size: 0.68rem;
  line-height: 18px;
  text-align: center;
  white-space: nowrap;
}

.draw-wheel-hub {
  position: absolute;
  display: grid;
  place-items: center;
  width: 62px;
  height: 62px;
  border: 1px solid rgba(var(--v-theme-outline), 0.58);
  border-radius: 50%;
  color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 0 0 5px rgba(var(--v-theme-surface), 0.64);
}

.draw-wheel-pointer {
  position: absolute;
  top: 1px;
  z-index: 2;
  width: 0;
  height: 0;
  border-right: 11px solid transparent;
  border-left: 11px solid transparent;
  border-top: 25px solid rgb(var(--v-theme-secondary));
  filter: drop-shadow(0 2px 1px rgba(var(--v-theme-on-surface), 0.18));
  animation: draw-pointer-tick 280ms ease-in-out infinite alternate;
}

.draw-progress {
  width: min(100%, 270px);
  margin-top: 10px;
}

.draw-dialog-note {
  max-width: 300px;
  margin: 12px auto 0;
  color: rgba(var(--v-theme-on-surface), 0.64);
  font-size: 0.72rem;
  line-height: 1.65;
  text-align: center;
}

@keyframes draw-wheel-spin {
  to { transform: rotate(360deg); }
}

@keyframes draw-pointer-tick {
  from { transform: rotate(-4deg); }
  to { transform: rotate(4deg); }
}

@media (max-width: 359px) {
  .raffle-content {
    padding-inline: 12px;
  }

  .paper-summary {
    padding-inline: 10px;
  }

  .draw-wheel-shell {
    width: 222px;
    height: 222px;
  }

  .draw-wheel {
    width: 202px;
    height: 202px;
  }

  .draw-wheel-label {
    transform-origin: 34px 9px;
  }
}

@media (min-width: 960px) {
  .raffle-view {
    background-position: center;
    background-size: cover;
  }

  .raffle-content {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: start;
    gap: 14px;
    max-width: 960px;
    padding: 20px 32px 32px;
  }

  .raffle-column {
    display: grid;
    align-content: start;
    gap: 14px;
    min-width: 0;
  }

  .raffle-stage {
    min-height: 0;
  }

  .stage-body {
    gap: 10px;
    padding: 12px 16px 14px;
  }

  .paper-summary {
    min-height: 64px;
  }

  .paper-actions {
    min-height: 52px;
    padding-block: 4px;
  }

  .section-heading {
    margin-bottom: 7px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .stage-center--spinning .fortune-token,
  .stage-center--spinning .fortune-token__icon,
  .stage-center--spinning .fortune-token__slip {
    animation: none;
  }

  .draw-wheel--spinning,
  .draw-wheel-pointer {
    animation: none;
  }
}
</style>
