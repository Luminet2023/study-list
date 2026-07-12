<script setup>
defineProps({
  meta: {
    type: Object,
    required: true,
  },
  quote: {
    type: String,
    default: "",
  },
  liked: {
    type: Boolean,
    default: false,
  },
  dense: {
    type: Boolean,
    default: false,
  },
});

defineEmits(["menu", "copy", "toggle-like"]);
</script>

<template>
  <header class="poetic-header" :class="{ 'poetic-header--dense': dense }">
    <v-btn
      class="menu-trigger"
      icon="mdi-menu"
      variant="outlined"
      size="44"
      aria-label="打开工具栏"
      @click="$emit('menu')"
    />

    <div class="date-lockup" aria-label="当前日期">
      <span class="date-numeral">{{ meta.day }}</span>
      <v-divider vertical class="date-divider" />
      <div class="date-meta">
        <span>{{ meta.year }}</span>
        <span>/</span>
        <span>{{ meta.month }}</span>
        <span>/</span>
        <span>{{ meta.weekday }}</span>
        <v-img
          class="seal-mark"
          src="/assets/seal-mark.png"
          width="18"
          height="18"
          alt=""
          aria-hidden="true"
        />
      </div>
    </div>

    <div class="blessing-wrap">
      <v-btn
        class="blessing-copy"
        variant="text"
        block
        :ripple="false"
        aria-label="复制今日赠语"
        @click="$emit('copy')"
      >
        <span class="blessing-text">{{ quote }}</span>
      </v-btn>

      <div class="blessing-actions">
        <v-btn
          :icon="liked ? 'mdi-heart' : 'mdi-heart-outline'"
          :color="liked ? 'secondary' : undefined"
          variant="text"
          size="44"
          :aria-label="liked ? '取消收藏赠语' : '收藏赠语'"
          @click="$emit('toggle-like')"
        />
        <v-btn
          icon="mdi-content-copy"
          variant="text"
          size="44"
          aria-label="复制今日赠语"
          @click="$emit('copy')"
        />
      </div>
    </div>
  </header>
</template>

<style scoped>
.poetic-header {
  min-height: 272px;
  padding: max(20px, env(safe-area-inset-top)) 16px 0;
  position: relative;
}

.poetic-header--dense {
  min-height: 226px;
}

.menu-trigger {
  border-color: rgba(49, 36, 50, 0.68);
  left: 12px;
  position: absolute;
  top: max(20px, env(safe-area-inset-top));
  z-index: 4;
}

.date-lockup {
  align-items: flex-start;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  min-height: 124px;
  padding-right: 2px;
}

.date-numeral {
  color: rgba(116, 98, 107, 0.2);
  font-family: "Cormorant Garamond", "Bodoni Moda", Georgia, serif;
  font-size: clamp(96px, 28vw, 114px);
  font-weight: 300;
  letter-spacing: -0.08em;
  line-height: 0.82;
}

.date-divider {
  border-color: rgba(49, 36, 50, 0.52);
  height: 116px;
  opacity: 1;
}

.date-meta {
  align-items: center;
  color: rgb(var(--v-theme-on-background));
  display: flex;
  flex-direction: column;
  font-family: "Noto Serif SC", "Songti SC", serif;
  font-size: 12px;
  gap: 1px;
  line-height: 1.35;
  min-width: 31px;
  padding-top: 6px;
}

.seal-mark {
  margin-top: 3px;
  opacity: 0.9;
}

.blessing-wrap {
  margin: 2px auto 0;
  max-width: 310px;
  text-align: center;
}

.blessing-copy {
  height: auto;
  min-height: 56px;
  padding: 0 4px;
  text-transform: none;
  white-space: normal;
}

.blessing-text {
  color: rgb(var(--v-theme-on-background));
  font-family: "LXGW WenKai", "STKaiti", "KaiTi", serif;
  font-size: clamp(18px, 4.9vw, 20px);
  font-weight: 400;
  letter-spacing: 0.07em;
  line-height: 1.8;
  text-wrap: balance;
}

.blessing-actions {
  display: flex;
  justify-content: center;
  margin-top: 4px;
}

@media (max-width: 360px) {
  .poetic-header {
    min-height: 254px;
  }

  .date-numeral {
    font-size: 98px;
  }

  .blessing-wrap {
    max-width: 276px;
  }
}
</style>
