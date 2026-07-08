<script setup lang="ts">
import { computed, nextTick, ref, reactive, watch } from "vue";
import { NButton, NInput, NSelect, NSpace, NText, NPopconfirm, NModal, NTabs, NTabPane, useMessage } from "naive-ui";
import type { FieldDef, ModuleDef, MessageDef, StructDef } from "@/generator/types";

const props = defineProps<{
  module: ModuleDef;
  focusMessageName?: string;
  focusTick?: number;
}>();
const emit = defineEmits<{ "changed": [mod: ModuleDef] }>();
const message = useMessage();

const BASE_FIELD_TYPES = [
  { label: "int", value: "int" },
  { label: "long", value: "long" },
  { label: "float", value: "float" },
  { label: "double", value: "double" },
  { label: "string", value: "string" },
  { label: "boolean", value: "boolean" },
];

const MSG_TYPES = [
  { label: "C2S", value: "C2S" },
  { label: "S2C", value: "S2C" },
  { label: "S2P", value: "S2P" },
  { label: "P2S", value: "P2S" },
];

function cloneModule(mod: ModuleDef): ModuleDef {
  return { structs: [], ...JSON.parse(JSON.stringify(mod)) };
}

// 本地可编辑副本
const edit = reactive<ModuleDef>(cloneModule(props.module));
let syncingFromProps = false;

const fieldTypeOptions = computed(() => [
  ...BASE_FIELD_TYPES,
  ...edit.structs
    .filter((struct) => struct.name.trim())
    .map((struct) => ({ label: struct.name, value: struct.name })),
]);

const FIELD_LIST_OPTIONS = [
  { label: "单个", value: "single" },
  { label: "List", value: "list" },
];

// 仅在切换文件时从 props 重新加载
watch(() => props.module.fileName, async () => {
  syncingFromProps = true;
  Object.assign(edit, cloneModule(props.module));
  await nextTick();
  syncingFromProps = false;
});

watch(
  edit,
  () => {
    if (!syncingFromProps) notify();
  },
  { deep: true, flush: "post" },
);

const expandedNames = ref<number[]>([]);
const expandedStructNames = ref<number[]>([]);
const activeEditorTab = ref<"structs" | "messages">("structs");
const rootRef = ref<HTMLElement | null>(null);
const focusedMessageIndex = ref<number | null>(null);
const showBatchFieldModal = ref(false);
const batchFieldText = ref("");
const batchFieldTarget = ref<MessageDef | null>(null);

function toggleExpand(index: number) {
  const pos = expandedNames.value.indexOf(index);
  if (pos >= 0) expandedNames.value.splice(pos, 1);
  else expandedNames.value.push(index);
}

function toggleStructExpand(index: number) {
  const pos = expandedStructNames.value.indexOf(index);
  if (pos >= 0) expandedStructNames.value.splice(pos, 1);
  else expandedStructNames.value.push(index);
}

function addMessage() {
  edit.messages.push({ id: 0, name: "", type: "C2S", desc: "", fields: [] });
  activeEditorTab.value = "messages";
  expandedNames.value.push(edit.messages.length - 1);
}

function removeMessage(index: number) {
  edit.messages.splice(index, 1);
}

function addField(msg: MessageDef) {
  msg.fields.push({ type: "int", name: "", desc: "" });
}

function addStruct() {
  edit.structs.push({ name: "", desc: "", fields: [] });
  activeEditorTab.value = "structs";
  expandedStructNames.value.push(edit.structs.length - 1);
}

function removeStruct(index: number) {
  edit.structs.splice(index, 1);
}

function addStructField(struct: StructDef) {
  struct.fields.push({ type: "int", name: "", desc: "" });
}

function removeField(target: MessageDef | StructDef, index: number) {
  target.fields.splice(index, 1);
}

function notify() {
  emit("changed", JSON.parse(JSON.stringify(edit)));
}

function parseListElementType(type: string): string | null {
  const clean = type.trim();
  const angleMatch = clean.match(/^(?:array|list|java\.util\.List)<(.+)>$/i);
  if (angleMatch) return angleMatch[1].trim();
  const bracketMatch = clean.match(/^(.+)\[\]$/);
  if (bracketMatch) return bracketMatch[1].trim();
  return null;
}

function normalizeTypeName(type: string): string {
  const clean = type
    .trim()
    .replace(/^java\.lang\./i, "")
    .replace(/\s+/g, "");
  const map: Record<string, string> = {
    integer: "int",
    int: "int",
    long: "long",
    float: "float",
    double: "double",
    string: "string",
    boolean: "boolean",
    bool: "boolean",
    short: "short",
    byte: "byte",
  };
  return map[clean.toLowerCase()] ?? clean;
}

function baseFieldType(type: string): string {
  return normalizeTypeName(parseListElementType(type) ?? type);
}

function isListField(type: string): boolean {
  return parseListElementType(type) !== null;
}

function setFieldBaseType(field: FieldDef, type: string) {
  const nextType = normalizeTypeName(type);
  field.type = isListField(field.type) ? `array<${nextType}>` : nextType;
}

function setFieldListMode(field: FieldDef, mode: string) {
  const nextType = baseFieldType(field.type);
  field.type = mode === "list" ? `array<${nextType}>` : nextType;
}

function normalizeJavaFieldType(type: string): string {
  const elementType = parseListElementType(type);
  if (elementType) {
    return `array<${normalizeTypeName(elementType)}>`;
  }
  return normalizeTypeName(type);
}

function parseBatchFields(text: string): FieldDef[] {
  const fields: FieldDef[] = [];
  let pendingDesc = "";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const commentMatch = line.match(/^\/\/\s*(.*)$/);
    if (commentMatch) {
      pendingDesc = commentMatch[1].trim();
      continue;
    }

    const fieldMatch = line.match(/^(?:private|public|protected)?\s*(?:static\s+)?(?:final\s+)?([\w.<>[\]]+)\s+(\w+)\s*;/);
    if (!fieldMatch) continue;

    fields.push({
      type: normalizeJavaFieldType(fieldMatch[1]),
      name: fieldMatch[2],
      desc: pendingDesc,
    });
    pendingDesc = "";
  }
  return fields;
}

function openBatchFieldModal(msg: MessageDef) {
  batchFieldTarget.value = msg;
  batchFieldText.value = "";
  showBatchFieldModal.value = true;
}

function handleBatchAddFields() {
  const target = batchFieldTarget.value;
  if (!target) return;
  const fields = parseBatchFields(batchFieldText.value);
  if (fields.length === 0) {
    message.warning("未解析到字段，请检查格式");
    return;
  }
  target.fields.push(...fields);
  showBatchFieldModal.value = false;
  message.success(`已添加 ${fields.length} 个字段`);
}

async function focusMessageByName(name: string) {
  const index = edit.messages.findIndex((msg) => msg.name === name);
  if (index < 0) return;
  if (!expandedNames.value.includes(index)) {
    expandedNames.value.push(index);
  }
  activeEditorTab.value = "messages";
  focusedMessageIndex.value = index;
  await nextTick();
  const card = rootRef.value?.querySelector<HTMLElement>(`.msg-card[data-message-index="${index}"]`);
  card?.scrollIntoView({ behavior: "smooth", block: "center" });
  card?.querySelector<HTMLInputElement>("input")?.focus();
  window.setTimeout(() => {
    if (focusedMessageIndex.value === index) {
      focusedMessageIndex.value = null;
    }
  }, 1200);
}

watch(
  () => props.focusTick,
  () => {
    if (props.focusMessageName) {
      focusMessageByName(props.focusMessageName);
    }
  },
);
</script>

<template>
  <div ref="rootRef" class="msg-editor">
    <div class="editor-section">
      <n-space align="center" :size="12">
        <n-text depth="3" style="font-size:12px;white-space:nowrap">模块名</n-text>
        <n-input v-model:value="edit.moduleName" size="small" style="width:140px" />
        <n-text depth="3" style="font-size:12px;white-space:nowrap">描述</n-text>
        <n-input v-model:value="edit.desc" size="small" style="flex:1" placeholder="模块描述" />
      </n-space>
    </div>

    <div class="editor-section msg-list-section">
      <n-tabs v-model:value="activeEditorTab" type="line" animated class="editor-tabs">
        <template #suffix>
          <n-button
            v-if="activeEditorTab === 'structs'"
            size="tiny"
            type="primary"
            @click="addStruct"
          >
            + 添加对象
          </n-button>
          <n-button
            v-else
            size="tiny"
            type="primary"
            @click="addMessage"
          >
            + 添加消息
          </n-button>
        </template>

        <n-tab-pane name="structs" :tab="`对象（${edit.structs.length}）`">
          <div class="tab-list">
            <div v-if="edit.structs.length === 0" class="editor-empty">
              <n-text depth="3">暂无对象，可按需添加 Struct</n-text>
            </div>

            <div
              v-for="(struct, si) in edit.structs"
              :key="si"
              class="msg-card struct-card"
            >
              <div class="msg-header" :class="{ expanded: expandedStructNames.includes(si) }" @click="toggleStructExpand(si)">
                <span class="msg-expand-icon">{{ expandedStructNames.includes(si) ? '▼' : '▶' }}</span>
                <n-input v-model:value="struct.name" size="tiny" style="width:220px;font-family:monospace" placeholder="对象名" @click.stop />
                <n-input v-model:value="struct.desc" size="tiny" style="flex:1" placeholder="描述" @click.stop />
                <n-popconfirm @positive-click="removeStruct(si)">
                  <template #trigger>
                    <n-button size="tiny" type="error" text @click.stop style="min-width:20px">✕</n-button>
                  </template>
                  确定删除此对象？
                </n-popconfirm>
              </div>

              <div v-if="expandedStructNames.includes(si)" class="msg-fields">
                <div v-for="(f, fi) in struct.fields" :key="fi" class="field-row">
                  <n-select
                    :value="baseFieldType(f.type)"
                    :options="fieldTypeOptions"
                    tag
                    size="tiny"
                    style="width:140px"
                    @update:value="setFieldBaseType(f, String($event))"
                  />
                  <n-input v-model:value="f.name" size="tiny" style="width:160px;font-family:monospace" placeholder="字段名" />
                  <n-select
                    :value="isListField(f.type) ? 'list' : 'single'"
                    :options="FIELD_LIST_OPTIONS"
                    size="tiny"
                    style="width:86px"
                    @update:value="setFieldListMode(f, String($event))"
                  />
                  <n-input v-model:value="f.desc" size="tiny" style="flex:1" placeholder="描述" />
                  <n-button class="field-delete-btn" size="tiny" text @click="removeField(struct, fi)">✕</n-button>
                </div>
                <div class="field-actions">
                  <n-button size="tiny" dashed @click="addStructField(struct)">+ 添加字段</n-button>
                </div>
              </div>
            </div>
          </div>
        </n-tab-pane>

        <n-tab-pane name="messages" :tab="`消息（${edit.messages.length}）`">
          <div class="tab-list">
            <div v-if="edit.messages.length === 0" class="editor-empty">
              <n-text depth="3">暂无消息，点击「添加消息」开始</n-text>
            </div>

            <div
              v-for="(msg, mi) in edit.messages"
              :key="mi"
              class="msg-card"
              :class="{ focused: focusedMessageIndex === mi }"
              :data-message-index="mi"
            >
              <div class="msg-header" :class="{ expanded: expandedNames.includes(mi) }" @click="toggleExpand(mi)">
                <span class="msg-expand-icon">{{ expandedNames.includes(mi) ? '▼' : '▶' }}</span>
                <n-input v-model:value="msg.name" size="tiny" style="width:200px;font-family:monospace" placeholder="消息名" @click.stop />
                <n-select v-model:value="msg.type" :options="MSG_TYPES" size="tiny" style="width:80px" @click.stop />
                <n-input v-model:value="msg.desc" size="tiny" style="flex:1" placeholder="描述" @click.stop />
                <n-popconfirm @positive-click="removeMessage(mi)">
                  <template #trigger>
                    <n-button size="tiny" type="error" text @click.stop style="min-width:20px">✕</n-button>
                  </template>
                  确定删除此消息？
                </n-popconfirm>
              </div>

              <div v-if="expandedNames.includes(mi)" class="msg-fields">
                <div v-for="(f, fi) in msg.fields" :key="fi" class="field-row">
                  <n-select
                    :value="baseFieldType(f.type)"
                    :options="fieldTypeOptions"
                    tag
                    size="tiny"
                    style="width:140px"
                    @update:value="setFieldBaseType(f, String($event))"
                  />
                  <n-input v-model:value="f.name" size="tiny" style="width:160px;font-family:monospace" placeholder="字段名" />
                  <n-select
                    :value="isListField(f.type) ? 'list' : 'single'"
                    :options="FIELD_LIST_OPTIONS"
                    size="tiny"
                    style="width:86px"
                    @update:value="setFieldListMode(f, String($event))"
                  />
                  <n-input v-model:value="f.desc" size="tiny" style="flex:1" placeholder="描述" />
                  <n-button class="field-delete-btn" size="tiny" text @click="removeField(msg, fi)">✕</n-button>
                </div>
                <div class="field-actions">
                  <n-button size="tiny" dashed @click="addField(msg)">+ 添加字段</n-button>
                  <n-button size="tiny" dashed @click="openBatchFieldModal(msg)">批量添加字段</n-button>
                </div>
              </div>
            </div>
          </div>
        </n-tab-pane>
      </n-tabs>
    </div>

    <n-modal v-model:show="showBatchFieldModal" preset="card" title="批量添加字段" style="width: 680px">
      <n-space vertical :size="12">
        <n-input
          v-model:value="batchFieldText"
          type="textarea"
          :rows="18"
          placeholder="// 账号ID&#10;private String accountId;&#10;&#10;// 平台ID&#10;private int webId;"
          style="font-family:monospace;font-size:12px"
        />
      </n-space>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showBatchFieldModal = false">取消</n-button>
          <n-button type="primary" @click="handleBatchAddFields">添加</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.msg-editor { display:flex; flex-direction:column; height:100%; overflow:hidden; padding:12px; }
.editor-section { flex-shrink:0; margin-bottom:16px; }
.editor-empty { text-align:center; color:var(--text-muted); padding:24px 0; }
.msg-list-section { flex:1; min-height:0; overflow:hidden; margin-bottom:0; }
.editor-tabs { height:100%; display:flex; flex-direction:column; }
.editor-tabs :deep(.n-tabs-nav) { flex-shrink:0; }
.editor-tabs :deep(.n-tab-pane) { height:100%; min-height:0; }
.editor-tabs :deep(.n-tabs-pane-wrapper) { flex:1; min-height:0; }
.tab-list { height:100%; overflow-y:auto; padding-right:4px; }
.msg-card { border:1px solid var(--border-subtle); border-radius:6px; margin-bottom:6px; overflow:hidden; transition:border-color .16s, box-shadow .16s; }
.struct-card { border-color:var(--brand-active); }
.msg-card.focused { border-color:var(--brand); box-shadow:0 0 0 1px var(--brand-soft); }
.msg-header { display:flex; align-items:center; gap:6px; padding:6px 8px; cursor:pointer; background:var(--bg-panel); }
.msg-header:hover { background:var(--bg-panel-hover); }
.msg-header.expanded { background:var(--bg-input); border-bottom:1px solid var(--border-subtle); }
.msg-expand-icon { font-size:10px; color:var(--text-muted); width:14px; text-align:center; flex-shrink:0; }
.msg-fields { padding:6px 8px 8px 28px; background:var(--bg-app); }
.field-row { display:flex; align-items:center; gap:6px; margin-bottom:4px; }
.field-actions { display:flex; gap:8px; margin-top:4px; }
.field-delete-btn { min-width:20px; color:var(--danger); }
</style>
