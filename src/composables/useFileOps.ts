/**
 * 文件操作逻辑：加载、新建、重命名、删除
 */
import { ref } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import { mkdir, readTextFile, readDir, writeTextFile, remove, rename } from "@tauri-apps/plugin-fs";
import { parseXmlModule } from "@/utils/xmlParser";
import { applyManagedMessagePaths } from "@/utils/managedPaths";
import type { ModuleDef } from "@/generator/types";

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e ?? "未知错误");
}

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

export function useFileOps(
  config: { svnPath: string; xmlPath: string; backendPath: string; frontendPath: string },
  message: { success: (m: string) => void; error: (m: string) => void; warning: (m: string) => void },
) {
  const parsedModules = ref<ModuleDef[]>([]);
  const parsing = ref(false);
  const parseErrors = ref<{ fileName: string; message: string }[]>([]);
  const showParseErrorModal = ref(false);

  // 新建文件
  const showNewFileModal = ref(false);
  const newFileName = ref("");
  const creatingFile = ref(false);

  // 右键菜单
  const showContextMenu = ref(false);
  const contextMenuX = ref(0);
  const contextMenuY = ref(0);
  const contextMenuFile = ref<string | null>(null);

  // 重命名
  const showRenameModal = ref(false);
  const renameFileName = ref("");
  const renamingFile = ref(false);

  // 删除
  const showDeleteModal = ref(false);
  const deletingFile = ref(false);

  // activeFile 由外部管理，通过回调通知
  let activeFileSetter: ((v: string | null) => void) | null = null;
  let activeFileGetter: (() => string | null) | null = null;

  function setActiveFileAccessors(getter: () => string | null, setter: (v: string | null) => void) {
    activeFileGetter = getter;
    activeFileSetter = setter;
  }

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

  async function loadXmlFromDirectory(dirPath: string) {
    if (!dirPath) return;
    parsing.value = true;
    try {
      await ensureManagedDirs();
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
      const previousActiveFile = activeFileGetter?.();
      parsedModules.value = parseFilesWithErrors(files);
      if (parsedModules.value.length > 0) {
        const nextActiveFile = parsedModules.value.some((mod) => mod.fileName === previousActiveFile)
          ? previousActiveFile
          : parsedModules.value[0].fileName;
        activeFileSetter?.(nextActiveFile ?? null);
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
    config.svnPath = selected as string;
    await ensureManagedDirs();
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
        activeFileSetter?.(parsedModules.value[0].fileName);
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

  function openNewFileModal() {
    applyManagedMessagePaths(config);
    if (!config.xmlPath) {
      message.warning("请先在配置中设置消息目录");
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
      await ensureManagedDirs();
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
      if (activeFileGetter?.() === oldName) {
        activeFileSetter?.(newName);
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
      if (activeFileGetter?.() === fileName) {
        activeFileSetter?.(null);
      }
      await loadXmlFromDirectory(config.xmlPath);
    } catch (e) {
      message.error("删除失败: " + errMsg(e));
    } finally {
      deletingFile.value = false;
    }
  }

  return {
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
    parseFilesWithErrors,
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
  };
}
