<script setup>
import { HITOKOTO_CATEGORIES } from "../services/hitokoto.js";

const props = defineProps({
  modelValue: {
    type: String,
    default: "lxgw-wenka",
  },
  dayPageTransition: {
    type: String,
    default: "classic",
  },
  quoteSource: {
    type: String,
    default: "native",
  },
  hitokotoCategories: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits([
  "update:modelValue",
  "update:dayPageTransition",
  "update:quoteSource",
  "update:hitokotoCategories",
  "back",
]);

const fontOptions = [
  {
    value: "system",
    label: "系统",
    description: "跟随当前设备的系统界面字体",
    preview: "暁夕の箋 · 日々を光として",
  },
  {
    value: "lxgw-wenka",
    label: "lxgw-wenka",
    description: "温润清晰的中文楷体风格",
    preview: "晨光落在书页，也落在今天",
  },
  {
    value: "anthropic",
    label: "Anthropic",
    description: "简洁、克制的现代西文字体",
    preview: "Study gently, grow steadily.",
  },
];

const quoteSourceOptions = [
  {
    value: "native",
    label: "原生赠语",
    description: "使用为 07.13—08.29 逐日写作的固定文案，完全离线。",
    icon: "mdi-feather",
  },
  {
    value: "hitokoto",
    label: "一言",
    description: "首次打开某日时从一言 API 获取，绑定后本地与云端复用。",
    icon: "mdi-comment-quote-outline",
  },
];

const dayPageTransitionOptions = [
  {
    value: "classic",
    label: "原有翻页",
    description: "使用轻柔的淡入与旋转过渡，响应更快。",
    icon: "mdi-page-next-outline",
  },
  {
    value: "flipbook",
    label: "3D 翻书",
    description: "使用 turn.js 呈现纸张卷曲、阴影与真实翻书层次。",
    icon: "mdi-book-open-page-variant-outline",
  },
];

function toggleCategory(value, checked) {
  const categories = new Set(props.hitokotoCategories);
  if (checked) categories.add(value);
  else categories.delete(value);
  emit("update:hitokotoCategories", [...categories]);
}
</script>

<template>
  <section class="settings-view" aria-labelledby="settings-title">
    <v-toolbar color="transparent" density="compact">
      <v-btn icon="mdi-arrow-left" variant="text" aria-label="返回" @click="emit('back')" />
      <v-toolbar-title id="settings-title" class="view-title">设置</v-toolbar-title>
    </v-toolbar>

    <div class="settings-content">
      <div class="section-heading">
        <v-icon icon="mdi-format-font" size="20" />
        <div>
          <h2>字体</h2>
          <p>选择后会立即应用，并自动保存在本地。</p>
        </div>
      </div>

      <v-radio-group
        :model-value="modelValue"
        aria-label="选择应用字体"
        hide-details
        @update:model-value="emit('update:modelValue', $event)"
      >
        <v-card
          v-for="option in fontOptions"
          :key="option.value"
          class="font-option mb-3"
          :class="{ 'font-option--active': modelValue === option.value }"
          :color="modelValue === option.value ? 'primary' : undefined"
          :variant="modelValue === option.value ? 'tonal' : 'outlined'"
          @click="emit('update:modelValue', option.value)"
        >
          <v-card-item>
            <template #prepend>
              <v-radio :value="option.value" :aria-label="option.label" @click.stop />
            </template>
            <v-card-title>{{ option.label }}</v-card-title>
            <v-card-subtitle>{{ option.description }}</v-card-subtitle>
          </v-card-item>
          <v-card-text>
            <p class="font-preview" :data-preview-font="option.value">{{ option.preview }}</p>
          </v-card-text>
        </v-card>
      </v-radio-group>

      <v-divider class="settings-divider" />

      <div class="section-heading">
        <v-icon icon="mdi-book-open-page-variant-outline" size="20" />
        <div>
          <h2>翻页效果</h2>
          <p>仅影响日视图，切换后会立即保存到当前浏览器。</p>
        </div>
      </div>

      <v-radio-group
        :model-value="dayPageTransition"
        aria-label="选择日视图翻页效果"
        hide-details
        @update:model-value="emit('update:dayPageTransition', $event)"
      >
        <v-card
          v-for="option in dayPageTransitionOptions"
          :key="option.value"
          class="transition-option mb-3"
          :class="{ 'transition-option--active': dayPageTransition === option.value }"
          :color="dayPageTransition === option.value ? 'primary' : undefined"
          :variant="dayPageTransition === option.value ? 'tonal' : 'outlined'"
          @click="emit('update:dayPageTransition', option.value)"
        >
          <v-card-item>
            <template #prepend>
              <v-radio :value="option.value" :aria-label="option.label" @click.stop />
            </template>
            <v-card-title class="d-flex align-center ga-2">
              <v-icon :icon="option.icon" size="20" />
              {{ option.label }}
            </v-card-title>
            <v-card-subtitle>{{ option.description }}</v-card-subtitle>
          </v-card-item>
        </v-card>
      </v-radio-group>

      <v-divider class="settings-divider" />

      <div class="section-heading">
        <v-icon icon="mdi-comment-quote-outline" size="20" />
        <div>
          <h2>今日赠语来源</h2>
          <p>来源和分类会即时保存；已经绑定到日期的一言不会重复请求。</p>
        </div>
      </div>

      <v-radio-group
        :model-value="quoteSource"
        aria-label="选择今日赠语来源"
        hide-details
        @update:model-value="emit('update:quoteSource', $event)"
      >
        <v-card
          v-for="option in quoteSourceOptions"
          :key="option.value"
          class="source-option mb-3"
          :class="{ 'source-option--active': quoteSource === option.value }"
          :color="quoteSource === option.value ? 'primary' : undefined"
          :variant="quoteSource === option.value ? 'tonal' : 'outlined'"
          @click="emit('update:quoteSource', option.value)"
        >
          <v-card-item>
            <template #prepend>
              <v-radio :value="option.value" :aria-label="option.label" @click.stop />
            </template>
            <v-card-title class="d-flex align-center ga-2">
              <v-icon :icon="option.icon" size="20" />
              {{ option.label }}
            </v-card-title>
            <v-card-subtitle>{{ option.description }}</v-card-subtitle>
          </v-card-item>
        </v-card>
      </v-radio-group>

      <v-expand-transition>
        <v-card
          v-if="quoteSource === 'hitokoto'"
          class="hitokoto-options"
          variant="outlined"
        >
          <v-card-item prepend-icon="mdi-filter-multiple-outline">
            <v-card-title>一言句子类型</v-card-title>
            <v-card-subtitle>可多选，对应请求中的多个 c 参数</v-card-subtitle>
          </v-card-item>

          <v-card-text class="pt-0">
            <v-row density="comfortable">
              <v-col
                v-for="category in HITOKOTO_CATEGORIES"
                :key="category.value"
                cols="6"
                sm="4"
              >
                <v-checkbox
                  :model-value="hitokotoCategories.includes(category.value)"
                  :label="`${category.label} · ${category.value}`"
                  color="primary"
                  density="compact"
                  hide-details
                  @update:model-value="toggleCategory(category.value, $event)"
                  @click.stop
                />
              </v-col>
            </v-row>

            <v-alert
              class="mt-3"
              density="compact"
              icon="mdi-information-outline"
              type="info"
              variant="outlined"
            >
              未勾选时不传 c 参数，由一言随机选择默认分类。分类只影响尚未绑定的日期；请求会直连
              v1.hitokoto.cn。
            </v-alert>
          </v-card-text>
        </v-card>
      </v-expand-transition>
    </div>
  </section>
</template>

<style scoped>
.settings-view {
  width: 100%;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  padding: 12px 12px 30px;
}

.view-title {
  letter-spacing: 0.12em;
}

.settings-content {
  width: min(100%, 640px);
  margin: 22px auto 0;
  padding: 0 4px;
}

.section-heading {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin: 0 8px 18px;
}

.section-heading h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.section-heading p {
  color: rgba(var(--v-theme-on-surface), 0.58);
  margin: 5px 0 0;
  font-size: 0.78rem;
  line-height: 1.6;
}

.font-option,
.transition-option {
  background: rgba(var(--v-theme-surface), 0.6);
  cursor: pointer;
  transition: border-color 160ms ease, background-color 160ms ease;
}

.source-option {
  background: rgba(var(--v-theme-surface), 0.6);
  cursor: pointer;
  transition: border-color 160ms ease, background-color 160ms ease;
}

.source-option--active {
  border-color: rgb(var(--v-theme-primary));
}

.transition-option--active {
  border-color: rgb(var(--v-theme-primary));
}

.settings-divider {
  margin: 28px 8px 24px;
}

.hitokoto-options {
  margin-bottom: 28px;
  background: rgba(var(--v-theme-surface), 0.52);
  border-color: rgba(var(--v-theme-outline), 0.32);
}

.hitokoto-options :deep(.v-label) {
  font-size: 0.82rem;
}

.font-option--active {
  border-color: rgb(var(--v-theme-primary));
}

.font-preview {
  margin: 0;
  padding: 14px 12px 4px;
  border-top: 1px solid rgba(var(--v-theme-outline), 0.2);
  color: rgb(var(--v-theme-on-surface));
  font-size: 1.08rem;
  line-height: 1.8;
}

.font-preview[data-preview-font="system"] {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.font-preview[data-preview-font="lxgw-wenka"] {
  font-family: "LXGW WenKai", "STKaiti", "KaiTi", serif;
}

.font-preview[data-preview-font="anthropic"] {
  font-family: "Anthropic", system-ui, sans-serif;
}

@media (max-width: 360px) {
  .settings-view {
    padding-inline: 8px;
  }
}
</style>
