<script setup>
import { computed } from "vue";

import { renderMarkdown } from "../lib/markdown.js";

const props = defineProps({
  source: {
    type: String,
    default: "",
  },
  emptyText: {
    type: String,
    default: "还没有内容",
  },
});

const rendered = computed(() => renderMarkdown(props.source));
const isEmpty = computed(() => !props.source.trim());
</script>

<template>
  <p v-if="isEmpty" class="markdown-empty">{{ emptyText }}</p>
  <div v-else class="markdown-body" v-html="rendered" />
</template>

<style scoped>
.markdown-empty {
  color: rgba(var(--v-theme-on-surface), 0.56);
  margin: 0;
  line-height: 1.8;
}

.markdown-body {
  color: rgb(var(--v-theme-on-surface));
  font-family: var(--app-font-family);
  font-size: 0.98rem;
  line-height: 1.9;
  overflow-wrap: anywhere;
}

.markdown-body :deep(> :first-child) {
  margin-top: 0;
}

.markdown-body :deep(> :last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3) {
  color: rgb(var(--v-theme-primary));
  line-height: 1.45;
  margin: 1.2em 0 0.55em;
}

.markdown-body :deep(h1) {
  font-size: 1.45rem;
}

.markdown-body :deep(h2) {
  font-size: 1.25rem;
}

.markdown-body :deep(h3) {
  font-size: 1.1rem;
}

.markdown-body :deep(p),
.markdown-body :deep(ul),
.markdown-body :deep(ol),
.markdown-body :deep(blockquote),
.markdown-body :deep(pre),
.markdown-body :deep(table) {
  margin: 0.72em 0;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 1.5em;
}

.markdown-body :deep(blockquote) {
  border-left: 3px solid rgba(var(--v-theme-secondary), 0.56);
  color: rgba(var(--v-theme-on-surface), 0.72);
  padding: 0.2em 0 0.2em 1em;
}

.markdown-body :deep(code) {
  background: rgba(var(--v-theme-primary), 0.08);
  border-radius: 5px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.88em;
  padding: 0.15em 0.36em;
}

.markdown-body :deep(pre) {
  max-width: 100%;
  overflow-x: auto;
  padding: 12px 14px;
  border: 1px solid rgba(var(--v-theme-outline), 0.24);
  border-radius: 10px;
  background: rgba(var(--v-theme-surface-variant), 0.62);
}

.markdown-body :deep(pre code) {
  background: transparent;
  padding: 0;
}

.markdown-body :deep(a) {
  color: rgb(var(--v-theme-secondary));
  text-decoration-thickness: 1px;
  text-underline-offset: 0.18em;
}

.markdown-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  display: block;
  overflow-x: auto;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  min-width: 110px;
  padding: 7px 10px;
  border: 1px solid rgba(var(--v-theme-outline), 0.3);
  text-align: left;
}

:global(.v-theme--poeticNight) .markdown-body :deep(th),
:global(.v-theme--poeticNight) .markdown-body :deep(td) {
  border-color: rgba(var(--v-theme-outline), 0.6);
}

.markdown-body :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 12px;
}
</style>
