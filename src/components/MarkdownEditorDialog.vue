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
  cloudDraft: {
    type: String,
    default: "",
  },
  minimalMode: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["update:modelValue", "save", "update:cloudDraft"]);
const { smAndDown } = useDisplay();
const draft = ref("");
const mode = ref("edit");
const editorField = ref(null);
const history = createUndoHistory();
let historyTimer;
let cloudDraftTimer;

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
const cloudDraftValue = computed(() => String(props.cloudDraft ?? ""));
const cloudDraftPending = computed(
  () => draft.value !== props.content && draft.value !== cloudDraftValue.value,
);
const cloudDraftCurrent = computed(
  () => Boolean(cloudDraftValue.value) && draft.value === cloudDraftValue.value,
);
const cloudDraftIcon = computed(() => {
  if (cloudDraftPending.value) return "mdi-cloud-upload-outline";
  if (cloudDraftCurrent.value) return "mdi-cloud-check-outline";
  return "mdi-cloud-outline";
});
const cloudDraftLabel = computed(() => {
  if (cloudDraftPending.value) return "立即保存到云草稿";
  if (cloudDraftCurrent.value) return "云草稿已更新";
  return "云草稿会在输入后自动保存";
});

watch(
  () => props.modelValue,
  (opened) => {
    if (!opened) return;
    clearHistoryTimer();
    clearCloudDraftTimer();
    const initialValue = cloudDraftValue.value || props.content;
    draft.value = initialValue;
    history.reset(initialValue);
    mode.value = "edit";
    nextTick(() => editorField.value?.$el?.querySelector("textarea")?.focus());
  },
);

watch(
  () => props.minimalMode,
  (minimalMode) => {
    if (minimalMode) mode.value = "edit";
  },
);

onBeforeUnmount(() => {
  clearHistoryTimer();
  clearCloudDraftTimer();
});

function clearHistoryTimer() {
  if (!historyTimer) return;
  clearTimeout(historyTimer);
  historyTimer = undefined;
}

function commitDraftHistory() {
  clearHistoryTimer();
  history.record(draft.value);
}

function clearCloudDraftTimer() {
  if (!cloudDraftTimer) return;
  clearTimeout(cloudDraftTimer);
  cloudDraftTimer = undefined;
}

function persistCloudDraft() {
  clearCloudDraftTimer();
  const value = draft.value === props.content ? "" : draft.value;
  if (value === cloudDraftValue.value) return;
  emit("update:cloudDraft", value);
}

function scheduleCloudDraft() {
  clearCloudDraftTimer();
  cloudDraftTimer = setTimeout(persistCloudDraft, 900);
}

function updateDraft(value) {
  draft.value = String(value ?? "");
  clearHistoryTimer();
  historyTimer = setTimeout(commitDraftHistory, 400);
  scheduleCloudDraft();
}

function restoreDraft(value) {
  clearHistoryTimer();
  draft.value = value;
  scheduleCloudDraft();
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
  persistCloudDraft();
  emit("update:modelValue", false);
}

function save() {
  commitDraftHistory();
  clearCloudDraftTimer();
  emit("save", draft.value);
  if (cloudDraftValue.value) emit("update:cloudDraft", "");
  emit("update:modelValue", false);
}

function switchMode(nextMode) {
  if (props.minimalMode || !nextMode) return;
  if (nextMode === "preview") {
    const textarea = editorField.value?.$el?.querySelector("textarea");
    if (textarea && textarea.value !== draft.value) updateDraft(textarea.value);
    commitDraftHistory();
  }
  mode.value = nextMode;
}

function applyTool(tool) {
  if (props.minimalMode) return;
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
    scheduleCloudDraft();
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
  scheduleCloudDraft();
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
    <v-card
      class="markdown-editor-card"
      :class="{ 'markdown-editor-card--minimal': minimalMode }"
      color="surface"
      elevation="16"
    >
      <v-toolbar class="editor-heading" color="transparent" density="comfortable">
        <v-icon class="ml-4" icon="mdi-book-edit-outline" color="primary" />
        <v-toolbar-title>日记</v-toolbar-title>
        <v-btn icon="mdi-close" variant="text" aria-label="关闭编辑器" @click="close" />
      </v-toolbar>

      <v-divider />

      <v-card-text class="editor-body">
        <div v-if="!minimalMode" class="editor-mode-row">
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
          <div
            v-if="!minimalMode"
            class="markdown-toolbar"
            role="toolbar"
            aria-label="Markdown 格式工具"
          >
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
            <v-tooltip
              v-if="!minimalMode"
              :text="cloudDraftLabel"
              content-class="markdown-editor-tooltip"
              location="top"
            >
              <template #activator="{ props: activatorProps }">
                <v-btn
                  v-bind="activatorProps"
                  class="cloud-draft-button"
                  :color="cloudDraftCurrent ? 'primary' : undefined"
                  :icon="cloudDraftIcon"
                  :aria-label="cloudDraftLabel"
                  size="40"
                  variant="tonal"
                  @click="persistCloudDraft"
                />
              </template>
            </v-tooltip>

            <v-textarea
              v-show="minimalMode || mode === 'edit'"
              ref="editorField"
              :model-value="draft"
              class="markdown-textarea"
              :aria-label="minimalMode ? '日记内容' : 'Markdown 日记内容'"
              auto-grow
              autofocus
              hide-details
              :placeholder="minimalMode
                ? '在这里写下今天……'
                : '在这里写下今天。可以使用标题、列表、引用、链接与代码……'"
              rows="14"
              variant="plain"
              @keydown="onEditorKeydown"
              @update:model-value="updateDraft"
            />

            <div
              v-if="!minimalMode && mode === 'preview'"
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
  position: relative;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}

.cloud-draft-button {
  position: absolute;
  right: 10px;
  top: 10px;
  z-index: 2;
}

.markdown-input-surface:focus-within {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: inset 0 0 0 1px rgb(var(--v-theme-primary));
}

.markdown-textarea :deep(.v-field__input) {
  padding: 18px 62px 18px 22px;
}

.markdown-editor-card--minimal .markdown-textarea :deep(.v-field__input) {
  padding-right: 22px;
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
  padding: 20px 62px 20px 22px;
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

  .editor-mode-row,
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

  .markdown-editor-card--minimal .markdown-textarea :deep(textarea) {
    min-height: calc(100dvh - 210px);
  }

  .markdown-preview {
    min-height: calc(100dvh - 330px);
    padding: 16px 56px 16px 16px;
  }

}
</style>
