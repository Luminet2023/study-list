<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useDisplay } from "vuetify";

import { countMarkdownCharacters } from "../lib/markdown.js";
import { createUndoHistory } from "../lib/undoHistory.js";

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
});

const emit = defineEmits(["update:modelValue", "save", "update:cloudDraft"]);
const { smAndDown } = useDisplay();
const draft = ref("");
const editorField = ref(null);
const history = createUndoHistory();
let historyTimer;
let cloudDraftTimer;

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
    nextTick(() => editorField.value?.$el?.querySelector("textarea")?.focus());
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
        <v-toolbar-title>日记</v-toolbar-title>
        <v-btn icon="mdi-close" variant="text" aria-label="关闭编辑器" @click="close" />
      </v-toolbar>

      <v-divider />

      <v-card-text class="editor-body">
        <div class="editor-pane">
          <div class="markdown-input-surface">
            <v-tooltip
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
              ref="editorField"
              :model-value="draft"
              class="markdown-textarea"
              aria-label="日记内容"
              auto-grow
              autofocus
              hide-details
              placeholder="在这里写下今天……"
              rows="14"
              variant="plain"
              @keydown="onEditorKeydown"
              @update:model-value="updateDraft"
            />
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

.editor-pane {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
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

.markdown-textarea :deep(textarea) {
  min-height: 300px;
  font-family: var(--app-font-family);
  font-size: 1rem;
  line-height: 1.9;
  resize: none;
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

  .markdown-textarea :deep(.v-input__control),
  .markdown-textarea :deep(.v-field) {
    min-height: 0;
  }

  .markdown-input-surface {
    min-height: 0;
  }

  .markdown-textarea :deep(textarea) {
    min-height: calc(100dvh - 210px);
  }

}
</style>
