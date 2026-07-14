<script setup>
import { computed } from "vue";

const props = defineProps({
  favorites: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(["copy", "unlike", "back"]);

const sortedFavorites = computed(() =>
  [...props.favorites].sort((a, b) => {
    const first = new Date(a.likedAt).getTime();
    const second = new Date(b.likedAt).getTime();
    return (Number.isNaN(first) ? 0 : first) - (Number.isNaN(second) ? 0 : second);
  }),
);

const formatDate = (value) => {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value ?? "";
  return `${match[1]} 年 ${Number(match[2])} 月 ${Number(match[3])} 日`;
};

const formatLikedAt = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "收藏时间未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
};
</script>

<template>
  <section class="favorites-view" aria-labelledby="favorites-title">
    <v-toolbar color="transparent" density="compact">
      <v-btn
        icon="mdi-arrow-left"
        variant="text"
        aria-label="返回"
        @click="emit('back')"
      />
      <v-toolbar-title id="favorites-title" class="view-title">
        赠语收藏
      </v-toolbar-title>
    </v-toolbar>

    <p class="view-caption px-4 mt-3 mb-4">
     轻触复制，让它陪你去往别处。
    </p>

    <v-fade-transition mode="out-in">
      <v-list
        v-if="sortedFavorites.length"
        :key="`favorites-${sortedFavorites.length}`"
        class="favorites-list"
        bg-color="transparent"
      >
        <v-list-item
          v-for="(item, index) in sortedFavorites"
          :key="item.quoteId"
          class="px-1 pb-3"
        >
          <v-card class="quote-card" variant="outlined" elevation="0">
            <v-card-item>
              <template #prepend>
                <v-avatar color="surface-variant" size="34">
                  <span class="quote-index">{{ String(index + 1).padStart(2, "0") }}</span>
                </v-avatar>
              </template>
              <v-card-title class="quote-date">{{ formatDate(item.date) }}</v-card-title>
              <v-card-subtitle>
                {{ formatLikedAt(item.likedAt) }} 收藏
              </v-card-subtitle>
              <template #append>
                <v-btn
                  icon="mdi-heart-off-outline"
                  variant="text"
                  color="primary"
                  aria-label="取消收藏"
                  @click="emit('unlike', item)"
                />
              </template>
            </v-card-item>

            <v-card-text>
              <blockquote class="quote-text mb-0" @click="emit('copy', item)">
                {{ item.textSnapshot }}
              </blockquote>
            </v-card-text>

            <v-card-actions class="px-4 pb-3">
              <v-spacer />
              <v-btn
                prepend-icon="mdi-content-copy"
                variant="text"
                color="primary"
                size="small"
                @click="emit('copy', item)"
              >
                复制赠语
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-list-item>
      </v-list>

      <v-empty-state
        v-else
        key="favorites-empty"
        icon="mdi-heart-outline"
        title="还没有收藏的赠语"
        text="在每日页面点亮心形，喜欢的句子便会来到这里。"
      />
    </v-fade-transition>
  </section>
</template>

<style scoped>
.favorites-view {
  width: 100%;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  padding: 12px 12px 30px;
}

.view-title,
.quote-date,
.quote-text,
.quote-index {
  font-family: var(--app-font-family);
}

.view-title {
  letter-spacing: 0.12em;
}

.view-caption {
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-family: var(--app-font-family);
  font-size: 0.76rem;
  line-height: 1.85;
}

.favorites-list {
  padding: 0;
}

.quote-card {
  background-color: rgba(var(--v-theme-surface), 0.52);
}

:global(.v-theme--poeticNight) .quote-card {
  background-color: rgba(var(--v-theme-surface), 0.92);
}

:global(.v-theme--poeticNight) .view-caption {
  color: rgba(var(--v-theme-on-surface), 0.72);
}

.quote-index {
  color: rgb(var(--v-theme-primary));
  font-size: 0.76rem;
}

.quote-date {
  font-size: 0.86rem;
  letter-spacing: 0.06em;
}

.quote-text {
  color: rgb(var(--v-theme-on-surface));
  cursor: copy;
  font-size: clamp(1rem, 4.7vw, 1.14rem);
  letter-spacing: 0.08em;
  line-height: 2;
  text-align: center;
}

@media (max-width: 360px) {
  .favorites-view {
    padding-inline: 8px;
  }
}
</style>
