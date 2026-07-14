<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useDisplay } from "vuetify";

import { countMarkdownCharacters } from "../lib/markdown.js";
import { createUndoHistory } from "../lib/undoHistory.js";
import MarkdownContent from "./MarkdownContent.vue";

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
  content: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["update:modelValue", "save"]);
const { smAndDown } = useDisplay();
const draft = ref("");
const mode = ref("edit");
const editorField = ref(null);
const history = createUndoHistory();
let historyTimer;

const tools = [
  { key: "heading", icon: "mdi-format-header-pound", label: "二级标题", prefix: "## ", line: true },
  { key: "bold", icon: "mdi-format-bold", label: "粗体", before: "**", after: "**", sample: "重点" },
  { key: "italic", icon: "mdi-format-italic", label: "斜体", before: "*", after: "*", sample: "文字" },
  { key: "strike", icon: "mdi-format-strikethrough", label: "删除线", before: "~~", after: "~~", sample: "文字" },
  { key: "quote", icon: "mdi-format-quote-close", label: "引用", prefix: "> ", line: true },
  { key: "bullet", icon: "mdi-format-list-bulleted", label: "无序列表", prefix: "- ", line: true },
  { key: "ordered", icon: "mdi-format-list-numbered", label: "有序列表", prefix: "1. ", line: true },
  { key: "link", icon: "mdi-link-variant", label: "链接", before: "[", after: "](https://)", sample: "链接文字" },
  { key: "code", icon: "mdi-code-tags", label: "行内代码", before: "`", after: "`", sample: "code" },
  {
    key: "table",
    icon: "mdi-table",
    label: "表格",
    insert: "\n| 项目 | 记录 |\n| --- | --- |\n| 今日 |  |\n",
  },
];

const characterCount = computed(() => countMarkdownCharacters(draft.value));

watch(
  () => props.modelValue,
  (opened) => {
    if (!opened) return;
    clearHistoryTimer();
    draft.value = props.content;
    history.reset(props.content);
    mode.value = "edit";
    nextTick(() => editorField.value?.$el?.querySelector("textarea")?.focus());
  },
);

onBeforeUnmount(clearHistoryTimer);

function clearHistoryTimer() {
  if (!historyTimer) return;
  clearTimeout(historyTimer);
  historyTimer = undefined;
}

function commitDraftHistory() {
  clearHistoryTimer();
  history.record(draft.value);
}

function updateDraft(value) {
  draft.value = String(value ?? "");
  clearHistoryTimer();
  historyTimer = setTimeout(commitDraftHistory, 400);
}

function restoreDraft(value) {
  clearHistoryTimer();
  draft.value = value;
  nextTick(() => {
    const textarea = editorField.value?.$el?.querySelector("textarea");
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(value.length, value.length);
  });
}

function undo() {
  commitDraftHistory();
  restoreDraft(history.undo());
}

function redo() {
  commitDraftHistory();
  restoreDraft(history.redo());
}

function onEditorKeydown(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  } else if (key === "y") {
    event.preventDefault();
    redo();
  }
}

function close() {
  clearHistoryTimer();
  emit("update:modelValue", false);
}

function save() {
  commitDraftHistory();
  emit("save", draft.value);
  close();
}

function switchMode(nextMode) {
  if (!nextMode) return;
  if (nextMode === "preview") {
    const textarea = editorField.value?.$el?.querySelector("textarea");
    if (textarea && textarea.value !== draft.value) updateDraft(textarea.value);
    commitDraftHistory();
  }
  mode.value = nextMode;
}

function applyTool(tool) {
  const textarea = editorField.value?.$el?.querySelector("textarea");
  if (!textarea) return;
  commitDraftHistory();
  const start = textarea.selectionStart ?? draft.value.length;
  const end = textarea.selectionEnd ?? start;
  const selected = draft.value.slice(start, end);
  let replacement;
  let selectionStart;
  let selectionEnd;

  if (tool.insert) {
    replacement = tool.insert;
    selectionStart = start + replacement.length;
    selectionEnd = selectionStart;
  } else if (tool.line) {
    const lineStart = draft.value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const lineEndIndex = draft.value.indexOf("\n", end);
    const lineEnd = lineEndIndex === -1 ? draft.value.length : lineEndIndex;
    const lines = draft.value.slice(lineStart, lineEnd);
    replacement = lines
      .split("\n")
      .map((line) => `${tool.prefix}${line}`)
      .join("\n");
    draft.value = `${draft.value.slice(0, lineStart)}${replacement}${draft.value.slice(lineEnd)}`;
    history.record(draft.value);
    selectionStart = lineStart + tool.prefix.length;
    selectionEnd = lineStart + replacement.length;
    nextTick(() => {
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
    return;
  } else {
    const body = selected || tool.sample;
    replacement = `${tool.before}${body}${tool.after}`;
    selectionStart = start + tool.before.length;
    selectionEnd = selectionStart + body.length;
  }

  draft.value = `${draft.value.slice(0, start)}${replacement}${draft.value.slice(end)}`;
  history.record(draft.value);
  nextTick(() => {
    textarea.focus();
    textarea.setSelectionRange(selectionStart, selectionEnd);
  });
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    :fullscreen="smAndDown"
    max-width="880"
    persistent
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card class="markdown-editor-card" color="surface" elevation="16">
      <v-toolbar class="editor-heading" color="transparent" density="comfortable">
        <v-icon class="ml-4" icon="mdi-book-edit-outline" color="primary" />
        <v-toolbar-title>日结 / 日记</v-toolbar-title>
        <v-btn icon="mdi-close" variant="text" aria-label="关闭编辑器" @click="close" />
      </v-toolbar>

      <v-divider />

      <v-card-text class="editor-body">
        <div class="editor-mode-row">
          <v-btn-toggle
            :model-value="mode"
            mandatory
            color="primary"
            density="compact"
            variant="outlined"
            @update:model-value="switchMode"
          >
            <v-btn value="edit" prepend-icon="mdi-pencil-outline">编辑</v-btn>
            <v-btn value="preview" prepend-icon="mdi-eye-outline">预览</v-btn>
          </v-btn-toggle>
        </div>

        <div class="editor-pane">
          <div class="markdown-toolbar" role="toolbar" aria-label="Markdown 格式工具">
            <v-tooltip
              v-for="tool in tools"
              :key="tool.key"
              :text="tool.label"
              content-class="markdown-editor-tooltip"
              location="top"
            >
              <template #activator="{ props: activatorProps }">
                <v-btn
                  v-bind="activatorProps"
                  :disabled="mode === 'preview'"
                  :icon="tool.icon"
                  :aria-label="tool.label"
                  size="40"
                  variant="text"
                  @click="applyTool(tool)"
                />
              </template>
            </v-tooltip>
          </div>

          <div class="markdown-input-surface">
            <v-textarea
              v-show="mode === 'edit'"
              ref="editorField"
              :model-value="draft"
              class="markdown-textarea"
              aria-label="Markdown 日记内容"
              auto-grow
              autofocus
              hide-details
              placeholder="在这里写下今天。可以使用标题、列表、引用、链接与代码……"
              rows="14"
              variant="plain"
              @keydown="onEditorKeydown"
              @update:model-value="updateDraft"
            />

            <div
              v-show="mode === 'preview'"
              class="markdown-preview"
              aria-label="Markdown 预览"
            >
              <MarkdownContent
                :source="draft"
                empty-text="还没有内容可预览"
              />
            </div>
          </div>
        </div>
      </v-card-text>

      <v-divider />

      <v-card-actions class="editor-actions px-4 py-3">
        <span class="text-caption text-medium-emphasis">{{ characterCount }} 字</span>
        <v-spacer />
        <v-btn min-height="44" variant="text" @click="close">取消</v-btn>
        <v-btn color="primary" min-height="44" prepend-icon="mdi-content-save-outline" variant="flat" @click="save">
          保存日记
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.markdown-editor-card {
  height: min(86dvh, 780px);
  border: 1px solid rgba(var(--v-theme-outline), 0.35);
  background-image: url("/assets/study-wash-bg.png");
  background-position: center top;
  background-size: cover;
}

:global(.v-theme--poeticNight) .markdown-editor-card {
  background-image: url("/assets/study-wash-bg-dark.png");
}

.editor-heading :deep(.v-toolbar-title) {
  font-size: 1.08rem;
  font-weight: 600;
  letter-spacing: 0.12em;
}

.editor-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 18px 20px;
}

.editor-mode-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.editor-hint {
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.76rem;
  letter-spacing: 0.08em;
}

.editor-pane {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.markdown-toolbar {
  display: flex;
  flex: 0 0 auto;
  gap: 2px;
  max-width: 100%;
  margin-bottom: 12px;
  padding: 5px;
  overflow-x: auto;
  border: 1px solid rgba(var(--v-theme-outline), 0.28);
  border-radius: 12px;
  background: rgba(var(--v-theme-surface), 0.86);
  scrollbar-width: thin;
}

.markdown-textarea {
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
}

.markdown-textarea :deep(.v-input__control),
.markdown-textarea :deep(.v-field) {
  height: 100%;
  min-height: 320px;
}

.markdown-input-surface {
  flex: 1 1 auto;
  min-height: 320px;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-outline), 0.62);
  border-radius: 6px;
  background: rgba(var(--v-theme-surface), 0.18);
  transition: border-color 120ms ease, box-shadow 120ms ease;
}

.markdown-input-surface:focus-within {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: inset 0 0 0 1px rgb(var(--v-theme-primary));
}

.markdown-textarea :deep(.v-field__input) {
  padding: 18px 22px;
}

.markdown-textarea :deep(textarea) {
  min-height: 300px;
  font-family: var(--app-font-family);
  font-size: 1rem;
  line-height: 1.9;
  resize: none;
}

.markdown-preview {
  height: 100%;
  min-height: 320px;
  overflow-y: auto;
  padding: 20px 22px;
}

.editor-actions {
  background: rgba(var(--v-theme-surface), 0.9);
}

:global(.markdown-editor-tooltip) {
  background: rgb(var(--v-theme-primary)) !important;
  color: rgb(var(--v-theme-on-primary)) !important;
  box-shadow: 0 5px 16px rgba(var(--v-theme-background), 0.32) !important;
  opacity: 1 !important;
}

@media (max-width: 600px) {
  .markdown-editor-card {
    width: 100%;
    height: 100dvh;
    border: 0;
    border-radius: 0;
  }

  .editor-body {
    padding: 12px;
  }

  .editor-mode-row {
    margin-bottom: 10px;
  }

  .markdown-toolbar {
    margin-bottom: 10px;
  }

  .markdown-textarea :deep(.v-input__control),
  .markdown-textarea :deep(.v-field) {
    min-height: 0;
  }

  .markdown-input-surface {
    min-height: 0;
  }

  .markdown-textarea :deep(textarea) {
    min-height: calc(100dvh - 330px);
  }

  .markdown-preview {
    min-height: calc(100dvh - 330px);
    padding: 16px;
  }
}
</style>
