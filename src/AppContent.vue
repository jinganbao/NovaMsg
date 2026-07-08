<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import {
  NButton,
  NSpace,
  NInput,
  NText,
  NModal,
  NSpin,
  useMessage,
} from "naive-ui";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile, readDir, writeTextFile, remove, rename } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { parseXmlFiles } from "@/utils/xmlParser";
import { moduleToXml } from "@/utils/xmlSerializer";
import { generateProtocols, previewProtocols } from "@/generator";
import type { GenerateOptions, ModuleDef } from "@/generator/types";
import type { PreviewFile } from "@/generator";
import { useConfig } from "@/composables/useConfig";
import MessageEditor from "@/components/MessageEditor.vue";
import { Codemirror } from "vue-codemirror-next";
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { xml } from "@codemirror/lang-xml";
import { oneDark } from "@codemirror/theme-one-dark";

const message = useMessage();

/** 安全提取错误消息 */
function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e ?? "未知错误");
}

const parsedModules = ref<ModuleDef[]>([]);
const parsing = ref(false);

// ---------- 新建 XML 文件 ----------
function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getModuleNameFromFileName(fileName: string): string {
  const trimmed = fileName.trim();
  return trimmed.endsWith(".xml") ? trimmed.slice(0, -4) : trimmed;
}

function createEmptyXmlContent(moduleName: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Module moduleName="${escapeXmlAttr(moduleName)}">
</Module>`;
}

const showNewFileModal = ref(false);
const newFileName = ref("");
const creatingFile = ref(false);

function openNewFileModal() {
  if (!config.xmlPath) {
    message.warning("请先在配置中设置 XML 目录");
    return;
  }
  newFileName.value = "";
  showNewFileModal.value = true;
}

async function handleCreateNewFile() {
  let name = newFileName.value.trim();
  if (!name) {
    message.warning("请输入文件名");
    return;
  }
  if (!name.endsWith(".xml")) {
    name += ".xml";
  }
  const moduleName = getModuleNameFromFileName(name);
  const content = createEmptyXmlContent(moduleName);
  const sep = config.xmlPath.endsWith("/") ? "" : "/";
  const filePath = `${config.xmlPath}${sep}${name}`;

  creatingFile.value = true;
  try {
    try {
      await readTextFile(filePath);
      message.warning(`文件 ${name} 已存在，请更换文件名`);
      return;
    } catch {
      // 文件不存在，可以创建
    }
    await writeTextFile(filePath, content);
    showNewFileModal.value = false;
    message.success(`已创建 ${name}`);
    await loadXmlFromDirectory(config.xmlPath);
  } catch (e) {
    message.error("创建文件失败: " + errMsg(e));
  } finally {
    creatingFile.value = false;
  }
}

// ---------- 右键菜单 & 重命名 / 删除 ----------
const showContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuFile = ref<string | null>(null);

const showRenameModal = ref(false);
const renameFileName = ref("");
const renamingFile = ref(false);

const showDeleteModal = ref(false);
const deletingFile = ref(false);
const showClearIdsModal = ref(false);
const clearingMessageIds = ref(false);

function onFileContextMenu(e: MouseEvent, fileName: string) {
  e.preventDefault();
  contextMenuFile.value = fileName;
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  showContextMenu.value = true;
}

function closeContextMenu() {
  showContextMenu.value = false;
}

function onCtxMenuRename() {
  const fileName = contextMenuFile.value;
  closeContextMenu();
  if (!fileName) return;
  renameFileName.value = fileName.endsWith(".xml") ? fileName.slice(0, -4) : fileName;
  showRenameModal.value = true;
}

function onCtxMenuDelete() {
  closeContextMenu();
  if (!contextMenuFile.value) return;
  showDeleteModal.value = true;
}

async function handleRenameFile() {
  const oldName = contextMenuFile.value;
  let newName = renameFileName.value.trim();
  if (!newName || !oldName) return;
  if (!newName.endsWith(".xml")) {
    newName += ".xml";
  }
  if (newName === oldName) {
    showRenameModal.value = false;
    return;
  }
  const sep = config.xmlPath.endsWith("/") ? "" : "/";
  const oldPath = `${config.xmlPath}${sep}${oldName}`;
  const newPath = `${config.xmlPath}${sep}${newName}`;

  renamingFile.value = true;
  try {
    await rename(oldPath, newPath);
    showRenameModal.value = false;
    message.success(`已重命名为 ${newName}`);
    if (activeFile.value === oldName) {
      activeFile.value = newName;
    }
    await loadXmlFromDirectory(config.xmlPath);
  } catch (e) {
    message.error("重命名失败: " + errMsg(e));
  } finally {
    renamingFile.value = false;
  }
}

async function handleDeleteFile() {
  const fileName = contextMenuFile.value;
  if (!fileName) return;
  const sep = config.xmlPath.endsWith("/") ? "" : "/";
  const filePath = `${config.xmlPath}${sep}${fileName}`;

  deletingFile.value = true;
  try {
    await remove(filePath);
    showDeleteModal.value = false;
    message.success(`已删除 ${fileName}`);
    if (activeFile.value === fileName) {
      activeFile.value = null;
    }
    await loadXmlFromDirectory(config.xmlPath);
  } catch (e) {
    message.error("删除失败: " + errMsg(e));
  } finally {
    deletingFile.value = false;
  }
}

function resetLoadedMessageIds() {
  for (const mod of parsedModules.value) {
    let changed = false;
    for (const msg of mod.messages) {
      if (msg.id !== 0) {
        msg.id = 0;
        changed = true;
      }
    }
    if (changed) {
      mod.rawContent = moduleToXml(mod);
    }
  }
  if (selectedModule.value) {
    editorContent.value = selectedModule.value.rawContent ?? moduleToXml(selectedModule.value);
  }
  isFormDirty.value = parsedModules.value.length > 0;
}

function buildGenerateOptions(modules: ModuleDef[]): GenerateOptions {
  const modulePackageMap: Record<string, string> = {};
  if (config.modulePackageMapCommon) {
    modulePackageMap["common"] = config.modulePackageMapCommon;
  }
  for (const m of modules) {
    if (!modulePackageMap[m.moduleName]) {
      modulePackageMap[m.moduleName] = m.moduleName;
    }
  }
  return {
    author: config.author,
    javaBasePackage: config.javaBasePackage,
    handlerBasePackage: config.handlerBasePackage,
    modulePackageMap,
  };
}

async function deleteGeneratedProtocolFiles(): Promise<number> {
  if (!canGenerate.value) return 0;
  const result = await previewProtocols(
    parsedModules.value,
    config.frontendPath,
    config.backendPath,
    buildGenerateOptions(parsedModules.value),
  );
  const paths = [...new Set(result.files.map((f) => f.path))];
  let deletedCount = 0;
  for (const path of paths) {
    try {
      await remove(path);
      deletedCount += 1;
    } catch {
      // 文件可能不存在，忽略即可。
    }
  }
  return deletedCount;
}

async function handleClearMessageIds() {
  clearingMessageIds.value = true;
  try {
    const deletedCount = await deleteGeneratedProtocolFiles();
    const count = await invoke<number>("clear_message_ids");
    resetLoadedMessageIds();
    showClearIdsModal.value = false;
    message.success(`已删除 ${deletedCount} 个生成文件，清空 ${count} 条本地消息 ID，当前 XML 的 ID 已重置为 0`);
  } catch (e) {
    message.error("清空消息 ID 失败: " + errMsg(e));
  } finally {
    clearingMessageIds.value = false;
  }
}

const editorRef = ref();
const editorContent = ref("");
const messageEditorFocusName = ref("");
const messageEditorFocusTick = ref(0);

// ---------- 未保存状态追踪 ----------
const savedContent = ref("");
// 表单模式用独立标记，避免和 XML 编辑器混用同一套比较逻辑
const isFormDirty = ref(false);
const isDirty = computed(() => {
  if (viewMode.value === "form") return isFormDirty.value;
  return editorContent.value !== savedContent.value;
});
type PendingAction = { type: "switch"; fileName: string } | { type: "preview" } | { type: "generate" };
const pendingAction = ref<PendingAction | null>(null);
const showUnsavedModal = computed(() => pendingAction.value !== null);

function getPromptTitle() {
  const a = pendingAction.value;
  if (!a) return "";
  if (a.type === "switch") return "切换文件";
  if (a.type === "preview") return "预览";
  return "生成代码";
}

async function saveCurrentFile() {
  if (!activeFile.value || !config.xmlPath) return;
  const sep = config.xmlPath.endsWith("/") ? "" : "/";
  const filePath = `${config.xmlPath}${sep}${activeFile.value}`;
  // 表单模式：从 ModuleDef 生成 XML
  if (viewMode.value === "form" && selectedModule.value) {
    const xml = moduleToXml(selectedModule.value);
    await writeTextFile(filePath, xml);
    selectedModule.value.rawContent = xml;
    savedContent.value = xml;
    editorContent.value = xml;
    isFormDirty.value = false;
  } else {
    await writeTextFile(filePath, editorContent.value);
    savedContent.value = editorContent.value;
    if (selectedModule.value) {
      selectedModule.value.rawContent = editorContent.value;
    }
  }
  message.success("已保存");
}

async function onSaveAndProceed() {
  const action = pendingAction.value;
  pendingAction.value = null;
  await saveCurrentFile();
  executeAction(action!);
}

function onDiscardAndProceed() {
  const action = pendingAction.value;
  pendingAction.value = null;
  if (selectedModule.value) {
    editorContent.value = selectedModule.value.rawContent ?? "";
    savedContent.value = editorContent.value;
    isFormDirty.value = false;
  }
  executeAction(action!);
}

function onCancelAction() {
  pendingAction.value = null;
}

function executeAction(action: PendingAction) {
  switch (action.type) {
    case "switch":
      activeFile.value = action.fileName;
      isFormDirty.value = false;
      break;
    case "preview":
      doPreview();
      break;
    case "generate":
      doGenerate();
      break;
  }
}

function getMessageNameFromXmlLine(lineText: string): string | null {
  const match = lineText.match(/<Message\b[^>]*\bname="([^"]+)"/);
  return match?.[1] ?? null;
}

async function focusMessageInForm(messageName: string) {
  if (!selectedModule.value?.messages.some((msg) => msg.name === messageName)) {
    message.warning(`未找到消息 ${messageName}`);
    return;
  }
  messageEditorFocusName.value = messageName;
  viewMode.value = "form";
  await nextTick();
  messageEditorFocusTick.value += 1;
}

function handleXmlDoubleClick(event: MouseEvent, view: EditorView) {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) return;
  const line = view.state.doc.lineAt(pos);
  const messageName = getMessageNameFromXmlLine(line.text);
  if (messageName) {
    focusMessageInForm(messageName);
  }
}

const editorExtensions = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightActiveLine(),
  history(),
  xml(),
  keymap.of([...defaultKeymap, ...historyKeymap]),
  EditorView.domEventHandlers({
    dblclick(event, view) {
      handleXmlDoubleClick(event, view);
      return false;
    },
  }),
  oneDark,
];

/** 从指定目录加载所有 .xml 文件并解析 */
async function loadXmlFromDirectory(dirPath: string) {
  if (!dirPath) return;
  parsing.value = true;
  try {
    const entries = await readDir(dirPath);
    const sep = dirPath.endsWith("/") ? "" : "/";
    const xmlFiles = entries
      .filter((e) => e.isFile && e.name.endsWith(".xml"))
      .map((e) => ({ path: `${dirPath}${sep}${e.name}`, name: e.name }));
    if (xmlFiles.length === 0) {
      message.warning(`目录 ${dirPath} 下没有 XML 文件`);
      return;
    }
    const files: { name: string; content: string }[] = [];
    for (const f of xmlFiles) {
      const content = await readTextFile(f.path);
      files.push({ name: f.name, content });
    }
    parsedModules.value = parseXmlFiles(files);
    if (parsedModules.value.length > 0) {
      activeFile.value = parsedModules.value[0].fileName;
    }
    message.success(`成功加载 ${parsedModules.value.length} 个模块文件`);
  } catch (e) {
    message.error("加载失败: " + errMsg(e));
  } finally {
    parsing.value = false;
  }
}

async function selectXmlFiles() {
  const selected = await open({
    multiple: true,
    filters: [{ name: "XML", extensions: ["xml"] }],
  });
  if (!selected) return;

  const paths = Array.isArray(selected) ? selected : [selected];
  parsing.value = true;
  try {
    const files: { name: string; content: string }[] = [];
    for (const p of paths) {
      const content = await readTextFile(p);
      const name = p.split("/").pop() ?? p;
      files.push({ name, content });
    }
    parsedModules.value = parseXmlFiles(files);
    if (parsedModules.value.length > 0) {
      activeFile.value = parsedModules.value[0].fileName;
    }
    message.success(`成功解析 ${parsedModules.value.length} 个模块文件`);
  } catch (e) {
    message.error("解析失败: " + errMsg(e));
  } finally {
    parsing.value = false;
  }
}

const config = useConfig();

const showConfig = ref(false);

async function pickDirectory(field: "xmlPath" | "backendPath" | "frontendPath") {
  const selected = await open({ directory: true });
  if (!selected) return;
  config[field] = selected as string;
}

const activeFile = ref<string | null>(null);
const viewMode = ref<"form" | "xml">("form");

function setViewMode(mode: "form" | "xml") {
  if (mode === viewMode.value) return;
  if (mode === "xml" && selectedModule.value) {
    editorContent.value = isFormDirty.value
      ? moduleToXml(selectedModule.value)
      : selectedModule.value.rawContent ?? "";
  }
  viewMode.value = mode;
}

function onFormChanged(mod: ModuleDef) {
  // 原地合并到 parsedModules 中的现有对象，不替换引用
  const existing = parsedModules.value.find((m) => m.fileName === mod.fileName);
  if (existing) {
    existing.moduleName = mod.moduleName;
    existing.desc = mod.desc;
    existing.messages = mod.messages;
  }
  isFormDirty.value = true;
}

const selectedModule = computed(() =>
  parsedModules.value.find((m) => m.fileName === activeFile.value),
);

watch(selectedModule, (mod) => {
  if (mod && mod.rawContent) {
    editorContent.value = mod.rawContent;
    savedContent.value = mod.rawContent;
  } else {
    editorContent.value = "";
    savedContent.value = "";
  }
  isFormDirty.value = false;
}, { immediate: true });

// 应用启动时自动加载 xmlPath 下的文件
onMounted(() => {
  if (config.xmlPath) {
    loadXmlFromDirectory(config.xmlPath);
  }
  // Ctrl+S / Cmd+S 保存
  document.addEventListener("keydown", onKeyDown);
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeyDown);
});

function onKeyDown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    if (activeFile.value) saveCurrentFile();
  }
}

// 配置弹窗关闭时，若 xmlPath 有值且当前没有已加载文件，则自动加载
watch(showConfig, (show, prev) => {
  if (prev && !show && config.xmlPath) {
    loadXmlFromDirectory(config.xmlPath);
  }
});

function handleFileSelect(fileName: string) {
  if (isDirty.value && fileName !== activeFile.value) {
    pendingAction.value = { type: "switch", fileName };
    return;
  }
  activeFile.value = fileName;
  isFormDirty.value = false;
}

const canGenerate = computed(
  () => parsedModules.value.length > 0 && !!config.frontendPath && !!config.backendPath,
);

/** 用编辑器最新内容重新解析当前模块，保证 messages/fields 是最新的 */
function refreshActiveModule() {
  const mod = selectedModule.value;
  if (!mod || !mod.rawContent) return;
  const fresh = parseXmlFiles([{ name: mod.fileName, content: mod.rawContent }]);
  if (fresh.length > 0) {
    const idx = parsedModules.value.findIndex((m) => m.fileName === mod.fileName);
    if (idx >= 0) parsedModules.value[idx] = fresh[0];
  }
}

/** 通过 SQLite 为消息分配稳定 ID（按类型分区间，同名消息 ID 不变） */
async function autoAssignIds() {
  for (const mod of parsedModules.value) {
    for (const msg of mod.messages) {
      if (msg.id <= 0) {
        const fullName = msg.name.startsWith(msg.type + "_") ? msg.name : msg.type + "_" + msg.name;
        msg.id = await invoke<number>("get_message_id", {
          name: fullName,
          msgType: msg.type,
        });
      }
    }
  }
}

async function doGenerate() {
  await autoAssignIds();
  if (!canGenerate.value) {
    message.warning("请先完成路径配置");
    return;
  }
  try {
    const result = await generateProtocols(
      parsedModules.value,
      config.frontendPath,
      config.backendPath,
      buildGenerateOptions(parsedModules.value),
    );
    message.success(
      `生成完成！写入 ${result.writtenFiles.length} 个文件` +
        (result.skippedFiles.length > 0
          ? `，跳过 ${result.skippedFiles.length} 个已存在 Handler`
          : ""),
    );
  } catch (e) {
    message.error("生成失败: " + errMsg(e));
  }
}

// ---------- 预览 ----------
const showPreviewModal = ref(false);
const previewFiles = ref<PreviewFile[]>([]);
const previewSkipped = ref<string[]>([]);
const previewActiveFile = ref("");
const previewLoading = ref(false);

const previewActiveContent = computed(() => {
  const f = previewFiles.value.find((p) => p.path === previewActiveFile.value);
  return f?.content ?? "";
});

async function doPreview() {
  if (!selectedModule.value) {
    message.warning("请先在左侧选择一个文件");
    return;
  }
  if (!canGenerate.value) {
    message.warning("请先完成路径配置");
    return;
  }
  await autoAssignIds();
  const mod = selectedModule.value!;
  previewLoading.value = true;
  showPreviewModal.value = true;
  previewFiles.value = [];
  previewSkipped.value = [];
  previewActiveFile.value = "";
  try {
    const modulesToPreview = [mod];
    const result = await previewProtocols(
      modulesToPreview,
      config.frontendPath,
      config.backendPath,
      buildGenerateOptions(modulesToPreview),
    );
    previewFiles.value = result.files;
    previewSkipped.value = result.skippedHandlerFiles;
    if (result.files.length > 0) {
      previewActiveFile.value = result.files[0].path;
    }
  } catch (e) {
    message.error("预览失败: " + errMsg(e));
    showPreviewModal.value = false;
  } finally {
    previewLoading.value = false;
  }
}

function handlePreview() {
  if (isDirty.value) { pendingAction.value = { type: "preview" }; return; }
  doPreview();
}
function handleGenerate() {
  if (!canGenerate.value) { message.warning("请先完成路径配置"); return; }
  if (isDirty.value) { pendingAction.value = { type: "generate" }; return; }
  doGenerate();
}
</script>

<template>
  <div class="app-root" @contextmenu.prevent @click="closeContextMenu">
    <!-- 左侧：文件列表 -->
    <aside class="sider">
      <div class="sider-header">
        <span class="title">NovaMsg</span>
        <div class="sider-actions">
          <n-button type="primary" size="tiny" style="flex: 1" @click="showConfig = true">⚙️ 配置</n-button>
          <n-button type="success" size="tiny" style="flex: 1" :loading="parsing" @click="openNewFileModal">+ 新建</n-button>
        </div>
        <n-button
          type="error"
          ghost
          size="tiny"
          block
          class="sider-danger-action"
          @click="showClearIdsModal = true"
        >
          清空消息ID
        </n-button>
      </div>

      <div class="file-list">
        <div class="file-list-title">
          <n-text style="font-size: 12px; color: #888">文件列表（{{ parsedModules.length }}）</n-text>
        </div>

        <div
          v-for="m in parsedModules"
          :key="m.fileName"
          class="file-item"
          :class="{ active: activeFile === m.fileName }"
          @click="handleFileSelect(m.fileName)"
          @contextmenu="onFileContextMenu($event, m.fileName)"
        >
          <span>{{ m.fileName }}</span>
        </div>

        <div v-if="parsedModules.length === 0" class="empty">
          <n-text depth="3">暂无文件，请导入 XML</n-text>
        </div>
      </div>
    </aside>

    <!-- 右键菜单（自定义定位） -->
    <div
      v-if="showContextMenu"
      class="ctx-menu"
      :style="{ left: contextMenuX + 'px', top: contextMenuY + 'px' }"
      @click.stop
    >
      <div class="ctx-item" @click="onCtxMenuRename">✏️ 重命名</div>
      <div class="ctx-item ctx-item--danger" @click="onCtxMenuDelete">🗑️ 删除</div>
    </div>

    <!-- 右侧：编辑器 + 底部按钮 -->
    <main class="content">
      <div class="editor-tab">
        <span class="editor-tab-title">{{ selectedModule?.fileName || '未选择文件' }}</span>
        <span v-if="isDirty" class="editor-tab-dirty">● 未保存</span>
        <n-button v-if="isDirty && viewMode === 'form'" size="tiny" type="warning" @click="saveCurrentFile">保存</n-button>
        <n-button size="tiny" :type="viewMode === 'form' ? 'primary' : 'default'" @click="setViewMode('form')">表单</n-button>
        <n-button size="tiny" :type="viewMode === 'xml' ? 'primary' : 'default'" @click="setViewMode('xml')">XML</n-button>
      </div>
      <div class="editor-wrap">
        <template v-if="viewMode === 'form' && selectedModule">
          <MessageEditor
            :module="selectedModule"
            :focus-message-name="messageEditorFocusName"
            :focus-tick="messageEditorFocusTick"
            @changed="onFormChanged"
          />
        </template>
        <template v-else>
          <Codemirror
            ref="editorRef"
            v-model="editorContent"
            :extensions="editorExtensions"
            :basic="true"
            :disabled="true"
            style="height: 100%"
          />
        </template>
      </div>
      <div class="footer-bar">
        <n-text style="font-size: 12px; color: #999">共 {{ parsedModules.length }} 个模块</n-text>
        <n-space :size="8">
          <n-button size="small" @click="handlePreview">预览</n-button>
          <n-button type="primary" size="small" :disabled="!canGenerate" @click="handleGenerate">生成</n-button>
        </n-space>
      </div>
    </main>

    <!-- 配置弹窗 -->
    <n-modal v-model:show="showConfig" preset="card" title="配置" style="width: 520px">
      <n-space vertical :size="16">
        <div class="config-modal-row">
          <n-text class="config-modal-label">XML 目录</n-text>
          <div class="config-modal-input">
            <n-input :value="config.xmlPath" placeholder="点击右侧按钮选择目录" readonly size="small" />
            <n-button size="small" @click="pickDirectory('xmlPath')">选择</n-button>
          </div>
        </div>
        <div class="config-modal-row">
          <n-text class="config-modal-label">后端消息目录</n-text>
          <div class="config-modal-input">
            <n-input :value="config.backendPath" placeholder="点击右侧按钮选择目录" readonly size="small" />
            <n-button size="small" @click="pickDirectory('backendPath')">选择</n-button>
          </div>
        </div>
        <div class="config-modal-row">
          <n-text class="config-modal-label">前端消息目录</n-text>
          <div class="config-modal-input">
            <n-input :value="config.frontendPath" placeholder="点击右侧按钮选择目录" readonly size="small" />
            <n-button size="small" @click="pickDirectory('frontendPath')">选择</n-button>
          </div>
        </div>
      </n-space>
    </n-modal>

    <!-- 新建 XML 文件弹窗 -->
    <n-modal v-model:show="showNewFileModal" preset="card" title="新建 XML 文件" style="width: 640px">
      <n-space vertical :size="16">
        <div class="config-modal-row">
          <n-text class="config-modal-label">文件名</n-text>
          <div class="config-modal-input">
            <n-input
              v-model:value="newFileName"
              placeholder="例如：login_message"
              size="small"
              style="flex: 1"
            />
            <n-text depth="3" style="font-size: 13px; line-height: 28px">.xml</n-text>
          </div>
        </div>
        <n-text depth="3" style="font-size: 12px">
          文件将保存至：{{ config.xmlPath }}/，创建后模块名默认使用文件名。
        </n-text>
      </n-space>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showNewFileModal = false">取消</n-button>
          <n-button type="primary" :loading="creatingFile" @click="handleCreateNewFile">创建</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 重命名弹窗 -->
    <n-modal v-model:show="showRenameModal" preset="card" title="重命名文件" style="width: 420px">
      <n-space vertical :size="12">
        <div class="config-modal-row">
          <n-text class="config-modal-label">新文件名</n-text>
          <div class="config-modal-input">
            <n-input
              v-model:value="renameFileName"
              size="small"
              style="flex: 1"
              @keyup.enter="handleRenameFile"
            />
            <n-text depth="3" style="font-size: 13px; line-height: 28px">.xml</n-text>
          </div>
        </div>
        <n-text depth="3" style="font-size: 12px">
          原文件名：{{ contextMenuFile }}
        </n-text>
      </n-space>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showRenameModal = false">取消</n-button>
          <n-button type="primary" :loading="renamingFile" @click="handleRenameFile">确认重命名</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 删除确认弹窗 -->
    <n-modal v-model:show="showDeleteModal" preset="card" title="确认删除" style="width: 400px">
      <n-text>确定要删除 <strong>{{ contextMenuFile }}</strong> 吗？此操作不可撤销。</n-text>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showDeleteModal = false">取消</n-button>
          <n-button type="error" :loading="deletingFile" @click="handleDeleteFile">确认删除</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 清空消息 ID 确认弹窗 -->
    <n-modal v-model:show="showClearIdsModal" preset="card" title="清空消息 ID" style="width: 460px">
      <n-space vertical :size="10">
        <n-text>确定要清空本地 SQLite 中保存的所有消息 ID，并删除当前协议对应的生成文件吗？</n-text>
        <n-text depth="3" style="font-size: 12px">
          会删除 C# 汇总文件、Java 消息类、MessageId 和 GameHandlerManager；已存在的 Handler 业务文件不会自动删除。当前已加载 XML 的消息 ID 会同步重置为 0，并进入未保存状态。
        </n-text>
      </n-space>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showClearIdsModal = false">取消</n-button>
          <n-button type="error" :loading="clearingMessageIds" @click="handleClearMessageIds">确认清空</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 未保存提示弹窗 -->
    <n-modal :show="showUnsavedModal" preset="card" :title="getPromptTitle()" style="width: 420px" @update:show="onCancelAction">
      <n-text>当前文件 <strong>{{ activeFile }}</strong> 有未保存的修改，是否保存？</n-text>
      <template #footer>
        <n-space justify="end">
          <n-button @click="onCancelAction">取消</n-button>
          <n-button @click="onDiscardAndProceed">不保存</n-button>
          <n-button type="primary" @click="onSaveAndProceed">保存</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 预览弹窗 -->
    <n-modal v-model:show="showPreviewModal" preset="card" title="生成预览" style="width: 900px">
      <template #header-extra>
        <n-text depth="3" style="font-size: 12px">共 {{ previewFiles.length }} 个文件{{ previewSkipped.length > 0 ? `，跳过 ${previewSkipped.length} 个已存在 Handler` : '' }}</n-text>
      </template>
      <n-spin :show="previewLoading">
        <div v-if="previewFiles.length === 0 && !previewLoading" style="text-align: center; padding: 40px; color: #666">
          暂无预览内容
        </div>
        <div v-else class="preview-body">
          <div class="preview-file-list">
            <div
              v-for="f in previewFiles"
              :key="f.path"
              class="preview-file-item"
              :class="{ active: previewActiveFile === f.path }"
              @click="previewActiveFile = f.path"
            >
              <span class="preview-file-name">{{ f.path.split('/').pop() }}</span>
            </div>
            <div v-if="previewSkipped.length > 0" style="margin-top: 12px; padding: 0 8px">
              <n-text depth="3" style="font-size: 11px; display: block; margin-bottom: 4px">跳过（Handler 已存在）：</n-text>
              <div v-for="p in previewSkipped" :key="p" class="preview-file-item skipped">
                <span class="preview-file-name">{{ p.split('/').pop() }}</span>
              </div>
            </div>
          </div>
          <div class="preview-content">
            <template v-if="previewActiveContent">
              <div class="preview-content-header">{{ previewActiveFile }}</div>
              <pre class="preview-code"><code>{{ previewActiveContent }}</code></pre>
            </template>
            <div v-else style="text-align: center; padding: 40px; color: #666">
              请选择左侧文件查看内容
            </div>
          </div>
        </div>
      </n-spin>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showPreviewModal = false">关闭</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.app-root {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

.sider {
  width: 240px;
  flex-shrink: 0;
  background: #1a1a1a;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #333;
}

.sider-header {
  flex-shrink: 0;
  padding: 12px;
}

.title {
  display: block;
  color: #4ade80;
  font-size: 14px;
  font-weight: bold;
  margin-bottom: 12px;
}

.sider-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.sider-danger-action {
  margin-bottom: 12px;
}

.config-modal-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.config-modal-label {
  width: 100px;
  font-size: 13px;
  flex-shrink: 0;
}

.config-modal-input {
  flex: 1;
  display: flex;
  gap: 8px;
}

.file-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px 12px;
  min-height: 0;
}

.file-list-title {
  margin-bottom: 8px;
}

.file-item {
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  color: #ccc;
  font-size: 13px;
}

.file-item.active {
  background: #2a2a2a;
}

.file-item.active span {
  color: #4ade80;
}

.empty {
  text-align: center;
  color: #666;
  padding: 40px 0;
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #1e1e1e;
  min-width: 0;
  min-height: 0;
}

.editor-tab {
  flex-shrink: 0;
  padding: 6px 12px;
  background: #252526;
  font-size: 12px;
  color: #ccc;
  border-bottom: 1px solid #333;
  display: flex;
  align-items: center;
  gap: 10px;
}
.editor-tab-title {
  flex: 1;
}
.editor-tab-dirty {
  color: #f59e0b;
  font-size: 11px;
  white-space: nowrap;
}

.editor-wrap {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.footer-bar {
  flex-shrink: 0;
  padding: 6px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid #333;
  background: #1e1e1e;
}

/* 关键：强制 CodeMirror 撑满父容器 */
.editor-wrap :deep(.cm-editor) {
  height: 100%;
}

.editor-wrap :deep(.cm-scroller) {
  overflow: auto;
}

/* ---- 右键菜单 ---- */
.ctx-menu {
  position: fixed;
  z-index: 9999;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 6px;
  padding: 4px 0;
  min-width: 130px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.6);
}
.ctx-item {
  padding: 7px 16px;
  cursor: pointer;
  font-size: 13px;
  color: #d4d4d4;
  user-select: none;
}
.ctx-item:hover {
  background: #3a3a3a;
}
.ctx-item--danger {
  color: #f87171;
}
.ctx-item--danger:hover {
  background: #4a2020;
}

/* ---- 预览弹窗 ---- */
.preview-body {
  display: flex;
  height: 60vh;
  min-height: 400px;
}
.preview-file-list {
  width: 240px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid #333;
  padding: 4px 0;
}
.preview-file-item {
  padding: 6px 10px;
  cursor: pointer;
  border-bottom: 1px solid #2a2a2a;
}
.preview-file-item:hover {
  background: #2a2a2a;
}
.preview-file-item.active {
  background: #333;
}
.preview-file-item.active .preview-file-name {
  color: #4ade80;
}
.preview-file-item.skipped {
  cursor: default;
  opacity: 0.5;
}
.preview-file-name {
  display: block;
  font-size: 12px;
  color: #ccc;
}
.preview-file-path {
  display: block;
  font-size: 10px;
  color: #666;
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.preview-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}
.preview-content-header {
  flex-shrink: 0;
  padding: 6px 12px;
  font-size: 11px;
  color: #888;
  background: #1a1a1a;
  border-bottom: 1px solid #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.preview-code {
  flex: 1;
  margin: 0;
  padding: 12px;
  overflow: auto;
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: "SF Mono", "Fira Code", monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
  tab-size: 4;
}
</style>
