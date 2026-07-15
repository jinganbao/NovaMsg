<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import {
  NButton,
  NSpace,
  NInput,
  NText,
  NModal,
  NSpin,
  NProgress,
  NSwitch,
  useMessage,
} from "naive-ui";
import { open } from "@tauri-apps/plugin-dialog";
import { mkdir, writeTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { parseXmlFiles } from "@/utils/xmlParser";
import { moduleToXml } from "@/utils/xmlSerializer";
import { applyManagedMessagePaths } from "@/utils/managedPaths";
import { generateProtocols } from "@/generator";
import type { GenerateOptions, ModuleDef } from "@/generator/types";
import { useConfig } from "@/composables/useConfig";
import MessageEditor from "@/components/MessageEditor.vue";
import { Codemirror } from "vue-codemirror";
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { xml } from "@codemirror/lang-xml";
import { oneDark } from "@codemirror/theme-one-dark";

import { useTheme } from "@/composables/useTheme";
import { useAppUpdate } from "@/composables/useAppUpdate";
import { useValidation } from "@/composables/useValidation";
import { usePreview } from "@/composables/usePreview";
import { useFileOps } from "@/composables/useFileOps";
import { useMessageIds } from "@/composables/useMessageIds";

const message = useMessage();
const config = useConfig();
applyManagedMessagePaths(config);

// ---------- 错误工具 ----------
function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e ?? "未知错误");
}

// ---------- 主题 ----------
const { themePresets, themeModeOptions, themeVars, setThemeMode } = useTheme(config);

// ---------- 文件操作 ----------
const {
  parsedModules,
  parsing,
  parseErrors,
  showParseErrorModal,
  showNewFileModal,
  newFileName,
  creatingFile,
  showContextMenu,
  contextMenuX,
  contextMenuY,
  contextMenuFile,
  showRenameModal,
  renameFileName,
  renamingFile,
  showDeleteModal,
  deletingFile,
  setActiveFileAccessors,
  loadXmlFromDirectory,
  pickXmlDirectoryAndLoad,
  selectXmlFiles,
  openNewFileModal,
  handleCreateNewFile,
  onFileContextMenu,
  closeContextMenu,
  onCtxMenuRename,
  onCtxMenuDelete,
  handleRenameFile,
  handleDeleteFile,
} = useFileOps(config, message);

// ---------- 应用更新 ----------
const {
  checkingUpdate,
  showUpdateModal,
  updateInfo,
  installingUpdate,
  cancellingUpdate,
  updateDownloaded,
  updateTotal,
  updateProgressLabel,
  updateProgressPercentage,
  currentVersion,
  latestVersion,
  checkForUpdates,
  handleUpdateDownload,
  cancelUpdateDownload,
  autoCheckOnStartup,
} = useAppUpdate(config, message);

// ---------- 校验 ----------
const {
  showValidationModal,
  validationIssues,
  validationErrors,
  validationWarnings,
  runValidation: runValidationRaw,
} = useValidation();

function runValidation(options: { showSuccess?: boolean } = {}): boolean {
  if (!syncXmlEditorToModule()) return false;
  return runValidationRaw(parsedModules.value, options, message);
}

// ---------- 预览 ----------
const lightEditorTheme = EditorView.theme({
  "&": {
    color: "#17202A",
    backgroundColor: "#F7F9FC",
  },
  ".cm-content": {
    caretColor: "#0F9488",
  },
  ".cm-gutters": {
    backgroundColor: "#EEF3F7",
    color: "#7B8797",
    borderRightColor: "#D8E0EA",
  },
  ".cm-activeLine": {
    backgroundColor: "#EAF0F7",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#EAF0F7",
  },
  ".cm-selectionBackground": {
    backgroundColor: "rgba(15, 148, 136, 0.16)",
  },
}, { dark: false });

const darkEditorTheme = EditorView.theme({
  "&": {
    color: "#D8E2F0",
    backgroundColor: "#10151D",
  },
  ".cm-content": {
    caretColor: "#4DA3FF",
  },
  ".cm-gutters": {
    backgroundColor: "#161D27",
    color: "#758397",
    borderRightColor: "#293241",
  },
  ".cm-activeLine": {
    backgroundColor: "#1D2633",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#1D2633",
    color: "#A9B7C8",
  },
  ".cm-selectionBackground": {
    backgroundColor: "rgba(77, 163, 255, 0.22)",
  },
}, { dark: true });

const {
  showPreviewModal,
  previewFiles,
  previewSkipped,
  previewActiveFile,
  previewLoading,
  previewFileSearch,
  previewContentSearch,
  previewActiveContent,
  previewEditorContent,
  previewActiveName,
  filteredPreviewFiles,
  previewSearchMatches,
  previewEditorExtensions,
  copyPreviewContent,
  doPreview: doPreviewRaw,
  getFileName,
  getFileDir,
} = usePreview(config, message, lightEditorTheme, darkEditorTheme);

// ---------- 消息 ID ----------
const {
  clearingMessageIds,
  clearConfirmText,
  canClearMessageIds,
  autoAssignIds: autoAssignIdsRaw,
  handleClearMessageIds: handleClearMessageIdsRaw,
} = useMessageIds(config, message);

// ---------- 编辑器状态 ----------
const editorRef = ref();
const editorContent = ref("");
const messageEditorFocusName = ref("");
const messageEditorFocusTick = ref(0);
const fileSearchRef = ref();
const previewSearchRef = ref();

const savedContent = ref("");
const isFormDirty = ref(false);
const isDirty = computed(() => {
  if (viewMode.value === "form") return isFormDirty.value;
  return editorContent.value !== savedContent.value;
});
type PendingAction =
  | { type: "switch"; fileName: string }
  | { type: "preview" }
  | { type: "generate" }
  | { type: "reloadXml" };
const pendingAction = ref<PendingAction | null>(null);
const showUnsavedModal = computed(() => pendingAction.value !== null);

const SVN_COMMIT_HISTORY_KEY = "NovaMsg-svn-commit-history";
const showConfig = ref(false);
const fileSearch = ref("");
const svnUpdating = ref(false);
const svnCommitting = ref(false);
const showSvnCommitModal = ref(false);
const svnCommitMessage = ref("");
const svnCommitHistory = ref<string[]>(loadSvnCommitHistory());
const svnCommitHistoryOptions = computed(() =>
  svnCommitHistory.value.map((item) => ({
    label: item,
    value: item,
  })),
);

const activeFile = ref<string | null>(null);
const viewMode = ref<"form" | "xml">("form");

function loadSvnCommitHistory(): string[] {
  try {
    const raw = localStorage.getItem(SVN_COMMIT_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string").slice(0, 10) : [];
  } catch {
    return [];
  }
}

function saveSvnCommitHistory(messageText: string) {
  const trimmed = messageText.trim();
  if (!trimmed) return;
  svnCommitHistory.value = [
    trimmed,
    ...svnCommitHistory.value.filter((item) => item !== trimmed),
  ].slice(0, 10);
  localStorage.setItem(SVN_COMMIT_HISTORY_KEY, JSON.stringify(svnCommitHistory.value));
}

function selectSvnCommitHistory(value: string | number | null) {
  if (typeof value === "string" && value) {
    svnCommitMessage.value = value;
  }
}

// 连接文件操作与 activeFile
setActiveFileAccessors(
  () => activeFile.value,
  (v) => { activeFile.value = v; },
);

const selectedModule = computed(() =>
  parsedModules.value.find((m) => m.fileName === activeFile.value),
);

const availableStructs = computed(() =>
  parsedModules.value.flatMap((mod) =>
    (mod.structs ?? []).map((struct) => ({
      name: struct.name,
      desc: struct.desc,
      moduleName: mod.moduleName,
      fileName: mod.fileName,
    })),
  ),
);

const filteredModules = computed(() => {
  const keyword = fileSearch.value.trim().toLowerCase();
  if (!keyword) return parsedModules.value;
  return parsedModules.value.filter((mod) =>
    mod.fileName.toLowerCase().includes(keyword) ||
    mod.moduleName.toLowerCase().includes(keyword),
  );
});

const canGenerate = computed(
  () => parsedModules.value.length > 0 && !!config.svnPath,
);

async function ensureManagedDirs() {
  applyManagedMessagePaths(config);
  for (const path of [config.xmlPath, config.backendPath, config.frontendPath]) {
    if (path) {
      try {
        await mkdir(path, { recursive: true });
      } catch {
        // 目录已存在或并发创建时忽略。
      }
    }
  }
}

// ---------- 编辑器扩展 ----------
const editorExtensions = computed(() => [
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
  config.themeMode === "dark" ? [oneDark, darkEditorTheme] : lightEditorTheme,
]);

// ---------- 生成选项 ----------
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

// ---------- 消息 ID 分配包装 ----------
async function autoAssignIds() {
  return autoAssignIdsRaw(parsedModules.value, selectedModule.value, (xml) => {
    editorContent.value = xml;
    savedContent.value = xml;
  });
}

// ---------- 保存 ----------
function getPromptTitle() {
  const a = pendingAction.value;
  if (!a) return "";
  if (a.type === "switch") return "切换文件";
  if (a.type === "preview") return "预览";
  if (a.type === "reloadXml") return "重载 XML";
  return "生成代码";
}

function syncXmlEditorToModule(): boolean {
  if (viewMode.value !== "xml" || !activeFile.value) return true;
  try {
    const [mod] = parseXmlFiles([{ name: activeFile.value, content: editorContent.value }]);
    const index = parsedModules.value.findIndex((item) => item.fileName === activeFile.value);
    if (index >= 0) {
      parsedModules.value[index] = mod;
    }
    return true;
  } catch (e) {
    message.error(errMsg(e));
    return false;
  }
}

async function saveCurrentFile(): Promise<boolean> {
  applyManagedMessagePaths(config);
  if (!activeFile.value || !config.xmlPath) return false;
  if (!runValidation()) return false;
  await ensureManagedDirs();
  const sep = config.xmlPath.endsWith("/") ? "" : "/";
  const filePath = `${config.xmlPath}${sep}${activeFile.value}`;
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
  return true;
}

async function onSaveAndProceed() {
  const action = pendingAction.value;
  pendingAction.value = null;
  const saved = await saveCurrentFile();
  if (!saved) return;
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
    case "reloadXml":
      doReloadXmlDirectory();
      break;
  }
}

// ---------- XML 双击跳转 ----------
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

// ---------- 视图模式 ----------
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
  const existing = parsedModules.value.find((m) => m.fileName === mod.fileName);
  if (existing) {
    existing.moduleName = mod.moduleName;
    existing.desc = mod.desc;
    existing.structs = mod.structs;
    existing.messages = mod.messages;
  }
  isFormDirty.value = true;
}

// ---------- 目录选择 ----------
async function pickDirectory(field: "svnPath") {
  const selected = await open({ directory: true });
  if (!selected) return;
  config[field] = selected as string;
  applyManagedMessagePaths(config);
  await ensureManagedDirs();
  await loadXmlFromDirectory(config.xmlPath);
}

async function doSvnUpdate(showSuccess = true): Promise<boolean> {
  if (!config.svnPath) {
    message.warning("请先在设置中配置消息目录");
    return false;
  }
  await ensureManagedDirs();
  svnUpdating.value = true;
  try {
    await invoke("svn_update", { cwd: config.svnPath });
    if (config.xmlPath) {
      await loadXmlFromDirectory(config.xmlPath);
    }
    if (showSuccess) message.success("SVN 更新成功");
    return true;
  } catch (e) {
    message.error("SVN 更新失败: " + errMsg(e));
    return false;
  } finally {
    svnUpdating.value = false;
  }
}

async function handleSvnUpdate() {
  if (isDirty.value) {
    message.warning("当前文件有未保存修改，请先保存后再更新 SVN");
    return;
  }
  await doSvnUpdate();
}

function openSvnCommitModal() {
  if (!config.svnPath) {
    message.warning("请先在设置中配置消息目录");
    return;
  }
  if (isDirty.value) {
    message.warning("当前文件有未保存修改，请先保存后再提交 SVN");
    return;
  }
  svnCommitMessage.value = svnCommitHistory.value[0] ?? "";
  showSvnCommitModal.value = true;
}

async function handleSvnCommit() {
  const commitMessage = svnCommitMessage.value.trim();
  if (!commitMessage) {
    message.warning("请输入提交说明");
    return;
  }
  svnCommitting.value = true;
  try {
    const result = await invoke<{ stdout: string; stderr: string }>("svn_commit_all", {
      cwd: config.svnPath,
      message: commitMessage,
    });
    saveSvnCommitHistory(commitMessage);
    showSvnCommitModal.value = false;
    message.success(result.stdout.includes("没有可提交") ? "SVN 没有可提交的变化" : "SVN 提交成功");
  } catch (e) {
    message.error("SVN 提交失败: " + errMsg(e));
  } finally {
    svnCommitting.value = false;
  }
}

// ---------- 文件选择 ----------
function handleFileSelect(fileName: string) {
  if (isDirty.value && fileName !== activeFile.value) {
    pendingAction.value = { type: "switch", fileName };
    return;
  }
  activeFile.value = fileName;
  isFormDirty.value = false;
}

async function doReloadXmlDirectory() {
  applyManagedMessagePaths(config);
  if (!config.xmlPath) {
    message.warning("请先选择消息目录");
    return;
  }
  await ensureManagedDirs();
  await loadXmlFromDirectory(config.xmlPath);
  message.success("XML 已重载");
}

function handleReloadXmlDirectory() {
  applyManagedMessagePaths(config);
  if (!config.xmlPath) {
    message.warning("请先选择消息目录");
    return;
  }
  if (isDirty.value) {
    pendingAction.value = { type: "reloadXml" };
    return;
  }
  doReloadXmlDirectory();
}

// ---------- 重新解析当前模块 ----------
function refreshActiveModule() {
  const mod = selectedModule.value;
  if (!mod || !mod.rawContent) return;
  const fresh = parseXmlFiles([{ name: mod.fileName, content: mod.rawContent }]);
  if (fresh.length > 0) {
    const idx = parsedModules.value.findIndex((m) => m.fileName === mod.fileName);
    if (idx >= 0) parsedModules.value[idx] = fresh[0];
  }
}

// ---------- 生成 ----------
async function doGenerate() {
  if (!canGenerate.value) {
    message.warning("请先配置消息目录");
    return;
  }
  await ensureManagedDirs();
  if (!runValidation()) return;
  if (!await autoAssignIds()) return;
  if (!runValidation()) return;
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
async function doPreview() {
  await ensureManagedDirs();
  await doPreviewRaw(
    selectedModule.value,
    parsedModules.value,
    canGenerate.value,
    config.frontendPath,
    config.backendPath,
    buildGenerateOptions,
    runValidation,
    autoAssignIds,
  );
}

function handlePreview() {
  if (isDirty.value) { pendingAction.value = { type: "preview" }; return; }
  doPreview();
}
function handleGenerate() {
  if (!canGenerate.value) { message.warning("请先配置消息目录"); return; }
  if (isDirty.value) { pendingAction.value = { type: "generate" }; return; }
  doGenerate();
}

// ---------- 清空消息 ID ----------
async function handleClearMessageIds() {
  await ensureManagedDirs();
  await handleClearMessageIdsRaw(
    parsedModules.value,
    selectedModule.value,
    (xml) => {
      editorContent.value = xml;
      savedContent.value = xml;
    },
    canGenerate.value,
    buildGenerateOptions,
  );
}

// ---------- 快捷键 ----------
function onKeyDown(e: KeyboardEvent) {
  const modifier = e.ctrlKey || e.metaKey;
  if (!modifier) return;
  const key = e.key.toLowerCase();
  if (key === "s") {
    e.preventDefault();
    if (activeFile.value) saveCurrentFile();
  } else if (key === "p") {
    e.preventDefault();
    handlePreview();
  } else if (e.key === "Enter") {
    e.preventDefault();
    handleGenerate();
  } else if (key === "f") {
    e.preventDefault();
    if (showPreviewModal.value) {
      previewSearchRef.value?.focus?.();
    } else {
      fileSearchRef.value?.focus?.();
    }
  }
}

// ---------- 生命周期 ----------
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

onMounted(() => {
  applyManagedMessagePaths(config);
  if (config.xmlPath) {
    loadXmlFromDirectory(config.xmlPath);
  }
  document.addEventListener("keydown", onKeyDown);
  autoCheckOnStartup();
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeyDown);
});

watch(showConfig, (show, prev) => {
  applyManagedMessagePaths(config);
  if (prev && !show && config.xmlPath) {
    loadXmlFromDirectory(config.xmlPath);
  }
});
</script>

<template>
  <div class="app-root" :style="themeVars" @contextmenu.prevent @click="closeContextMenu">
    <!-- 左侧：文件列表 -->
    <aside class="sider">
      <div class="sider-header">
        <span class="title">NovaMsg</span>
        <div class="sider-actions">
          <n-button type="primary" size="tiny" :loading="parsing" @click="pickXmlDirectoryAndLoad">选择目录</n-button>
          <n-button size="tiny" :loading="parsing" :disabled="!config.xmlPath" @click="handleReloadXmlDirectory">重载 XML</n-button>
          <n-button size="tiny" class="sider-action-full" :loading="parsing" @click="openNewFileModal">+ 新建</n-button>
        </div>
      </div>

      <div class="file-list">
        <n-input
          ref="fileSearchRef"
          v-model:value="fileSearch"
          size="small"
          placeholder="搜索 XML / 模块"
          clearable
          class="file-search"
        />
        <div class="file-list-title">
          <n-text style="font-size: 12px; color: var(--text-muted)">
            文件列表（{{ filteredModules.length }} / {{ parsedModules.length }}）
          </n-text>
        </div>

        <div
          v-for="m in filteredModules"
          :key="m.fileName"
          class="file-item"
          :class="{ active: activeFile === m.fileName }"
          @click="handleFileSelect(m.fileName)"
          @contextmenu="onFileContextMenu($event, m.fileName)"
        >
          <span>{{ m.fileName }}</span>
          <span v-if="activeFile === m.fileName && isDirty" class="file-dirty-dot"></span>
        </div>

        <div v-if="parsedModules.length === 0" class="empty">
          <n-text depth="3">暂无 XML 文件</n-text>
          <div class="empty-actions">
            <n-button size="small" type="primary" @click="pickXmlDirectoryAndLoad">选择消息目录</n-button>
            <n-button size="small" @click="openNewFileModal">新建 XML</n-button>
          </div>
        </div>
        <div v-else-if="filteredModules.length === 0" class="empty">
          <n-text depth="3">没有匹配的文件</n-text>
        </div>
      </div>

      <div class="sider-footer">
        <button class="settings-button" type="button" @click="showConfig = true">
          <span>设置</span>
          <span class="settings-accent"></span>
        </button>
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
        <div class="editor-title-block">
          <span class="editor-tab-title">{{ selectedModule?.fileName || '未选择文件' }}</span>
          <span v-if="selectedModule" class="editor-tab-meta">{{ selectedModule.moduleName || '未命名模块' }}</span>
          <span v-if="isDirty" class="editor-tab-dirty">● 未保存</span>
        </div>
        <div class="editor-toolbar">
          <div class="toolbar-group">
            <n-button size="tiny" :type="viewMode === 'form' ? 'primary' : 'default'" @click="setViewMode('form')">表单</n-button>
            <n-button size="tiny" :type="viewMode === 'xml' ? 'primary' : 'default'" @click="setViewMode('xml')">XML</n-button>
          </div>
          <div class="toolbar-group">
            <n-button size="tiny" :disabled="!activeFile || !isDirty" @click="saveCurrentFile">保存</n-button>
            <n-button size="tiny" :disabled="parsedModules.length === 0" @click="runValidation({ showSuccess: true })">校验</n-button>
          </div>
          <div class="toolbar-group toolbar-group--primary">
            <n-button size="tiny" @click="handlePreview">预览</n-button>
            <n-button type="primary" size="tiny" :disabled="!canGenerate" @click="handleGenerate">生成</n-button>
          </div>
        </div>
      </div>
      <div class="editor-wrap">
        <template v-if="viewMode === 'form' && selectedModule">
          <MessageEditor
            :module="selectedModule"
            :available-structs="availableStructs"
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
        <n-text style="font-size: 12px; color: var(--text-muted)">
          共 {{ parsedModules.length }} 个模块
          <span v-if="config.svnPath"> · 消息目录已配置</span>
          <span v-else> · 尚未配置消息目录</span>
        </n-text>
      </div>
    </main>

    <!-- 配置弹窗 -->
    <n-modal v-model:show="showConfig" preset="card" title="配置" style="width: 520px">
      <n-space vertical :size="16">
        <div class="config-modal-row">
          <n-text class="config-modal-label">消息目录</n-text>
          <div class="config-modal-input">
            <n-input :value="config.svnPath" placeholder="选择统一管理的消息根目录" readonly size="small" />
            <n-button size="small" @click="pickDirectory('svnPath')">选择</n-button>
          </div>
        </div>
        <div class="config-modal-hint">
          自动使用消息目录下的 xml / java / c 子目录，SVN 更新和提交也使用消息目录。
        </div>
        <div class="config-modal-row">
          <n-text class="config-modal-label">主题色</n-text>
          <div class="theme-picker">
            <button
              v-for="preset in themePresets"
              :key="preset.name"
              class="theme-swatch"
              :class="{ active: config.themeAccent.toLowerCase() === preset.color.toLowerCase() }"
              :style="{ '--swatch-color': preset.color }"
              :title="preset.name"
              type="button"
              @click="config.themeAccent = preset.color"
            >
              <span class="theme-swatch-dot"></span>
              <span>{{ preset.name }}</span>
            </button>
          </div>
        </div>
        <div class="config-modal-row">
          <n-text class="config-modal-label">外观模式</n-text>
          <div class="theme-picker">
            <button
              v-for="option in themeModeOptions"
              :key="option.value"
              class="theme-mode-button"
              :class="{ active: config.themeMode === option.value }"
              type="button"
              @click="setThemeMode(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
        <div class="config-divider"></div>
        <div class="config-modal-row">
          <n-text class="config-modal-label">应用更新</n-text>
          <div class="config-modal-input" style="display:flex;align-items:center;gap:12px">
            <n-button size="small" :loading="checkingUpdate" @click="checkForUpdates()">检查更新</n-button>
            <span class="update-version-text">
              最新版本：{{ latestVersion ? `v${latestVersion}` : (currentVersion ? `v${currentVersion}` : '未检查') }}
            </span>
            <n-switch v-model:value="config.autoCheckUpdate" size="small" />
            <span style="font-size:12px;color:var(--text-muted)">启动时自动检查</span>
          </div>
        </div>
        <div class="config-divider"></div>
        <div class="config-modal-row config-modal-row--top">
          <n-text class="config-modal-label">高级操作</n-text>
          <div class="advanced-panel">
            <n-text depth="3" style="font-size: 12px">
              清空消息 ID 会删除当前协议对应的生成文件，并把已加载 XML 中的消息 ID 重置为 0（同时回写 XML 文件）。
            </n-text>
            <div class="advanced-danger-row">
              <n-input
                v-model:value="clearConfirmText"
                size="small"
                placeholder="输入 CLEAR 后启用"
              />
              <n-button
                type="error"
                ghost
                size="small"
                :disabled="!canClearMessageIds"
                :loading="clearingMessageIds"
                @click="handleClearMessageIds"
              >
                清空消息 ID
              </n-button>
            </div>
          </div>
        </div>
      </n-space>
    </n-modal>

    <!-- SVN 提交说明 -->
    <n-modal v-model:show="showSvnCommitModal" preset="card" title="SVN 提交" style="width: 560px">
      <n-space vertical :size="14">
        <div>
          <n-text class="commit-label">提交说明</n-text>
          <n-input
            v-model:value="svnCommitMessage"
            type="textarea"
            placeholder="请输入本次协议修改说明"
            :autosize="{ minRows: 3, maxRows: 5 }"
          />
        </div>
        <div v-if="svnCommitHistory.length > 0" class="commit-history">
          <n-text class="commit-label">最近提交说明</n-text>
          <n-select
            placeholder="选择历史提交说明"
            clearable
            :options="svnCommitHistoryOptions"
            @update:value="selectSvnCommitHistory"
          />
        </div>
        <n-text depth="3" style="font-size:12px">
          提交时会自动纳入新增、删除和变更文件。
        </n-text>
      </n-space>
      <template #footer>
        <n-space justify="end">
          <n-button :disabled="svnCommitting" @click="showSvnCommitModal = false">取消</n-button>
          <n-button
            type="primary"
            :loading="svnCommitting"
            :disabled="!svnCommitMessage.trim()"
            @click="handleSvnCommit"
          >
            提交
          </n-button>
        </n-space>
      </template>
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
          文件将保存至消息目录下的 xml 子目录，创建后模块名默认使用文件名。
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

    <!-- XML 解析错误 -->
    <n-modal v-model:show="showParseErrorModal" preset="card" title="XML 解析结果" style="width: min(760px, 86vw)">
      <div class="parse-error-note">
        已跳过 {{ parseErrors.length }} 个解析失败的文件，其余可解析文件已正常加载。
      </div>
      <div class="validation-list">
        <div v-for="err in parseErrors" :key="err.fileName" class="validation-item error">
          <div class="validation-item-main">
            <strong>{{ err.fileName }}</strong>
            <span>{{ err.message }}</span>
          </div>
          <small>解析失败</small>
        </div>
      </div>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showParseErrorModal = false">关闭</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 协议校验面板 -->
    <n-modal v-model:show="showValidationModal" preset="card" title="协议校验" style="width: min(860px, 88vw)">
      <div class="validation-summary">
        <span class="validation-count error">错误 {{ validationErrors.length }}</span>
        <span class="validation-count warning">提醒 {{ validationWarnings.length }}</span>
      </div>
      <div v-if="validationIssues.length === 0" class="validation-empty">当前协议结构没有发现问题</div>
      <div v-else class="validation-list">
        <div
          v-for="(issue, index) in validationIssues"
          :key="`${issue.fileName}-${issue.target}-${issue.message}-${index}`"
          class="validation-item"
          :class="issue.level"
        >
          <div class="validation-item-main">
            <strong>{{ issue.message }}</strong>
            <span>{{ issue.fileName }} / {{ issue.target }}</span>
          </div>
          <small>{{ issue.level === 'error' ? '错误' : '提醒' }}</small>
        </div>
      </div>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showValidationModal = false">关闭</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 预览弹窗 -->
    <n-modal v-model:show="showPreviewModal" preset="card" title="生成预览" style="width: min(1180px, 92vw)">
      <n-spin :show="previewLoading">
        <div class="preview-shell">
          <div class="preview-toolbar">
            <div class="preview-toolbar-title">
              <strong>{{ previewActiveName || "未选择文件" }}</strong>
              <span>共 {{ previewFiles.length }} 个文件{{ previewSkipped.length > 0 ? `，跳过 ${previewSkipped.length} 个已存在 Handler` : '' }}</span>
            </div>
            <n-button size="tiny" type="primary" :disabled="!previewActiveContent" @click="copyPreviewContent">
              复制内容
            </n-button>
          </div>

          <div v-if="previewFiles.length === 0 && !previewLoading" class="preview-empty">
            暂无预览内容
          </div>
          <div v-else class="preview-body">
            <aside class="preview-file-list">
              <div class="preview-list-title">文件列表</div>
              <n-input
                v-model:value="previewFileSearch"
                size="tiny"
                clearable
                placeholder="搜索文件"
                class="preview-search"
              />
              <button
                v-for="f in filteredPreviewFiles"
                :key="f.path"
                class="preview-file-item"
                :class="{ active: previewActiveFile === f.path }"
                type="button"
                @click="previewActiveFile = f.path"
              >
                <span class="preview-file-name">{{ getFileName(f.path) }}</span>
                <span class="preview-file-path">{{ getFileDir(f.path) }}</span>
              </button>
              <div v-if="previewFiles.length > 0 && filteredPreviewFiles.length === 0" class="preview-list-empty">
                无匹配文件
              </div>
              <div v-if="previewSkipped.length > 0" class="preview-skipped">
                <div class="preview-list-title">已跳过</div>
                <div v-for="p in previewSkipped" :key="p" class="preview-file-item skipped">
                  <span class="preview-file-name">{{ getFileName(p) }}</span>
                  <span class="preview-file-path">{{ getFileDir(p) }}</span>
                </div>
              </div>
            </aside>
            <main class="preview-content">
              <template v-if="previewActiveContent">
                <div class="preview-content-header">
                  <span>{{ previewActiveFile }}</span>
                  <div class="preview-content-tools">
                    <n-input
                      ref="previewSearchRef"
                      v-model:value="previewContentSearch"
                      size="tiny"
                      clearable
                      placeholder="搜索内容"
                    />
                    <small>{{ previewContentSearch ? `${previewSearchMatches} 处` : '' }}</small>
                  </div>
                </div>
                <Codemirror
                  v-model="previewEditorContent"
                  :extensions="previewEditorExtensions"
                  :basic="true"
                  :disabled="true"
                  class="preview-code-editor"
                />
              </template>
              <div v-else class="preview-empty">
                请选择左侧文件查看内容
              </div>
            </main>
          </div>
        </div>
      </n-spin>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showPreviewModal = false">关闭</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 应用更新弹窗 -->
    <n-modal v-model:show="showUpdateModal" preset="card" title="应用更新" style="width: 480px">
      <n-spin :show="checkingUpdate && !updateInfo">
        <template v-if="installingUpdate">
          <n-space vertical :size="16">
            <n-text>{{ updateProgressLabel }}</n-text>
            <n-progress
              v-if="updateTotal > 0"
              type="line"
              :percentage="updateProgressPercentage"
              :show-indicator="true"
            />
            <n-progress
              v-else
              type="line"
              :show-indicator="false"
              status="info"
              processing
            />
          </n-space>
        </template>
        <template v-else-if="updateInfo">
          <template v-if="updateInfo.hasUpdate">
            <n-space vertical :size="12">
              <n-text>
                发现新版本 <strong>v{{ updateInfo.version }}</strong>（当前 v{{ updateInfo.currentVersion }}）
              </n-text>
              <n-text v-if="updateInfo.date" depth="3" style="font-size: 12px">
                发布日期：{{ updateInfo.date }}
              </n-text>
              <div v-if="updateInfo.body" class="update-changelog">
                <n-text depth="3" style="font-size: 12px; white-space: pre-wrap;">{{ updateInfo.body }}</n-text>
              </div>
            </n-space>
          </template>
          <template v-else>
            <n-text>当前已是最新版本 🎉</n-text>
          </template>
        </template>
        <template v-else>
          <n-text depth="3">正在检查更新...</n-text>
        </template>
      </n-spin>
      <template #footer>
        <n-space justify="end">
          <template v-if="installingUpdate">
            <n-button :loading="cancellingUpdate" @click="cancelUpdateDownload">取消下载</n-button>
          </template>
          <template v-else>
            <n-button @click="showUpdateModal = false">关闭</n-button>
            <n-button
              v-if="updateInfo?.hasUpdate"
              type="primary"
              @click="handleUpdateDownload"
            >
              下载并安装
            </n-button>
          </template>
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
  background: var(--bg-app);
  color: var(--text-primary);
}

.sider {
  width: 240px;
  flex-shrink: 0;
  background: var(--bg-sider);
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-subtle);
}

.sider-header {
  flex-shrink: 0;
  padding: 12px;
}

.title {
  display: block;
  color: var(--brand);
  font-size: 14px;
  font-weight: bold;
  margin-bottom: 12px;
}

.sider-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 8px;
}

.sider-action-full {
  grid-column: 1 / -1;
}

.config-modal-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.config-modal-row--top {
  align-items: flex-start;
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

.config-modal-hint {
  margin-top: -8px;
  padding-left: 118px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.update-version-text {
  min-width: 118px;
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.config-divider {
  height: 1px;
  background: var(--border-subtle);
}

.advanced-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.advanced-danger-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.commit-label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.commit-history {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.theme-picker {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.theme-swatch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 9px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
}

.theme-swatch:hover,
.theme-swatch.active {
  border-color: var(--swatch-color);
  color: var(--text-primary);
  background: var(--bg-panel-hover);
}

.theme-swatch.active {
  box-shadow: 0 0 0 2px var(--brand-soft);
}

.theme-swatch-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--swatch-color);
  box-shadow: 0 0 0 2px var(--swatch-ring);
}

.theme-mode-button {
  height: 28px;
  padding: 0 14px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
}

.theme-mode-button:hover,
.theme-mode-button.active {
  border-color: var(--brand);
  color: var(--text-primary);
  background: var(--brand-soft);
}

.file-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px 12px;
  min-height: 0;
}

.file-search {
  margin-bottom: 10px;
}

.file-list-title {
  margin-bottom: 8px;
}

.file-item {
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
}

.file-item.active {
  background: var(--bg-panel-hover);
}

.file-item.active span {
  color: var(--brand);
}

.file-dirty-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--warning);
  margin-left: auto;
}

.empty {
  text-align: center;
  color: var(--text-muted);
  padding: 40px 0;
}

.empty-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.sider-footer {
  flex-shrink: 0;
  padding: 10px 12px;
  border-top: 1px solid var(--border-subtle);
}

.settings-button {
  width: 100%;
  height: 30px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  font-size: 13px;
}

.settings-button:hover {
  color: var(--text-primary);
  background: var(--bg-panel-hover);
}

.settings-accent {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--brand);
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bg-app);
  min-width: 0;
  min-height: 0;
}

.editor-tab {
  flex-shrink: 0;
  padding: 8px 12px;
  background: var(--bg-panel);
  font-size: 12px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  gap: 10px;
}
.editor-title-block {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.editor-tab-title {
  color: var(--text-primary);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.editor-tab-meta {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.editor-tab-dirty {
  color: var(--warning);
  font-size: 11px;
  white-space: nowrap;
}
.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.toolbar-group {
  display: flex;
  align-items: center;
  gap: 5px;
  padding-left: 10px;
  border-left: 1px solid var(--border-subtle);
}
.toolbar-group:first-child {
  padding-left: 0;
  border-left: 0;
}
.toolbar-group--primary {
  padding-right: 2px;
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
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-app);
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
  background: var(--bg-panel-hover);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  padding: 4px 0;
  min-width: 130px;
  box-shadow: 0 4px 14px var(--shadow-strong);
}
.ctx-item {
  padding: 7px 16px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  user-select: none;
}
.ctx-item:hover {
  background: var(--bg-input);
}
.ctx-item--danger {
  color: var(--danger);
}
.ctx-item--danger:hover {
  background: var(--danger-soft);
}

/* ---- 校验面板 ---- */
.validation-summary {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.parse-error-note {
  margin-bottom: 12px;
  color: var(--text-secondary);
  font-size: 13px;
}
.validation-count {
  padding: 3px 8px;
  border-radius: 5px;
  font-size: 12px;
  background: var(--bg-input);
  color: var(--text-secondary);
}
.validation-count.error {
  color: var(--danger);
  background: var(--danger-soft);
}
.validation-count.warning {
  color: var(--warning);
  background: var(--bg-input);
}
.validation-empty {
  padding: 32px 0;
  text-align: center;
  color: var(--text-muted);
}
.validation-list {
  max-height: 52vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.validation-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 10px;
  border: 1px solid var(--border-subtle);
  border-left-width: 3px;
  border-radius: 6px;
  background: var(--bg-panel);
}
.validation-item.error {
  border-left-color: var(--danger);
}
.validation-item.warning {
  border-left-color: var(--warning);
}
.validation-item-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.validation-item-main strong {
  color: var(--text-primary);
  font-size: 13px;
}
.validation-item-main span,
.validation-item small {
  color: var(--text-muted);
  font-size: 11px;
}

/* ---- 预览弹窗 ---- */
.preview-shell {
  height: min(72vh, 720px);
  min-height: 480px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-app);
}
.preview-toolbar {
  min-height: 48px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-panel);
}
.preview-toolbar-title {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.preview-toolbar-title strong {
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-size: 14px;
}
.preview-toolbar-title span {
  color: var(--text-muted);
  font-size: 12px;
}
.preview-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  padding: 40px;
  text-align: center;
}
.preview-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
}
.preview-file-list {
  min-height: 0;
  overflow-y: auto;
  border-right: 1px solid var(--border-subtle);
  padding: 10px;
  background: var(--bg-sider);
}
.preview-list-title {
  margin: 2px 4px 8px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
}
.preview-search {
  margin-bottom: 8px;
}
.preview-list-empty {
  padding: 16px 8px;
  color: var(--text-muted);
  text-align: center;
  font-size: 12px;
}
.preview-file-item {
  width: 100%;
  min-height: 42px;
  display: block;
  margin: 0 0 6px;
  padding: 7px 9px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: var(--text-secondary);
}
.preview-file-item:hover {
  background: var(--bg-panel-hover);
}
.preview-file-item.active {
  background: var(--brand-soft);
}
.preview-file-item.active .preview-file-name {
  color: var(--brand);
}
.preview-file-item.skipped {
  cursor: default;
  opacity: 0.5;
  background: transparent;
}
.preview-file-name {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preview-file-path {
  display: block;
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.preview-skipped {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border-subtle);
}
.preview-content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-app);
}
.preview-content-header {
  flex-shrink: 0;
  min-height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 12px;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border-subtle);
}
.preview-content-header span {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.preview-content-tools {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.preview-content-tools small {
  width: 42px;
  color: var(--text-muted);
  font-size: 11px;
  text-align: right;
}
.preview-code-editor {
  flex: 1;
  min-height: 0;
}
.preview-code-editor :deep(.cm-editor) {
  height: 100%;
}
.preview-code-editor :deep(.cm-scroller) {
  overflow: auto;
}
.preview-code-editor :deep(.cm-gutters) {
  background-color: var(--bg-panel);
  color: var(--text-secondary);
  border-right-color: var(--border-subtle);
}
.preview-code {
  flex: 1;
  margin: 0;
  padding: 12px;
  overflow: auto;
  background: var(--bg-app);
  color: var(--text-primary);
  font-family: "SF Mono", "Fira Code", monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
  tab-size: 4;
}

/* ---- 更新日志 ---- */
.update-changelog {
  max-height: 140px;
  overflow-y: auto;
  padding: 8px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
}
</style>
