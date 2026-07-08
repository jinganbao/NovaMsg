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

const activeEditorTab = ref<"structs" | "messages">("messages");
const selectedStructIndex = ref(0);
const selectedMessageIndex = ref(0);
const structSearch = ref("");
const messageSearch = ref("");
const messageTypeFilter = ref("ALL");
const expandedNames = ref<number[]>(edit.messages.length > 0 ? [0] : []);
const expandedStructNames = ref<number[]>(edit.structs.length > 0 ? [0] : []);
const rootRef = ref<HTMLElement | null>(null);
const focusedMessageIndex = ref<number | null>(null);
const showBatchFieldModal = ref(false);
const batchFieldText = ref("");
const batchFieldTarget = ref<MessageDef | null>(null);

const selectedStruct = computed(() => edit.structs[selectedStructIndex.value] ?? null);
const selectedMessage = computed(() => edit.messages[selectedMessageIndex.value] ?? null);
const messageTypeFilterOptions = computed(() => [
  { label: "全部", value: "ALL" },
  ...MSG_TYPES,
]);
const filteredStructs = computed(() => {
  const keyword = structSearch.value.trim().toLowerCase();
  return edit.structs
    .map((struct, index) => ({ struct, index }))
    .filter(({ struct }) => {
      if (!keyword) return true;
      return struct.name.toLowerCase().includes(keyword) || (struct.desc ?? "").toLowerCase().includes(keyword);
    });
});
const filteredMessages = computed(() => {
  const keyword = messageSearch.value.trim().toLowerCase();
  return edit.messages
    .map((msg, index) => ({ msg, index }))
    .filter(({ msg }) => {
      const typeMatched = messageTypeFilter.value === "ALL" || msg.type === messageTypeFilter.value;
      if (!typeMatched) return false;
      if (!keyword) return true;
      return msg.name.toLowerCase().includes(keyword) || (msg.desc ?? "").toLowerCase().includes(keyword);
    });
});
const structNameSet = computed(() => new Set(edit.structs.map((struct) => struct.name.trim()).filter(Boolean)));
const primitiveTypeSet = new Set(BASE_FIELD_TYPES.map((item) => item.value));

function normalizeSelection() {
  selectedStructIndex.value = edit.structs.length === 0
    ? 0
    : Math.min(selectedStructIndex.value, edit.structs.length - 1);
  selectedMessageIndex.value = edit.messages.length === 0
    ? 0
    : Math.min(selectedMessageIndex.value, edit.messages.length - 1);
}

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

async function scrollStructIntoView(index: number) {
  selectedStructIndex.value = index;
  if (!expandedStructNames.value.includes(index)) {
    expandedStructNames.value.push(index);
  }
  await nextTick();
  rootRef.value
    ?.querySelector<HTMLElement>(`.struct-card[data-struct-index="${index}"]`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function scrollMessageIntoView(index: number) {
  selectedMessageIndex.value = index;
  if (!expandedNames.value.includes(index)) {
    expandedNames.value.push(index);
  }
  focusedMessageIndex.value = index;
  await nextTick();
  rootRef.value
    ?.querySelector<HTMLElement>(`.msg-card[data-message-index="${index}"]`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => {
    if (focusedMessageIndex.value === index) {
      focusedMessageIndex.value = null;
    }
  }, 1200);
}

function addMessage() {
  edit.messages.push({ id: 0, name: "", type: "C2S", desc: "", fields: [] });
  activeEditorTab.value = "messages";
  selectedMessageIndex.value = edit.messages.length - 1;
  expandedNames.value = [selectedMessageIndex.value];
}

function removeMessage(index: number) {
  edit.messages.splice(index, 1);
  normalizeSelection();
  expandedNames.value = edit.messages.length > 0 ? [selectedMessageIndex.value] : [];
}

function addField(msg: MessageDef) {
  msg.fields.push({ type: "int", name: "", desc: "" });
}

function addStruct() {
  edit.structs.push({ name: "", desc: "", fields: [] });
  activeEditorTab.value = "structs";
  selectedStructIndex.value = edit.structs.length - 1;
  expandedStructNames.value = [selectedStructIndex.value];
}

function removeStruct(index: number) {
  edit.structs.splice(index, 1);
  normalizeSelection();
  expandedStructNames.value = edit.structs.length > 0 ? [selectedStructIndex.value] : [];
}

function addStructField(struct: StructDef) {
  struct.fields.push({ type: "int", name: "", desc: "" });
}

function removeField(target: MessageDef | StructDef, index: number) {
  target.fields.splice(index, 1);
}

function moveField(target: MessageDef | StructDef, index: number, direction: -1 | 1) {
  const next = index + direction;
  if (next < 0 || next >= target.fields.length) return;
  const [field] = target.fields.splice(index, 1);
  target.fields.splice(next, 0, field);
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

function getFieldTypeLabel(field: FieldDef): string {
  const base = baseFieldType(field.type);
  return isListField(field.type) ? `List<${base}>` : base;
}

function duplicateFieldNames(fields: FieldDef[]): Set<string> {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const field of fields) {
    const name = field.name.trim();
    if (!name) continue;
    if (seen.has(name)) duplicated.add(name);
    seen.add(name);
  }
  return duplicated;
}

function isDuplicateField(target: MessageDef | StructDef, field: FieldDef): boolean {
  return duplicateFieldNames(target.fields).has(field.name.trim());
}

function isUnknownFieldType(field: FieldDef): boolean {
  const base = baseFieldType(field.type);
  return !!base && !primitiveTypeSet.has(base) && !structNameSet.value.has(base);
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
  activeEditorTab.value = "messages";
  selectedMessageIndex.value = index;
  expandedNames.value = [index];
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

watch(() => props.module.fileName, () => {
  selectedStructIndex.value = 0;
  selectedMessageIndex.value = 0;
  expandedStructNames.value = edit.structs.length > 0 ? [0] : [];
  expandedNames.value = edit.messages.length > 0 ? [0] : [];
}, { flush: "post" });

watch(() => [edit.structs.length, edit.messages.length], () => {
  normalizeSelection();
  if (edit.structs.length > 0 && expandedStructNames.value.length === 0) {
    expandedStructNames.value = [selectedStructIndex.value];
  }
  if (edit.messages.length > 0 && expandedNames.value.length === 0) {
    expandedNames.value = [selectedMessageIndex.value];
  }
});

watch(filteredStructs, (items) => {
  if (items.length > 0 && !items.some((item) => item.index === selectedStructIndex.value)) {
    selectedStructIndex.value = items[0].index;
    expandedStructNames.value = [items[0].index];
  }
});

watch(filteredMessages, (items) => {
  if (items.length > 0 && !items.some((item) => item.index === selectedMessageIndex.value)) {
    selectedMessageIndex.value = items[0].index;
    expandedNames.value = [items[0].index];
  }
});
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
            v-if="activeEditorTab === 'messages'"
            size="tiny"
            type="primary"
            @click="addMessage"
          >
            + 添加消息
          </n-button>
          <n-button
            v-else
            size="tiny"
            type="primary"
            @click="addStruct"
          >
            + 添加对象
          </n-button>
        </template>

        <n-tab-pane name="messages" :tab="`消息（${edit.messages.length}）`">
          <div class="tab-workspace">
            <div class="entity-index">
              <n-input
                v-model:value="messageSearch"
                size="tiny"
                clearable
                placeholder="搜索消息"
                class="entity-search"
              />
              <n-select
                v-model:value="messageTypeFilter"
                :options="messageTypeFilterOptions"
                size="tiny"
                class="entity-filter"
              />
              <button
                v-for="{ msg, index: mi } in filteredMessages"
                :key="mi"
                class="entity-index-item"
                :class="{ active: selectedMessageIndex === mi }"
                type="button"
                @click="scrollMessageIntoView(mi)"
              >
                <span>{{ msg.name || '未命名消息' }}</span>
                <small>{{ msg.type }}</small>
              </button>
              <div v-if="edit.messages.length > 0 && filteredMessages.length === 0" class="entity-empty">无匹配消息</div>
            </div>
            <div class="tab-list">
              <div v-if="edit.messages.length === 0" class="editor-empty">
                <n-text depth="3">暂无消息，点击「添加消息」开始</n-text>
              </div>

              <div
                v-if="selectedMessage"
                class="msg-card"
                :class="{ focused: focusedMessageIndex === selectedMessageIndex }"
                :data-message-index="selectedMessageIndex"
              >
              <div class="msg-header" :class="{ expanded: expandedNames.includes(selectedMessageIndex) }" @click="toggleExpand(selectedMessageIndex)">
                <span class="msg-expand-icon">{{ expandedNames.includes(selectedMessageIndex) ? '▼' : '▶' }}</span>
                <n-input v-model:value="selectedMessage.name" size="tiny" style="width:200px;font-family:monospace" placeholder="消息名" @click.stop />
                <n-select v-model:value="selectedMessage.type" :options="MSG_TYPES" size="tiny" style="width:80px" @click.stop />
                <n-input v-model:value="selectedMessage.desc" size="tiny" style="flex:1" placeholder="描述" @click.stop />
                <n-popconfirm @positive-click="removeMessage(selectedMessageIndex)">
                  <template #trigger>
                    <n-button size="tiny" type="error" text @click.stop style="min-width:20px">✕</n-button>
                  </template>
                  确定删除此消息？
                </n-popconfirm>
              </div>

              <div v-if="expandedNames.includes(selectedMessageIndex)" class="msg-fields">
                <div class="field-row field-row--head">
                  <span>类型</span>
                  <span>字段名</span>
                  <span>集合</span>
                  <span>描述</span>
                  <span>操作</span>
                </div>
                <div
                  v-for="(f, fi) in selectedMessage.fields"
                  :key="fi"
                  class="field-row"
                  :class="{ invalid: isDuplicateField(selectedMessage, f) || isUnknownFieldType(f) }"
                >
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
                  <div class="field-row-actions">
                    <n-button size="tiny" text :disabled="fi === 0" @click="moveField(selectedMessage, fi, -1)">↑</n-button>
                    <n-button size="tiny" text :disabled="fi === selectedMessage.fields.length - 1" @click="moveField(selectedMessage, fi, 1)">↓</n-button>
                    <n-button class="field-delete-btn" size="tiny" text @click="removeField(selectedMessage, fi)">✕</n-button>
                  </div>
                  <div v-if="isDuplicateField(selectedMessage, f) || isUnknownFieldType(f)" class="field-warning">
                    <span v-if="isDuplicateField(selectedMessage, f)">字段名重复</span>
                    <span v-if="isUnknownFieldType(f)">未知类型 {{ getFieldTypeLabel(f) }}</span>
                  </div>
                </div>
                <div class="field-actions">
                  <n-button size="tiny" dashed @click="addField(selectedMessage)">+ 添加字段</n-button>
                  <n-button size="tiny" dashed @click="openBatchFieldModal(selectedMessage)">批量添加字段</n-button>
                </div>
              </div>
            </div>
            </div>
          </div>
        </n-tab-pane>

        <n-tab-pane name="structs" :tab="`对象（${edit.structs.length}）`">
          <div class="tab-workspace">
            <div class="entity-index">
              <n-input
                v-model:value="structSearch"
                size="tiny"
                clearable
                placeholder="搜索对象"
                class="entity-search"
              />
              <button
                v-for="{ struct, index: si } in filteredStructs"
                :key="si"
                class="entity-index-item"
                :class="{ active: selectedStructIndex === si }"
                type="button"
                @click="scrollStructIntoView(si)"
              >
                <span>{{ struct.name || '未命名对象' }}</span>
                <small>{{ struct.fields.length }}</small>
              </button>
              <div v-if="edit.structs.length > 0 && filteredStructs.length === 0" class="entity-empty">无匹配对象</div>
            </div>
            <div class="tab-list">
              <div v-if="edit.structs.length === 0" class="editor-empty">
                <n-text depth="3">暂无对象，可按需添加 Struct</n-text>
              </div>

              <div
                v-if="selectedStruct"
                class="msg-card struct-card"
                :data-struct-index="selectedStructIndex"
              >
              <div class="msg-header" :class="{ expanded: expandedStructNames.includes(selectedStructIndex) }" @click="toggleStructExpand(selectedStructIndex)">
                <span class="msg-expand-icon">{{ expandedStructNames.includes(selectedStructIndex) ? '▼' : '▶' }}</span>
                <n-input v-model:value="selectedStruct.name" size="tiny" style="width:220px;font-family:monospace" placeholder="对象名" @click.stop />
                <n-input v-model:value="selectedStruct.desc" size="tiny" style="flex:1" placeholder="描述" @click.stop />
                <n-popconfirm @positive-click="removeStruct(selectedStructIndex)">
                  <template #trigger>
                    <n-button size="tiny" type="error" text @click.stop style="min-width:20px">✕</n-button>
                  </template>
                  确定删除此对象？
                </n-popconfirm>
              </div>

              <div v-if="expandedStructNames.includes(selectedStructIndex)" class="msg-fields">
                <div class="field-row field-row--head">
                  <span>类型</span>
                  <span>字段名</span>
                  <span>集合</span>
                  <span>描述</span>
                  <span>操作</span>
                </div>
                <div
                  v-for="(f, fi) in selectedStruct.fields"
                  :key="fi"
                  class="field-row"
                  :class="{ invalid: isDuplicateField(selectedStruct, f) || isUnknownFieldType(f) }"
                >
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
                  <div class="field-row-actions">
                    <n-button size="tiny" text :disabled="fi === 0" @click="moveField(selectedStruct, fi, -1)">↑</n-button>
                    <n-button size="tiny" text :disabled="fi === selectedStruct.fields.length - 1" @click="moveField(selectedStruct, fi, 1)">↓</n-button>
                    <n-button class="field-delete-btn" size="tiny" text @click="removeField(selectedStruct, fi)">✕</n-button>
                  </div>
                  <div v-if="isDuplicateField(selectedStruct, f) || isUnknownFieldType(f)" class="field-warning">
                    <span v-if="isDuplicateField(selectedStruct, f)">字段名重复</span>
                    <span v-if="isUnknownFieldType(f)">未知类型 {{ getFieldTypeLabel(f) }}</span>
                  </div>
                </div>
                <div class="field-actions">
                  <n-button size="tiny" dashed @click="addStructField(selectedStruct)">+ 添加字段</n-button>
                </div>
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
.tab-workspace { height:100%; min-height:0; display:grid; grid-template-columns:180px minmax(0, 1fr); gap:10px; }
.entity-index { min-height:0; overflow-y:auto; border:1px solid var(--border-subtle); border-radius:6px; background:var(--bg-panel); padding:6px; }
.entity-search { margin-bottom:6px; }
.entity-filter { margin-bottom:8px; }
.entity-empty { padding:12px 8px; color:var(--text-muted); font-size:12px; text-align:center; }
.entity-index-item { width:100%; min-height:28px; border:0; border-radius:4px; background:transparent; color:var(--text-secondary); display:flex; align-items:center; justify-content:space-between; gap:8px; padding:0 8px; cursor:pointer; font-size:12px; text-align:left; }
.entity-index-item:hover { background:var(--bg-panel-hover); color:var(--text-primary); }
.entity-index-item.active { background:var(--brand-soft); color:var(--brand); }
.entity-index-item span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.entity-index-item small { color:var(--text-muted); font-size:11px; flex-shrink:0; }
.entity-index-item.active small { color:var(--brand); }
.tab-list { height:100%; overflow-y:auto; padding-right:4px; }
.msg-card { border:1px solid var(--border-subtle); border-radius:6px; margin-bottom:6px; overflow:hidden; transition:border-color .16s, box-shadow .16s; }
.struct-card { border-color:var(--brand-active); }
.msg-card.focused { border-color:var(--brand); box-shadow:0 0 0 1px var(--brand-soft); }
.msg-header { display:flex; align-items:center; gap:6px; padding:6px 8px; cursor:pointer; background:var(--bg-panel); }
.msg-header:hover { background:var(--bg-panel-hover); }
.msg-header.expanded { background:var(--bg-input); border-bottom:1px solid var(--border-subtle); }
.msg-expand-icon { font-size:10px; color:var(--text-muted); width:14px; text-align:center; flex-shrink:0; }
.msg-fields { padding:6px 8px 8px 28px; background:var(--bg-app); }
.field-row { display:grid; grid-template-columns:140px 160px 86px minmax(160px, 1fr) 78px; align-items:center; gap:6px; margin-bottom:4px; }
.field-row:hover:not(.field-row--head) { background:var(--bg-panel); }
.field-row.invalid { border-left:2px solid var(--warning); padding-left:4px; }
.field-row--head { color:var(--text-muted); font-size:11px; padding:0 2px 4px; }
.field-row-actions { display:flex; align-items:center; justify-content:flex-end; gap:2px; }
.field-warning { grid-column:1 / -1; display:flex; gap:8px; color:var(--warning); font-size:11px; padding:0 0 2px 2px; }
.field-actions { display:flex; gap:8px; margin-top:4px; }
.field-delete-btn { min-width:20px; color:var(--danger); }
</style>
