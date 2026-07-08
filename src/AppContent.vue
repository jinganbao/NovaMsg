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
import { parseXmlFiles, parseXmlModule } from "@/utils/xmlParser";
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
import { java } from "@codemirror/lang-java";
import { StreamLanguage } from "@codemirror/language";
import { csharp } from "@codemirror/legacy-modes/mode/clike";
import { oneDark } from "@codemirror/theme-one-dark";

const message = useMessage();

/** 安全提取错误消息 */
function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e ?? "未知错误");
}

const parsedModules = ref<ModuleDef[]>([]);
const parsing = ref(false);
const parseErrors = ref<{ fileName: string; message: string }[]>([]);
const showParseErrorModal = ref(false);

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

function parseFilesWithErrors(files: { name: string; content: string }[]): ModuleDef[] {
  const modules: ModuleDef[] = [];
  const errors: { fileName: string; message: string }[] = [];
  for (const file of files) {
    try {
      const mod = parseXmlModule(file.content);
      mod.fileName = file.name;
      mod.rawContent = file.content;
      modules.push(mod);
    } catch (e) {
      errors.push({ fileName: file.name, message: errMsg(e) });
    }
  }
  parseErrors.value = errors;
  showParseErrorModal.value = errors.length > 0;
  return modules;
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
const clearingMessageIds = ref(false);
const clearConfirmText = ref("");

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
    clearConfirmText.value = "";
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
const fileSearchRef = ref();
const previewSearchRef = ref();

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
  config.themeMode === "dark" ? oneDark : lightEditorTheme,
]);

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
    parsedModules.value = parseFilesWithErrors(files);
    if (parsedModules.value.length > 0) {
      activeFile.value = parsedModules.value[0].fileName;
    }
    if (parseErrors.value.length > 0) {
      message.warning(`成功加载 ${parsedModules.value.length} 个模块文件，${parseErrors.value.length} 个文件解析失败`);
    } else {
      message.success(`成功加载 ${parsedModules.value.length} 个模块文件`);
    }
  } catch (e) {
    message.error("加载失败: " + errMsg(e));
  } finally {
    parsing.value = false;
  }
}

async function pickXmlDirectoryAndLoad() {
  const selected = await open({ directory: true });
  if (!selected) return;
  config.xmlPath = selected as string;
  await loadXmlFromDirectory(config.xmlPath);
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
    parsedModules.value = parseFilesWithErrors(files);
    if (parsedModules.value.length > 0) {
      activeFile.value = parsedModules.value[0].fileName;
    }
    if (parseErrors.value.length > 0) {
      message.warning(`成功解析 ${parsedModules.value.length} 个模块文件，${parseErrors.value.length} 个文件失败`);
    } else {
      message.success(`成功解析 ${parsedModules.value.length} 个模块文件`);
    }
  } catch (e) {
    message.error("解析失败: " + errMsg(e));
  } finally {
    parsing.value = false;
  }
}

const config = useConfig();

const showConfig = ref(false);
const fileSearch = ref("");

const themePresets = [
  { name: "NovaMsg", color: "#3DD6C6" },
  { name: "NovaDB", color: "#5BA8FF" },
  { name: "NovaFlow", color: "#A3E635" },
  { name: "NovaOps", color: "#F59E0B" },
  { name: "NovaAI", color: "#8BDAFF" },
];

const themeModeOptions = [
  { label: "暗色", value: "dark" },
  { label: "亮色", value: "light" },
];

function setThemeMode(mode: string) {
  if (mode === "dark" || mode === "light") {
    config.themeMode = mode;
  }
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized;
  const num = Number.parseInt(value, 16);
  if (Number.isNaN(num)) return { r: 61, g: 214, b: 198 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function mix(hex: string, target: string, weight: number) {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  const channel = (x: number, y: number) => Math.round(x * (1 - weight) + y * weight);
  return `#${[channel(a.r, b.r), channel(a.g, b.g), channel(a.b, b.b)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("")}`;
}

function rgba(hex: string, alpha: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const themeVars = computed(() => {
  const accent = config.themeAccent || "#3DD6C6";
  const dark = config.themeMode === "dark";
  return {
    "--bg-app": dark ? "#111418" : "#F7F9FC",
    "--bg-sider": dark ? "#15191E" : "#EEF3F7",
    "--bg-panel": dark ? "#1B2027" : "#FFFFFF",
    "--bg-panel-hover": dark ? "#222832" : "#EAF0F7",
    "--bg-input": dark ? "#2A3038" : "#F1F5F9",
    "--border-subtle": dark ? "#2B323C" : "#D8E0EA",
    "--border-strong": dark ? "#39424E" : "#BCC8D6",
    "--text-primary": dark ? "#E7ECF3" : "#17202A",
    "--text-secondary": dark ? "#9AA5B5" : "#5D6978",
    "--text-muted": dark ? "#6F7A89" : "#7B8797",
    "--brand": accent,
    "--brand-hover": mix(accent, "#FFFFFF", 0.18),
    "--brand-active": mix(accent, "#000000", 0.18),
    "--brand-soft": rgba(accent, dark ? 0.14 : 0.12),
    "--focus": dark ? "#7DD3FC" : "#0284C7",
    "--danger": dark ? "#F87171" : "#DC2626",
    "--warning": dark ? "#FBBF24" : "#B7791F",
    "--success": dark ? "#4ADE80" : "#15803D",
    "--danger-soft": dark ? "rgba(248, 113, 113, 0.12)" : "rgba(220, 38, 38, 0.08)",
    "--shadow-strong": dark ? "rgba(0, 0, 0, 0.6)" : "rgba(15, 23, 42, 0.16)",
    "--swatch-ring": dark ? "rgba(255, 255, 255, 0.08)" : "rgba(15, 23, 42, 0.12)",
  };
});

const filteredModules = computed(() => {
  const keyword = fileSearch.value.trim().toLowerCase();
  if (!keyword) return parsedModules.value;
  return parsedModules.value.filter((mod) =>
    mod.fileName.toLowerCase().includes(keyword) ||
    mod.moduleName.toLowerCase().includes(keyword),
  );
});

const xmlPathLabel = computed(() => {
  if (!config.xmlPath) return "未选择 XML 目录";
  const parts = config.xmlPath.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : config.xmlPath;
});

const canClearMessageIds = computed(() => clearConfirmText.value.trim() === "CLEAR");

watch(themeVars, (vars) => {
  for (const [key, value] of Object.entries(vars)) {
    document.documentElement.style.setProperty(key, value);
  }
}, { immediate: true });

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
    existing.structs = mod.structs;
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

type ValidationIssue = {
  level: "error" | "warning";
  fileName: string;
  target: string;
  message: string;
};

const showValidationModal = ref(false);
const validationIssues = ref<ValidationIssue[]>([]);
const validationErrors = computed(() => validationIssues.value.filter((issue) => issue.level === "error"));
const validationWarnings = computed(() => validationIssues.value.filter((issue) => issue.level === "warning"));

const primitiveTypeSet = new Set(["int", "long", "float", "double", "string", "boolean", "short", "byte"]);
const javaKeywordSet = new Set([
  "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char", "class", "const", "continue", "default",
  "do", "double", "else", "enum", "extends", "final", "finally", "float", "for", "goto", "if", "implements", "import",
  "instanceof", "int", "interface", "long", "native", "new", "package", "private", "protected", "public", "return",
  "short", "static", "strictfp", "super", "switch", "synchronized", "this", "throw", "throws", "transient", "try",
  "void", "volatile", "while",
]);
const csharpKeywordSet = new Set([
  "abstract", "as", "base", "bool", "break", "byte", "case", "catch", "char", "checked", "class", "const", "continue",
  "decimal", "default", "delegate", "do", "double", "else", "enum", "event", "explicit", "extern", "false", "finally",
  "fixed", "float", "for", "foreach", "goto", "if", "implicit", "in", "int", "interface", "internal", "is", "lock",
  "long", "namespace", "new", "null", "object", "operator", "out", "override", "params", "private", "protected",
  "public", "readonly", "ref", "return", "sbyte", "sealed", "short", "sizeof", "stackalloc", "static", "string",
  "struct", "switch", "this", "throw", "true", "try", "typeof", "uint", "ulong", "unchecked", "unsafe", "ushort",
  "using", "virtual", "void", "volatile", "while",
]);

function parseListElementType(type: string): string | null {
  const clean = type.trim();
  const angleMatch = clean.match(/^(?:array|list|java\.util\.List)<(.+)>$/i);
  if (angleMatch) return angleMatch[1].trim();
  const bracketMatch = clean.match(/^(.+)\[\]$/);
  if (bracketMatch) return bracketMatch[1].trim();
  return null;
}

function normalizeFieldType(type: string): string {
  const clean = (parseListElementType(type) ?? type).trim().replace(/^java\.lang\./i, "").replace(/\s+/g, "");
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

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

function lowerFirst(value: string): string {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

function upperFirst(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function addDuplicateIssues(
  issues: ValidationIssue[],
  fileName: string,
  target: string,
  fields: { name: string }[],
) {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const field of fields) {
    const name = field.name.trim();
    if (!name) continue;
    if (seen.has(name)) duplicated.add(name);
    seen.add(name);
  }
  for (const name of duplicated) {
    issues.push({ level: "error", fileName, target, message: `字段名重复：${name}` });
  }
}

function validateModules(modules: ModuleDef[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const mod of modules) {
    const fileName = mod.fileName || "未命名文件";
    const structNames = new Set((mod.structs ?? []).map((struct) => struct.name.trim()).filter(Boolean));
    const seenStructNames = new Set<string>();
    const seenMessageNames = new Set<string>();

    if (!mod.moduleName.trim()) {
      issues.push({ level: "error", fileName, target: "模块", message: "模块名不能为空" });
    }

    for (const struct of mod.structs ?? []) {
      const target = `对象 ${struct.name || "未命名对象"}`;
      const name = struct.name.trim();
      if (!name) issues.push({ level: "error", fileName, target, message: "对象名不能为空" });
      else {
        if (seenStructNames.has(name)) issues.push({ level: "error", fileName, target, message: `对象名重复：${name}` });
        seenStructNames.add(name);
        if (!isIdentifier(name)) issues.push({ level: "error", fileName, target, message: "对象名不是合法 Java/C# 标识符" });
        if (javaKeywordSet.has(name) || csharpKeywordSet.has(name)) issues.push({ level: "error", fileName, target, message: "对象名不能使用 Java/C# 关键字" });
      }
      addDuplicateIssues(issues, fileName, target, struct.fields);
      for (const field of struct.fields) {
        validateField(issues, fileName, target, field, structNames);
      }
    }

    for (const msg of mod.messages) {
      const target = `消息 ${msg.type}_${msg.name || "未命名消息"}`;
      const name = msg.name.trim();
      if (!name) issues.push({ level: "error", fileName, target, message: "消息名不能为空" });
      else {
        const fullName = msg.name.startsWith(msg.type + "_") ? msg.name : `${msg.type}_${msg.name}`;
        if (seenMessageNames.has(fullName)) issues.push({ level: "error", fileName, target, message: `消息名重复：${fullName}` });
        seenMessageNames.add(fullName);
        if (!isIdentifier(name)) issues.push({ level: "error", fileName, target, message: "消息名不是合法 Java/C# 标识符" });
        if (javaKeywordSet.has(name) || csharpKeywordSet.has(name)) issues.push({ level: "error", fileName, target, message: "消息名不能使用 Java/C# 关键字" });
      }
      if (!["C2S", "S2C", "S2P", "P2S"].includes(msg.type)) {
        issues.push({ level: "error", fileName, target, message: `未知消息方向：${msg.type}` });
      }
      addDuplicateIssues(issues, fileName, target, msg.fields);
      for (const field of msg.fields) {
        validateField(issues, fileName, target, field, structNames);
      }
    }
  }

  return issues;
}

function validateField(
  issues: ValidationIssue[],
  fileName: string,
  target: string,
  field: { type: string; name: string },
  structNames: Set<string>,
) {
  const name = field.name.trim();
  if (!name) {
    issues.push({ level: "error", fileName, target, message: "字段名不能为空" });
  } else {
    if (!isIdentifier(name)) issues.push({ level: "error", fileName, target, message: `字段名不是合法标识符：${name}` });
    const javaName = lowerFirst(name);
    const csharpName = upperFirst(name);
    if (javaKeywordSet.has(javaName)) {
      issues.push({ level: "error", fileName, target, message: `字段名生成到 Java 后是关键字：${javaName}` });
    }
    if (csharpKeywordSet.has(csharpName)) {
      issues.push({ level: "error", fileName, target, message: `字段名生成到 C# 后是关键字：${csharpName}` });
    }
  }
  const type = normalizeFieldType(field.type);
  if (!type) {
    issues.push({ level: "error", fileName, target, message: `字段 ${name || "未命名字段"} 类型不能为空` });
  } else if (!primitiveTypeSet.has(type) && !structNames.has(type)) {
    issues.push({ level: "error", fileName, target, message: `字段 ${name || "未命名字段"} 引用了不存在的对象类型：${type}` });
  }
}

function runValidation(options: { showSuccess?: boolean } = {}): boolean {
  validationIssues.value = validateModules(parsedModules.value);
  if (validationIssues.value.length > 0) {
    showValidationModal.value = true;
  }
  if (validationErrors.value.length > 0) {
    message.error(`发现 ${validationErrors.value.length} 个协议错误，请先修复`);
    return false;
  }
  if (options.showSuccess) {
    message.success(validationWarnings.value.length > 0
      ? `校验通过，有 ${validationWarnings.value.length} 个提醒`
      : "校验通过");
  }
  return true;
}

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
      const fullName = msg.name.startsWith(msg.type + "_") ? msg.name : msg.type + "_" + msg.name;
      msg.id = await invoke<number>("get_message_id", {
        name: fullName,
        msgType: msg.type,
      });
    }
  }
}

async function doGenerate() {
  if (!canGenerate.value) {
    message.warning("请先完成路径配置");
    return;
  }
  if (!runValidation()) return;
  await autoAssignIds();
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
const showPreviewModal = ref(false);
const previewFiles = ref<PreviewFile[]>([]);
const previewSkipped = ref<string[]>([]);
const previewActiveFile = ref("");
const previewLoading = ref(false);
const previewFileSearch = ref("");
const previewContentSearch = ref("");

const previewActiveContent = computed(() => {
  const f = previewFiles.value.find((p) => p.path === previewActiveFile.value);
  return f?.content ?? "";
});
const previewEditorContent = computed({
  get: () => previewActiveContent.value,
  set: () => {},
});

const previewActiveName = computed(() => getFileName(previewActiveFile.value));
const filteredPreviewFiles = computed(() => {
  const keyword = previewFileSearch.value.trim().toLowerCase();
  if (!keyword) return previewFiles.value;
  return previewFiles.value.filter((file) =>
    getFileName(file.path).toLowerCase().includes(keyword) ||
    file.path.toLowerCase().includes(keyword),
  );
});
const previewSearchMatches = computed(() => {
  const keyword = previewContentSearch.value;
  if (!keyword || !previewActiveContent.value) return 0;
  let count = 0;
  let index = 0;
  const lowerContent = previewActiveContent.value.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  while (true) {
    index = lowerContent.indexOf(lowerKeyword, index);
    if (index < 0) break;
    count += 1;
    index += Math.max(lowerKeyword.length, 1);
  }
  return count;
});
const previewEditorExtensions = computed(() => {
  const ext = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    EditorView.editable.of(false),
    EditorView.lineWrapping,
  ];
  if (previewActiveFile.value.endsWith(".xml")) ext.push(xml());
  else if (previewActiveFile.value.endsWith(".java")) ext.push(java());
  else if (previewActiveFile.value.endsWith(".cs")) ext.push(StreamLanguage.define(csharp));
  ext.push(config.themeMode === "dark" ? oneDark : lightEditorTheme);
  return ext;
});

function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function getFileDir(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join("/");
}

async function copyPreviewContent() {
  const content = previewActiveContent.value;
  if (!content) {
    message.warning("当前文件没有可复制的内容");
    return;
  }
  try {
    await navigator.clipboard.writeText(content);
    message.success(`已复制 ${previewActiveName.value || "当前文件"}`);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = content;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (copied) {
      message.success(`已复制 ${previewActiveName.value || "当前文件"}`);
    } else {
      message.error("复制失败，请手动复制");
    }
  }
}

async function doPreview() {
  if (!selectedModule.value) {
    message.warning("请先在左侧选择一个文件");
    return;
  }
  if (!canGenerate.value) {
    message.warning("请先完成路径配置");
    return;
  }
  if (!runValidation()) return;
  await autoAssignIds();
  if (!runValidation()) return;
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
  <div class="app-root" :style="themeVars" @contextmenu.prevent @click="closeContextMenu">
    <!-- 左侧：文件列表 -->
    <aside class="sider">
      <div class="sider-header">
        <span class="title">NovaMsg</span>
        <div class="sider-actions">
          <n-button type="primary" size="tiny" style="flex: 1" :loading="parsing" @click="pickXmlDirectoryAndLoad">选择目录</n-button>
          <n-button size="tiny" style="flex: 1" :loading="parsing" @click="openNewFileModal">+ 新建</n-button>
        </div>
        <div class="path-chip" :title="config.xmlPath">{{ xmlPathLabel }}</div>
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
            <n-button size="small" type="primary" @click="pickXmlDirectoryAndLoad">选择 XML 目录</n-button>
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
          <n-button size="tiny" :type="viewMode === 'form' ? 'primary' : 'default'" @click="setViewMode('form')">表单</n-button>
          <n-button size="tiny" :type="viewMode === 'xml' ? 'primary' : 'default'" @click="setViewMode('xml')">XML</n-button>
          <n-button size="tiny" :disabled="!activeFile || !isDirty" @click="saveCurrentFile">保存</n-button>
          <n-button size="tiny" :disabled="parsedModules.length === 0" @click="runValidation({ showSuccess: true })">校验</n-button>
          <n-button size="tiny" @click="handlePreview">预览</n-button>
          <n-button type="primary" size="tiny" :disabled="!canGenerate" @click="handleGenerate">生成</n-button>
        </div>
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
        <n-text style="font-size: 12px; color: var(--text-muted)">
          共 {{ parsedModules.length }} 个模块
          <span v-if="config.frontendPath && config.backendPath"> · 输出路径已配置</span>
          <span v-else> · 尚未完成输出路径配置</span>
        </n-text>
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
        <div class="config-modal-row config-modal-row--top">
          <n-text class="config-modal-label">高级操作</n-text>
          <div class="advanced-panel">
            <n-text depth="3" style="font-size: 12px">
              清空本地消息 ID 会删除当前协议对应的生成文件，并把已加载 XML 的消息 ID 重置为 0。
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
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
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

.path-chip {
  min-height: 24px;
  padding: 4px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  color: var(--text-muted);
  background: var(--bg-input);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  gap: 6px;
  flex-shrink: 0;
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
</style>
