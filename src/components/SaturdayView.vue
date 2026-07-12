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
          size="56"
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
      <v-icon class="saturday-status-placeholder" icon="mdi-circle-outline" size="32" />
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
  font-size: 1.5rem;
}

.saturday-title {
  color: rgb(var(--v-theme-on-background));
  font-family: "LXGW WenKai", "STKaiti", "KaiTi", serif;
  font-size: clamp(30px, 8vw, 36px);
  font-weight: 400;
  letter-spacing: 0.16em;
  margin: 12px 0 28px;
  text-align: center;
}

.saturday-row {
  align-items: center;
  display: grid;
  grid-template-columns: 56px 34px minmax(0, 1fr) 44px;
  min-height: 92px;
  padding: 0 2px;
  position: relative;
}

.saturday-row--missed::before {
  background: url("/assets/brush-alert.png") center / 100% 80% no-repeat;
  content: "";
  inset: 4px 0;
  opacity: 0.58;
  pointer-events: none;
  position: absolute;
}

.saturday-row--completed .saturday-input,
.saturday-row--completed .saturday-index {
  opacity: 0.42;
  text-decoration: line-through;
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

.saturday-status-placeholder {
  justify-self: center;
}

.saturday-index {
  font-family: "Noto Serif SC", "Songti SC", serif;
  font-size: 22px;
}

.saturday-input :deep(input) {
  font-family: "LXGW WenKai", "STKaiti", "KaiTi", serif;
  font-size: 23px;
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
  .saturday-row {
    grid-template-columns: 48px 28px minmax(0, 1fr) 40px;
  }

  .saturday-input :deep(input) {
    font-size: 21px;
  }
}
</style>
