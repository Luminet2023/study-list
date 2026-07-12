<script setup>
defineProps({
  side: {
    type: String,
    required: true,
    validator: (value) => value === "left" || value === "right",
  },
  label: {
    type: String,
    default: "",
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});

defineEmits(["navigate"]);
</script>

<template>
  <v-btn
    class="day-ear"
    :class="`day-ear--${side}`"
    variant="text"
    :disabled="disabled"
    :aria-label="side === 'left' ? '前一天' : '后一天'"
    @click="$emit('navigate')"
  >
    <v-icon :icon="side === 'left' ? 'mdi-chevron-left' : 'mdi-chevron-right'" size="24" />
    <span class="day-ear__label">{{ label }}</span>
    <v-img
      class="day-ear__fold"
      :class="{ 'day-ear__fold--mirror': side === 'right' }"
      src="/assets/page-fold.png"
      width="46"
      height="46"
      alt=""
      aria-hidden="true"
    />
  </v-btn>
</template>

<style scoped>
.day-ear {
  border: 1px solid rgba(132, 124, 127, 0.48);
  border-left: 0;
  border-radius: 0 22px 22px 0;
  height: 184px;
  min-width: 32px;
  padding: 18px 2px 34px;
  position: absolute;
  top: 174px;
  width: 33px;
  z-index: 5;
}

.day-ear--left {
  left: 0;
}

.day-ear--right {
  border-left: 1px solid rgba(132, 124, 127, 0.48);
  border-radius: 22px 0 0 22px;
  border-right: 0;
  right: 0;
}

.day-ear :deep(.v-btn__content) {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
}

.day-ear__label {
  font-family: "Noto Serif SC", "Songti SC", serif;
  font-size: 11px;
  line-height: 1.25;
  white-space: nowrap;
  writing-mode: vertical-rl;
}

.day-ear__fold {
  bottom: -3px;
  left: -2px;
  opacity: 0.82;
  pointer-events: none;
  position: absolute;
}

.day-ear__fold--mirror {
  left: auto;
  right: -2px;
  transform: scaleX(-1);
}

@media (max-width: 360px) {
  .day-ear {
    opacity: 0.82;
    width: 30px;
  }
}
</style>
