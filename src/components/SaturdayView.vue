<script setup>
import { nextTick, ref } from "vue";

const props = defineProps({
  items: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(["update-item", "cycle", "remove", "add", "add-many"]);
const draft = ref("");
const draftField = ref(null);

function statusIcon(item) {
  if (item.isExempt) return "mdi-gift-outline";
  if (item.status === "completed") return "mdi-check";
  if (item.status === "missed") return "mdi-alert-outline";
  return "mdi-circle-outline";
}

function commitDraft() {
  const value = draft.value.trim();
  if (!value) return;
  emit("add", value);
  draft.value = "";
  nextTick(() => draftField.value?.focus?.());
}

function onPaste(event) {
  const text = event.clipboardData?.getData("text") ?? "";
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1) return;
  event.preventDefault();
  emit("add-many", lines);
  draft.value = "";
}
</script>

<template>
  <section class="saturday-view px-5 pb-8" aria-labelledby="saturday-title">
    <h2 id="saturday-title" class="saturday-title">今日总目标</h2>

    <v-fade-transition group>
      <div
        v-for="(item, index) in items"
        :key="item.id"
        class="saturday-row"
        :class="{
          'saturday-row--completed': item.status === 'completed' && !item.isExempt,
          'saturday-row--missed': item.status === 'missed' && !item.isExempt,
          'saturday-row--exempt': item.isExempt,
        }"
      >
        <v-btn
          class="saturday-status"
          :icon="statusIcon(item)"
          :color="item.status === 'missed' ? 'warning' : item.isExempt ? 'secondary' : 'primary'"
          variant="text"
          :size="66"
          rounded="circle"
          :aria-label="`切换第 ${index + 1} 项状态`"
          @click="emit('cycle', item.id)"
        />
        <span class="saturday-index">{{ index + 1 }}.</span>
        <v-text-field
          class="saturday-input"
          :model-value="item.text"
          variant="underlined"
          density="comfortable"
          :aria-label="`第 ${index + 1} 项总目标`"
          @update:model-value="emit('update-item', { id: item.id, value: $event })"
          @keydown.enter.prevent="draftField?.focus?.()"
          @keydown.backspace="!item.text && emit('remove', item.id)"
        />
        <v-btn
          icon="mdi-close"
          variant="text"
          size="44"
          :aria-label="`删除第 ${index + 1} 项`"
          @click="emit('remove', item.id)"
        />
      </div>
    </v-fade-transition>

    <div class="saturday-row saturday-row--draft">
      <v-icon class="saturday-status-placeholder" icon="mdi-circle-outline" :size="40.5" />
      <span class="saturday-index">{{ items.length + 1 }}.</span>
      <v-text-field
        ref="draftField"
        v-model="draft"
        class="saturday-input"
        variant="underlined"
        density="comfortable"
        placeholder="写下这一项，回车继续"
        :aria-label="`第 ${items.length + 1} 项总目标`"
        @keydown.enter.prevent="commitDraft"
        @paste="onPaste"
        @blur="commitDraft"
      />
      <v-btn
        icon="mdi-plus"
        variant="text"
        size="44"
        aria-label="添加目标"
        :disabled="!draft.trim()"
        @click="commitDraft"
      />
    </div>
  </section>
</template>

<style scoped>
.saturday-view {
  /*
   * 工作日实际基准：正文 1rem / 4.4vw / 1.12rem、状态按钮 44px、
   * compact 行高 56px（手机正文另为 .98rem）。
   * 周六的任务视觉统一乘以 1.5；集中为变量，避免各断点分别近似取值。
   */
  --saturday-task-scale: 1.5;
  --saturday-task-font-min: calc(1rem * var(--saturday-task-scale));
  --saturday-task-font-fluid: calc(4.4vw * var(--saturday-task-scale));
  --saturday-task-font-max: calc(1.12rem * var(--saturday-task-scale));
  --saturday-status-size: calc(44px * var(--saturday-task-scale));
  --saturday-status-icon-size: calc(27px * var(--saturday-task-scale));
  --saturday-row-min-height: calc(56px * var(--saturday-task-scale));
  --saturday-alert-inset-x: calc(8px * var(--saturday-task-scale));
  --saturday-alert-inset-y: calc(6px * var(--saturday-task-scale));

  font-size: clamp(
    var(--saturday-task-font-min),
    var(--saturday-task-font-fluid),
    var(--saturday-task-font-max)
  );
}

.saturday-title {
  color: rgb(var(--v-theme-on-background));
  font-family: var(--app-font-family);
  font-size: clamp(30px, 8vw, 36px);
  font-weight: 400;
  letter-spacing: 0.16em;
  margin: 12px 0 28px;
  text-align: center;
}

.saturday-row {
  align-items: center;
  display: grid;
  grid-template-columns: var(--saturday-status-size) 2.55rem minmax(0, 1fr) 44px;
  min-height: var(--saturday-row-min-height);
  padding: 0 2px;
  position: relative;
}

.saturday-row--missed::before {
  background-image: url("/assets/brush-alert.png");
  background-position: center;
  background-repeat: no-repeat;
  background-size:
    calc(100% - var(--saturday-alert-inset-x))
    calc(100% - var(--saturday-alert-inset-y));
  content: "";
  inset: 0;
  opacity: 0.58;
  pointer-events: none;
  position: absolute;
}

:global(.v-theme--poeticNight) .saturday-row--missed::before {
  background-image: url("/assets/brush-alert-dark.png");
}

.saturday-row--completed .saturday-input,
.saturday-row--completed .saturday-index {
  opacity: 0.42;
  text-decoration: line-through;
}

:global(.v-theme--poeticNight) .saturday-row--completed .saturday-input,
:global(.v-theme--poeticNight) .saturday-row--completed .saturday-index {
  opacity: 0.52;
}

.saturday-row--exempt .saturday-input,
.saturday-row--exempt .saturday-index {
  color: rgb(var(--v-theme-secondary));
  text-decoration: line-through;
}

.saturday-row--exempt {
  animation: exempt-glow 2.4s ease-in-out infinite alternate;
}

.saturday-row--draft {
  opacity: 0.78;
}

.saturday-status,
.saturday-input,
.saturday-index,
.saturday-status-placeholder {
  position: relative;
  z-index: 1;
}

.saturday-status {
  width: var(--saturday-status-size) !important;
  height: var(--saturday-status-size) !important;
  min-width: var(--saturday-status-size) !important;
}

.saturday-status :deep(.v-icon) {
  font-size: var(--saturday-status-icon-size) !important;
}

.saturday-status-placeholder {
  justify-self: center;
}

.saturday-index {
  font-family: var(--app-font-family);
  font-size: clamp(
    var(--saturday-task-font-min),
    var(--saturday-task-font-fluid),
    var(--saturday-task-font-max)
  );
  line-height: 1.65;
}

.saturday-input {
  min-width: 0;
}

.saturday-input :deep(.v-input__control),
.saturday-input :deep(.v-field) {
  min-width: 0;
}

.saturday-input :deep(.v-field) {
  --v-input-control-height: calc(44px * var(--saturday-task-scale));
}

.saturday-input :deep(input) {
  font-family: var(--app-font-family);
  font-size: clamp(
    var(--saturday-task-font-min),
    var(--saturday-task-font-fluid),
    var(--saturday-task-font-max)
  );
  line-height: 1.65;
  letter-spacing: 0.03em;
}

@keyframes exempt-glow {
  from { filter: saturate(0.9); }
  to { filter: saturate(1.35); }
}

@media (prefers-reduced-motion: reduce) {
  .saturday-row--exempt {
    animation: none;
  }
}

@media (max-width: 360px) {
  .saturday-view {
    --saturday-task-font-min: calc(0.98rem * var(--saturday-task-scale));
    --saturday-task-font-fluid: calc(0.98rem * var(--saturday-task-scale));
    --saturday-task-font-max: calc(0.98rem * var(--saturday-task-scale));

    padding-inline: 8px !important;
  }

  .saturday-row {
    grid-template-columns: var(--saturday-status-size) 1.8rem minmax(0, 1fr) 44px;
  }
}
</style>
