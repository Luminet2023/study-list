<script setup>
import { onBeforeUnmount, ref, watch } from "vue";

const props = defineProps({
  active: {
    type: Boolean,
    default: true,
  },
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
  minimalMode: {
    type: Boolean,
    default: false,
  },
  quoteLoading: {
    type: Boolean,
    default: false,
  },
  quoteError: {
    type: String,
    default: "",
  },
  typewriter: {
    type: Boolean,
    default: false,
  },
  attribution: {
    type: String,
    default: "",
  },
  attributionHref: {
    type: String,
    default: "",
  },
});

defineEmits(["copy", "toggle-like", "retry"]);

const displayedQuote = ref("");
const typing = ref(false);
let typingTimer;

function stopTyping() {
  globalThis.clearTimeout?.(typingTimer);
  typingTimer = undefined;
  typing.value = false;
}

function prefersReducedMotion() {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

function revealQuote() {
  stopTyping();
  const quote = String(props.quote ?? "");
  if (props.quoteLoading) {
    displayedQuote.value = "";
    return;
  }
  if (!props.active || !props.typewriter || !quote || prefersReducedMotion()) {
    displayedQuote.value = quote;
    return;
  }
  const characters = Array.from(quote);
  let index = 0;
  displayedQuote.value = "";
  typing.value = true;
  const typeNext = () => {
    index += 1;
    displayedQuote.value = characters.slice(0, index).join("");
    if (index >= characters.length) {
      typing.value = false;
      return;
    }
    typingTimer = globalThis.setTimeout?.(typeNext, 42);
  };
  typingTimer = globalThis.setTimeout?.(typeNext, 80);
}

watch(
  () => [props.active, props.quote, props.quoteLoading, props.typewriter],
  revealQuote,
  { immediate: true },
);

onBeforeUnmount(stopTyping);
</script>

<template>
  <header class="poetic-header" :class="{ 'poetic-header--dense': dense }">
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
          v-if="!minimalMode"
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
      <span v-if="active" class="d-sr-only" aria-live="polite">
        {{ quoteLoading ? "正在获取今日赠语" : quote }}
      </span>

      <v-fade-transition mode="out-in">
        <v-skeleton-loader
          v-if="quoteLoading"
          key="quote-loading"
          class="blessing-skeleton"
          type="text@2"
          aria-label="正在获取今日赠语"
        />

        <div v-else-if="quoteError" key="quote-error" class="blessing-error">
          <v-icon icon="mdi-cloud-alert-outline" size="20" />
          <span>{{ quoteError }}</span>
          <v-btn size="small" variant="text" color="primary" @click="$emit('retry')">
            重新获取
          </v-btn>
        </div>

        <div v-else key="quote-ready">
          <v-btn
            class="blessing-copy"
            variant="text"
            block
            :ripple="false"
            :disabled="!quote"
            aria-label="复制今日赠语"
            @click="$emit('copy')"
          >
            <span class="blessing-text" aria-hidden="true">
              {{ displayedQuote }}<span v-if="typing" class="typing-caret">｜</span>
            </span>
          </v-btn>

          <v-btn
            v-if="attribution && attributionHref"
            class="quote-attribution"
            :href="attributionHref"
            target="_blank"
            rel="noopener noreferrer"
            variant="text"
            size="x-small"
            append-icon="mdi-open-in-new"
            @click.stop
          >
            {{ attribution }}
          </v-btn>
        </div>
      </v-fade-transition>

      <div class="blessing-actions">
        <v-btn
          :icon="liked ? 'mdi-heart' : 'mdi-heart-outline'"
          :color="liked ? 'secondary' : undefined"
          variant="text"
          size="44"
          :disabled="quoteLoading || !quote"
          :aria-label="liked ? '取消收藏赠语' : '收藏赠语'"
          @click="$emit('toggle-like')"
        />
        <v-btn
          icon="mdi-content-copy"
          variant="text"
          size="44"
          :disabled="quoteLoading || !quote"
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

.date-lockup {
  align-items: flex-start;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  min-height: 124px;
  padding-right: 2px;
}

.date-numeral {
  color: rgba(var(--v-theme-primary), 0.24);
  font-family: var(--app-font-family);
  font-size: clamp(96px, 28vw, 114px);
  font-weight: 300;
  letter-spacing: -0.08em;
  line-height: 0.82;
}

.date-divider {
  border-color: rgba(var(--v-theme-outline), 0.52);
  height: 116px;
  opacity: 1;
}

:global(.v-theme--poeticNight) .date-numeral {
  color: rgba(var(--v-theme-primary), 0.5);
}

.date-meta {
  align-items: center;
  color: rgb(var(--v-theme-on-background));
  display: flex;
  flex-direction: column;
  font-family: var(--app-font-family);
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

.blessing-skeleton {
  width: min(100%, 286px);
  min-height: 72px;
  margin: 0 auto;
  background: transparent;
}

.blessing-skeleton :deep(.v-skeleton-loader__text) {
  height: 14px;
  margin: 10px auto;
  border-radius: 1px;
}

.blessing-error {
  display: flex;
  min-height: 72px;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
  color: rgba(var(--v-theme-on-background), 0.72);
  font-size: 0.78rem;
}

.blessing-text {
  color: rgb(var(--v-theme-on-background));
  font-family: var(--app-font-family);
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

.typing-caret {
  color: rgb(var(--v-theme-secondary));
  animation: typing-caret-blink 720ms steps(1, end) infinite;
}

.quote-attribution {
  max-width: 100%;
  margin-top: 2px;
  opacity: 0.66;
  font-family: var(--app-font-family);
  letter-spacing: 0.05em;
  text-transform: none;
}

@keyframes typing-caret-blink {
  0%, 48% { opacity: 1; }
  49%, 100% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .typing-caret { animation: none; }
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

@media (min-width: 960px) {
  .poetic-header {
    position: sticky;
    top: 0;
    min-height: 100%;
    height: 100dvh;
    padding: 54px 46px 42px;
    border-right: 1px solid rgba(var(--v-theme-outline), 0.2);
  }

  .date-lockup {
    min-height: 176px;
    padding-right: 8px;
  }

  .date-numeral {
    font-size: clamp(132px, 11vw, 166px);
  }

  .date-divider {
    height: 164px;
  }

  .date-meta {
    padding-top: 12px;
    font-size: 13px;
  }

  .blessing-wrap {
    max-width: 430px;
    margin-top: 70px;
  }

  .blessing-text {
    font-size: clamp(20px, 1.9vw, 26px);
    line-height: 2;
  }
}
</style>
