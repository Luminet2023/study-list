<script setup>
import { computed, nextTick, onMounted, ref } from "vue";

const props = defineProps({
  stats: {
    type: Object,
    default: () => ({
      completedCount: 0,
      planCount: 0,
      incompleteCount: 0,
      diaryChars: 0,
      renderedPlanChars: 0,
      attendanceWeeks: 0,
      winCount: 0,
      campaignDays: 48,
    }),
  },
});

const emit = defineEmits(["back"]);
const burstKey = ref(1);
const numberValue = (key) => Number(props.stats?.[key] ?? 0);
const completionRate = computed(() => {
  const total = numberValue("planCount");
  return total ? Math.round((numberValue("completedCount") / total) * 100) : 0;
});
const fireworkPoints = [
  { x: 12, y: 18, delay: 0, hue: 350, scale: 1.08 },
  { x: 86, y: 17, delay: 180, hue: 42, scale: 1.22 },
  { x: 25, y: 48, delay: 380, hue: 198, scale: 1.14 },
  { x: 76, y: 44, delay: 560, hue: 318, scale: 1.18 },
  { x: 49, y: 25, delay: 760, hue: 22, scale: 1.28 },
  { x: 10, y: 72, delay: 940, hue: 162, scale: 1.08 },
  { x: 91, y: 70, delay: 1120, hue: 282, scale: 1.12 },
  { x: 52, y: 66, delay: 1320, hue: 54, scale: 1.24 },
];

async function launchFireworks() {
  burstKey.value = 0;
  await nextTick();
  burstKey.value = Date.now();
}

onMounted(launchFireworks);
</script>

<template>
  <section class="campaign-ending-view paper-scroll" aria-labelledby="ending-title">
    <div :key="burstKey" class="fireworks" aria-hidden="true">
      <span
        v-for="(point, index) in fireworkPoints"
        :key="index"
        class="firework"
        :style="{
          '--firework-x': `${point.x}%`,
          '--firework-y': `${point.y}%`,
          '--firework-delay': `${point.delay}ms`,
          '--firework-hue': point.hue,
          '--firework-scale': point.scale,
        }"
      />
    </div>

    <v-toolbar class="ending-toolbar" color="transparent" density="compact">
      <v-btn icon="mdi-arrow-left" variant="text" aria-label="返回最后一天" @click="emit('back')" />
      <v-toolbar-title class="ending-toolbar-title">旅程终章</v-toolbar-title>
      <v-btn class="ending-firework-button" icon="mdi-firework" variant="text" aria-label="再放一次烟花" @click="launchFireworks" />
    </v-toolbar>

    <v-fade-transition appear>
      <main class="ending-content">
        <div class="ending-seal" aria-hidden="true">成</div>
        <p class="ending-kicker">2026.07.13 — 08.29</p>
        <h1 id="ending-title">你把这段夏日，写成了光</h1>
        <p class="ending-lead">
          你完成了 <strong>{{ numberValue("completedCount") }}</strong> 项计划，
          写下了 <strong>{{ numberValue("diaryChars") }}</strong> 字日结。
          恭喜你走过这 {{ numberValue("campaignDays") }} 天——认真本身，就是最盛大的抵达。
        </p>

        <v-card class="ending-card" variant="outlined">
          <v-card-text>
            <div class="ending-progress-copy">
              <span>全程完成率</span>
              <strong>{{ completionRate }}%</strong>
            </div>
            <v-progress-linear
              :model-value="completionRate"
              color="primary"
              bg-color="surface-variant"
              height="6"
              rounded
            />
            <v-row density="comfortable" class="mt-4">
              <v-col cols="6" sm="3">
                <div class="ending-metric"><strong>{{ numberValue("planCount") }}</strong><span>计划总项</span></div>
              </v-col>
              <v-col cols="6" sm="3">
                <div class="ending-metric"><strong>{{ numberValue("renderedPlanChars") }}</strong><span>计划字数</span></div>
              </v-col>
              <v-col cols="6" sm="3">
                <div class="ending-metric"><strong>{{ numberValue("attendanceWeeks") }}</strong><span>满勤周数</span></div>
              </v-col>
              <v-col cols="6" sm="3">
                <div class="ending-metric"><strong>{{ numberValue("winCount") }}</strong><span>中奖次数</span></div>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>

        <v-alert
          v-if="numberValue('incompleteCount')"
          class="ending-note"
          icon="mdi-heart-outline"
          type="info"
          variant="text"
        >
          还有 {{ numberValue("incompleteCount") }} 项没有完成，但它们不是败笔——那是你认真生活过的真实纹理。
        </v-alert>
        <p v-else class="ending-note ending-note--perfect">
          一页不缺，一步不落。愿这份笃定，在往后的日子里仍与你并肩。
        </p>

        <div class="ending-actions">
          <v-btn prepend-icon="mdi-firework" color="secondary" min-height="48" variant="tonal" @click="launchFireworks">
            再放一次烟花
          </v-btn>
          <v-btn prepend-icon="mdi-book-open-page-variant-outline" color="primary" min-height="48" variant="flat" @click="emit('back')">
            回看最后一天
          </v-btn>
        </div>
      </main>
    </v-fade-transition>
  </section>
</template>

<style scoped>
.campaign-ending-view {
  position: relative;
  height: 100%;
  overflow-x: hidden;
  padding: 0 max(16px, env(safe-area-inset-left)) calc(28px + env(safe-area-inset-bottom));
}

.ending-toolbar {
  position: sticky;
  top: 0;
  z-index: 5;
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.18);
  background: rgba(var(--v-theme-background), 0.86) !important;
  backdrop-filter: blur(10px);
}

.ending-toolbar-title,
.ending-content h1,
.ending-lead { font-family: var(--app-font-family); }

.ending-content {
  position: relative;
  z-index: 2;
  width: min(100%, 760px);
  margin: 0 auto;
  padding: clamp(34px, 8vh, 74px) 0 32px;
  text-align: center;
}

.ending-seal {
  display: grid;
  place-items: center;
  width: 58px;
  height: 58px;
  margin: 0 auto 18px;
  border: 1px solid rgb(var(--v-theme-secondary));
  color: rgb(var(--v-theme-secondary));
  font-family: var(--app-font-family);
  font-size: 1.8rem;
  transform: rotate(-4deg);
}

.ending-kicker { margin: 0; opacity: 0.58; font-size: 0.76rem; letter-spacing: 0.22em; }

.ending-content h1 {
  margin: 12px 0 20px;
  font-size: clamp(2rem, 7vw, 3.4rem);
  font-weight: 300;
  letter-spacing: 0.12em;
}

.ending-lead {
  max-width: 660px;
  margin: 0 auto 28px;
  font-size: clamp(1.05rem, 3vw, 1.35rem);
  line-height: 2;
  letter-spacing: 0.06em;
}

.ending-lead strong { color: rgb(var(--v-theme-primary)); font-size: 1.2em; font-weight: 500; }
.ending-card { border-color: rgba(var(--v-theme-outline), 0.3); text-align: left; box-shadow: none !important; }
.ending-progress-copy { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
.ending-progress-copy strong { font-size: 1.65rem; font-weight: 400; }

.ending-metric { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 10px 4px; }
.ending-metric strong { font-size: 1.45rem; font-weight: 500; }
.ending-metric span { opacity: 0.62; font-size: 0.75rem; }
.ending-note { margin: 18px auto 0; }
.ending-note--perfect { font-family: var(--app-font-family); line-height: 1.8; }
.ending-actions { display: flex; justify-content: center; gap: 10px; margin-top: 24px; }

.fireworks {
  position: absolute;
  inset: 0;
  z-index: 4;
  overflow: hidden;
  pointer-events: none;
  mix-blend-mode: multiply;
}

:global(.v-theme--poeticNight) .fireworks {
  mix-blend-mode: screen;
}

.firework {
  --spark: hsl(var(--firework-hue) 88% 52%);
  position: absolute;
  left: var(--firework-x);
  top: var(--firework-y);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  color: var(--spark);
  opacity: 0;
  box-shadow:
    0 -110px 0 1px currentColor,
    78px -78px 0 0 currentColor,
    110px 0 0 1px currentColor,
    78px 78px 0 0 currentColor,
    0 110px 0 1px currentColor,
    -78px 78px 0 0 currentColor,
    -110px 0 0 1px currentColor,
    -78px -78px 0 0 currentColor;
  filter: drop-shadow(0 0 6px currentColor);
  animation: firework-burst 2.15s cubic-bezier(.16, .72, .18, 1) var(--firework-delay) both;
}

.firework::before,
.firework::after {
  content: "";
  position: absolute;
  border-radius: 50%;
}

.firework::before {
  inset: 1px;
  color: hsl(calc(var(--firework-hue) + 42) 92% 48%);
  box-shadow:
    0 -78px 0 0 currentColor,
    55px -55px 0 -1px currentColor,
    78px 0 0 0 currentColor,
    55px 55px 0 -1px currentColor,
    0 78px 0 0 currentColor,
    -55px 55px 0 -1px currentColor,
    -78px 0 0 0 currentColor,
    -55px -55px 0 -1px currentColor;
  transform: rotate(22.5deg);
}

.firework::after {
  inset: -11px;
  background: radial-gradient(circle, #fff 0 12%, currentColor 32%, transparent 72%);
  box-shadow: 0 0 34px 16px currentColor;
  opacity: 0.68;
}

@keyframes firework-burst {
  0%, 8% {
    opacity: 0;
    transform: scale(.04) translateY(80px);
  }
  18% { opacity: 1; }
  58% {
    opacity: .96;
    transform: scale(var(--firework-scale)) translateY(0);
  }
  100% {
    opacity: 0;
    transform: scale(1.45) translateY(20px);
  }
}

@media (max-width: 520px) {
  .ending-content { padding-top: 28px; }
  .ending-actions { flex-direction: column; }
}

@media (prefers-reduced-motion: reduce) {
  .firework {
    animation: none;
    opacity: 0.58;
    transform: scale(.82);
  }
}
</style>
