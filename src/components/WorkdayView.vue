<script setup>
import { computed, ref, watch } from "vue";

import MarkdownContent from "./MarkdownContent.vue";
import MarkdownEditorDialog from "./MarkdownEditorDialog.vue";

const props = defineProps({
  active: {
    type: Boolean,
    default: true,
  },
  date: {
    type: String,
    default: "",
  },
  items: {
    type: Array,
    default: () => [],
  },
  diary: {
    type: String,
    default: "",
  },
  cloudDraft: {
    type: String,
    default: "",
  },
  compact: {
    type: Boolean,
    default: true,
  },
  goalsReady: {
    type: Boolean,
    default: false,
  },
  goalsLocked: {
    type: Boolean,
    default: false,
  },
  journalUnlocked: {
    type: Boolean,
    default: false,
  },
  minimalMode: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits([
  "cycle",
  "request-lock",
  "unlock",
  "update-item",
  "update:diary",
  "update:cloud-draft",
]);
const journalDialog = ref(false);

watch(() => props.date, () => {
  journalDialog.value = false;
});

const editableSlots = new Set([4, 6, 7]);

const normalizedStepValue = (item) => {
  const numericSlot = Number(item.slot);
  return Number.isFinite(numericSlot) ? numericSlot : item.slot;
};

const expandedSteps = computed(() => props.items.map(normalizedStepValue));

const isEditable = (item) => editableSlots.has(Number(item.slot));

const itemPrefix = (item) => {
  if (Number(item.slot) === 4) return item.prefix || "生物";
  if (Number(item.slot) === 6) return "";
  if (Number(item.slot) === 7) return item.prefix || "生物课本";
  return item.prefix || "";
};

const itemSuffix = (item) => {
  if (Number(item.slot) === 4 || Number(item.slot) === 6) return "";
  if (Number(item.slot) === 7) return item.suffix || "阅读研习";
  return item.suffix || "";
};

const stateOf = (item) => {
  if (item.isPlanned === false) return "unplanned";
  if (item.isExempt) return "exempt";
  if (item.status === "completed") return "completed";
  if (item.status === "missed") return "missed";
  return "pending";
};

const stateIcon = (item) => {
  const icons = {
    pending: "mdi-checkbox-blank-circle-outline",
    completed: "mdi-check-circle",
    missed: "mdi-alert-circle-outline",
    exempt: "mdi-gift-outline",
    unplanned: "mdi-minus-circle-outline",
  };

  return icons[stateOf(item)];
};

const stateColor = (item) => {
  const colors = {
    pending: "outline",
    completed: "primary",
    missed: "warning",
    exempt: "secondary",
    unplanned: "outline",
  };

  return colors[stateOf(item)];
};

const stateLabel = (item) => {
  if (item.isPlanned === false) {
    return `第 ${item.slot} 项：留空，未列入今日计划`;
  }
  if (!props.minimalMode && !props.goalsLocked) {
    return `第 ${item.slot} 项：目标尚未锁定，暂不可勾选`;
  }
  const labels = {
    pending: "待完成，点击标记完成",
    completed: "已完成，点击标记未完成",
    missed: "未完成警报，点击重置为待完成",
    exempt: "已由奖励免除，计为完成",
  };

  return `第 ${item.slot} 项：${labels[stateOf(item)]}`;
};

const updateItem = (slot, value) => {
  emit("update-item", { slot, value: value ?? "" });
};

const openJournal = () => {
  if (props.journalUnlocked) journalDialog.value = true;
};

const saveJournal = (value) => {
  emit("update:diary", value ?? "");
};
</script>

<template>
  <v-fade-transition :appear="active">
    <section
      class="workday-list"
      :class="{ 'workday-list--compact': compact }"
      aria-label="工作日学习清单"
    >
      <v-stepper-vertical
        class="workday-stepper"
        :model-value="expandedSteps"
        multiple
        flat
        hide-actions
      >
        <v-stepper-vertical-item
          v-for="item in items"
          :key="item.slot"
          :value="normalizedStepValue(item)"
          :class="[
            'study-item',
            `study-item--${stateOf(item)}`,
            { 'study-item--unplanned': item.isPlanned === false },
          ]"
          eager
          hide-actions
        >
          <template #icon>
            <v-btn
              class="status-button"
              :class="`status-button--${stateOf(item)}`"
              :icon="stateIcon(item)"
              :color="stateColor(item)"
              :aria-label="stateLabel(item)"
              :disabled="(!minimalMode && !goalsLocked) || item.isExempt || item.isPlanned === false"
              size="44"
              variant="text"
              rounded="circle"
              @click.stop="emit('cycle', item.slot)"
            />
          </template>

          <template #title>
            <div
              class="study-item__content d-flex align-center flex-wrap ga-1 w-100"
              :class="{ 'study-item__content--section': Number(item.slot) === 7 }"
            >
              <span class="study-item__number">{{ item.slot }}.</span>

              <template v-if="isEditable(item)">
                <span v-if="itemPrefix(item)" class="study-item__affix">
                  {{ itemPrefix(item) }}
                </span>

                <v-text-field
                  class="item-field"
                  :class="{
                    'item-field--full': Number(item.slot) === 6,
                    'item-field--section': Number(item.slot) === 7,
                  }"
                  :model-value="item.editableValue"
                  :aria-label="`第 ${item.slot} 项补充内容`"
                  :placeholder="Number(item.slot) === 6 ? '可留空，不计入今日计划' : undefined"
                  :readonly="goalsLocked && !minimalMode"
                  density="compact"
                  hide-details
                  single-line
                  variant="underlined"
                  @click.stop
                  @update:model-value="updateItem(item.slot, $event)"
                />

                <span v-if="itemSuffix(item)" class="study-item__affix">
                  {{ itemSuffix(item) }}
                </span>
              </template>

              <span v-else class="study-item__fixed">
                {{ itemPrefix(item) }}{{ item.editableValue || "" }}{{ itemSuffix(item) }}
              </span>
            </div>
          </template>
        </v-stepper-vertical-item>
      </v-stepper-vertical>

      <v-fade-transition v-if="!minimalMode" mode="out-in">
        <div :key="goalsLocked ? 'locked' : goalsReady ? 'ready' : 'draft'" class="goal-gate px-4 mt-3">
          <v-alert
            v-if="!goalsReady && !minimalMode"
            density="compact"
            icon="mdi-pencil-outline"
            text="请先填写第 4、7 项留白；第 6 项可留空，留空时不计入今日计划。"
            type="info"
            variant="outlined"
          />

          <v-btn
            v-else-if="!goalsLocked"
            block
            color="primary"
            min-height="48"
            prepend-icon="mdi-lock-outline"
            variant="outlined"
            @click="emit('request-lock')"
          >
            核对并锁定今日目标
          </v-btn>

          <v-alert
            v-else
            color="primary"
            density="compact"
            icon="mdi-lock-check-outline"
            text="今日目标已锁定，现在可以逐项勾选。"
            variant="tonal"
          >
            <template #append>
              <v-btn
                class="goal-regret-button"
                min-width="52"
                size="small"
                variant="text"
                aria-label="解锁并重新编辑今日目标"
                @click="emit('unlock')"
              >
                解锁
              </v-btn>
            </template>
          </v-alert>
        </div>
      </v-fade-transition>

      <v-sheet
        class="diary-section mt-4 px-4 pb-2"
        :class="{ 'diary-section--interactive': journalUnlocked }"
        color="transparent"
        role="button"
        :tabindex="journalUnlocked ? 0 : -1"
        :aria-disabled="!journalUnlocked"
        :aria-label="minimalMode ? '打开日记编辑器' : '打开 Markdown 日记编辑器'"
        @click="openJournal"
        @keydown.enter.prevent="openJournal"
        @keydown.space.prevent="openJournal"
      >
        <v-divider class="mb-4" />

        <div class="diary-section__heading d-flex align-center ga-2 mb-2">
          <v-icon icon="mdi-book-open-page-variant-outline" size="18" />
          <span>日记</span>
          <v-spacer />
          <v-chip
            v-if="!minimalMode"
            :color="journalUnlocked ? 'primary' : undefined"
            size="x-small"
            variant="outlined"
          >
            {{ journalUnlocked ? "已结算，可书写" : goalsLocked ? "为全部目标标记结果后解锁" : "等待锁定目标" }}
          </v-chip>
        </div>

        <div class="diary-preview" :class="{ 'diary-preview--locked': !journalUnlocked }">
          <MarkdownContent
            v-if="journalUnlocked"
            :source="diary"
            :empty-text="minimalMode
              ? '点击这里，写下今天的日结或日记……'
              : '点击这里，用 Markdown 写下今天的日结或日记……'"
          />
          <p v-else class="diary-placeholder">
            {{ goalsLocked ? "请将每项目标标记为完成或未完成" : "先填写并锁定今日目标" }}
          </p>
          <v-icon
            v-if="journalUnlocked"
            class="diary-edit-icon"
            icon="mdi-pencil-outline"
            color="primary"
            size="18"
          />
        </div>
      </v-sheet>

      <MarkdownEditorDialog
        v-model="journalDialog"
        :content="diary"
        :cloud-draft="cloudDraft"
        :minimal-mode="minimalMode"
        @save="saveJournal"
        @update:cloud-draft="emit('update:cloud-draft', $event)"
      />
    </section>
  </v-fade-transition>
</template>

<style scoped>
.workday-list {
  --task-row-min-height: 64px;

  width: 100%;
  max-width: 100%;
  overflow-x: clip;
  color: rgb(var(--v-theme-on-surface));
  font-family: var(--app-font-family);
}

.workday-list--compact {
  --task-row-min-height: 56px;
}

.goal-regret-button {
  flex: 0 0 auto;
  align-self: center;
}

:deep(.workday-stepper.v-stepper) {
  width: 100%;
  overflow: visible;
  background: transparent;
  box-shadow: none;
}

:deep(.study-item.v-expansion-panel) {
  overflow: visible;
  background-color: transparent;
}

:deep(.study-item .v-expansion-panel-title) {
  min-height: var(--task-row-min-height);
  padding: 6px 10px 6px 13px;
}

:deep(.study-item .v-expansion-panel-title > .v-stepper-vertical-item__avatar + div) {
  flex: 1 1 auto;
  min-width: 0;
}

:deep(.study-item .v-expansion-panel-title__overlay) {
  opacity: 0;
}

:deep(.study-item .v-expansion-panel-text__wrapper) {
  padding: 0;
}

:deep(.study-item .v-stepper-vertical-item__avatar.v-avatar) {
  width: 44px !important;
  height: 44px !important;
  min-width: 44px !important;
  overflow: visible;
  background: transparent !important;
}

:deep(.study-item:not(:last-child)::before) {
  left: 34px;
  top: 46px;
  width: 1px;
  height: calc(100% - 36px);
  background: rgba(var(--v-theme-outline), 0.46);
}

.status-button {
  width: 44px;
  height: 44px;
  min-width: 44px;
  pointer-events: auto;
}

.status-button :deep(.v-icon) {
  font-size: 27px;
}

.status-button--completed {
  background-color: rgba(var(--v-theme-primary), 0.09);
}

.status-button--missed {
  background-color: rgba(var(--v-theme-warning), 0.12);
}

:deep(.study-item--unplanned .study-item__content) {
  opacity: 0.56;
}

.study-item__content {
  min-width: 0;
  min-height: 44px;
  padding-block: 2px;
  font-size: clamp(1rem, 4.4vw, 1.12rem);
  font-weight: 400;
  line-height: 1.65;
  letter-spacing: 0.015em;
  transition: color 220ms ease, opacity 220ms ease, text-shadow 220ms ease;
}

.study-item__number,
.study-item__affix {
  flex: 0 0 auto;
}

.study-item__fixed {
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: normal;
}

.item-field {
  flex: 1 1 72px;
  min-width: 56px;
  max-width: 100%;
  pointer-events: auto;
}

.item-field--full {
  flex-basis: calc(100% - 2rem);
}

.item-field--section {
  flex: 0 1 58px;
  max-width: 58px;
  min-width: 46px;
}

.study-item__content--section {
  flex-wrap: nowrap !important;
  font-size: clamp(0.88rem, 3.8vw, 0.96rem);
  gap: 3px !important;
}

.item-field :deep(.v-field) {
  --v-input-control-height: 44px;

  font: inherit;
}

.item-field :deep(.v-field__input) {
  min-height: 44px;
  padding-top: 4px;
  padding-bottom: 2px;
  font: inherit;
  letter-spacing: inherit;
}

:deep(.study-item--completed .study-item__content) {
  opacity: 0.44;
  text-decoration: line-through 1.5px;
  text-decoration-color: rgba(var(--v-theme-primary), 0.85);
}

:global(.v-theme--poeticNight) :deep(.study-item--completed .study-item__content) {
  opacity: 0.54;
}

:deep(.study-item--completed .item-field input) {
  text-decoration: line-through 1.5px;
}

:deep(.study-item--missed.v-expansion-panel) {
  background-color: rgba(var(--v-theme-error), 0.05);
}

:deep(.study-item--missed .study-item__content) {
  color: rgb(var(--v-theme-error));
}

:deep(.study-item--exempt .study-item__content) {
  text-decoration: line-through 2px;
  text-decoration-color: rgb(var(--v-theme-secondary));
  animation: exempt-glimmer 2.8s ease-in-out infinite;
}

:deep(.study-item--exempt .item-field input) {
  text-decoration: line-through 2px;
  text-decoration-color: currentColor;
}

.status-button--exempt {
  animation: exempt-icon-glimmer 2.8s ease-in-out infinite;
}

.diary-section {
  max-width: 100%;
  border-radius: 14px;
  transition: background-color 160ms ease, box-shadow 160ms ease;
}

.diary-section--interactive {
  cursor: pointer;
}

.diary-section--interactive:hover,
.diary-section--interactive:focus-visible {
  background: rgba(var(--v-theme-primary), 0.045) !important;
  box-shadow: inset 0 0 0 1px rgba(var(--v-theme-primary), 0.2);
  outline: none;
}

.diary-section--interactive:focus-visible {
  box-shadow: inset 0 0 0 2px rgba(var(--v-theme-primary), 0.65);
}

.diary-section :deep(.v-divider) {
  opacity: 0.34;
}

.diary-section__heading {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.9rem;
  letter-spacing: 0.14em;
}

.diary-preview {
  min-height: 116px;
  position: relative;
  padding: 12px 42px 16px 4px;
}

.diary-preview--locked {
  display: flex;
  align-items: flex-start;
}

.diary-placeholder {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 1rem;
  line-height: 1.9;
}

.diary-edit-icon {
  right: 8px;
  position: absolute;
  top: 14px;
}

@keyframes exempt-glimmer {
  0%,
  100% {
    color: rgb(var(--v-theme-secondary));
    text-decoration-color: rgb(var(--v-theme-secondary));
    text-shadow: -5px 0 10px rgba(var(--v-theme-secondary), 0.18);
  }

  33% {
    color: rgb(var(--v-theme-primary));
    text-decoration-color: rgb(var(--v-theme-primary));
    text-shadow: 0 0 12px rgba(var(--v-theme-primary), 0.22);
  }

  66% {
    color: rgb(var(--v-theme-tertiary));
    text-decoration-color: rgb(var(--v-theme-tertiary));
    text-shadow: 5px 0 10px rgba(var(--v-theme-tertiary), 0.18);
  }
}

@keyframes exempt-icon-glimmer {
  0%,
  100% {
    color: rgb(var(--v-theme-secondary));
  }

  33% {
    color: rgb(var(--v-theme-primary));
  }

  66% {
    color: rgb(var(--v-theme-tertiary));
  }
}

@media (max-width: 360px) {
  :deep(.study-item .v-expansion-panel-title) {
    padding-right: 6px;
  }

  .study-item__content {
    font-size: 0.98rem;
    letter-spacing: 0;
  }

  .item-field {
    flex-basis: 60px;
  }
}

@media (prefers-reduced-motion: reduce) {
  :deep(.study-item--exempt .study-item__content),
  .status-button--exempt {
    animation: none;
  }

  .study-item__content {
    transition: none;
  }
}
</style>
