<script setup>
import { computed } from "vue";

const props = defineProps({
  items: {
    type: Array,
    default: () => [],
  },
  diary: {
    type: String,
    default: "",
  },
  compact: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(["cycle", "update-item", "update:diary"]);

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
  };

  return icons[stateOf(item)];
};

const stateColor = (item) => {
  const colors = {
    pending: "outline",
    completed: "primary",
    missed: "warning",
    exempt: "secondary",
  };

  return colors[stateOf(item)];
};

const stateLabel = (item) => {
  const labels = {
    pending: "待完成，点击标记完成",
    completed: "已完成，点击标记未完成",
    missed: "未完成警报，点击改为完成",
    exempt: "已由奖励免除，计为完成",
  };

  return `第 ${item.slot} 项：${labels[stateOf(item)]}`;
};

const updateItem = (slot, value) => {
  emit("update-item", { slot, value: value ?? "" });
};
</script>

<template>
  <v-fade-transition appear>
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

      <v-sheet class="diary-section mt-4 px-4 pb-2" color="transparent">
        <v-divider class="mb-4" />

        <div class="diary-section__heading d-flex align-center ga-2 mb-2">
          <v-icon icon="mdi-book-open-page-variant-outline" size="18" />
          <span>日结 / 日记</span>
        </div>

        <v-textarea
          class="diary-field"
          :model-value="diary"
          aria-label="日结或日记"
          auto-grow
          hide-details
          rows="4"
          variant="underlined"
          @update:model-value="emit('update:diary', $event ?? '')"
        />
      </v-sheet>
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
  font-family: "Noto Serif SC", "Songti SC", "STSong", serif;
}

.workday-list--compact {
  --task-row-min-height: 56px;
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

:deep(.study-item--completed .item-field input) {
  text-decoration: line-through 1.5px;
}

:deep(.study-item--missed.v-expansion-panel) {
  background-image: url("/assets/brush-alert.png");
  background-repeat: no-repeat;
  background-position: center;
  background-size: calc(100% - 8px) calc(100% - 6px);
}

:deep(.study-item--missed .study-item__content) {
  color: rgb(var(--v-theme-error));
}

:deep(.study-item--exempt .study-item__content) {
  text-decoration: line-through 2px;
  text-decoration-color: #c66678;
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
}

.diary-section :deep(.v-divider) {
  opacity: 0.34;
}

.diary-section__heading {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.9rem;
  letter-spacing: 0.14em;
}

.diary-field {
  max-width: 100%;
  pointer-events: auto;
}

.diary-field :deep(textarea) {
  min-height: 116px;
  font-family: inherit;
  font-size: 1rem;
  line-height: 1.9;
}

@keyframes exempt-glimmer {
  0%,
  100% {
    color: #7d5367;
    text-decoration-color: #c66678;
    text-shadow: -5px 0 10px rgba(198, 102, 120, 0.12);
  }

  33% {
    color: #5f687f;
    text-decoration-color: #6a8eb8;
    text-shadow: 0 0 12px rgba(106, 142, 184, 0.22);
  }

  66% {
    color: #6e6c4d;
    text-decoration-color: #c49a53;
    text-shadow: 5px 0 10px rgba(196, 154, 83, 0.18);
  }
}

@keyframes exempt-icon-glimmer {
  0%,
  100% {
    color: #b85f78;
  }

  33% {
    color: #5f83ad;
  }

  66% {
    color: #b18742;
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
