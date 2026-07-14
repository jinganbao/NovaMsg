/**
 * 预览逻辑
 */
import { ref, computed } from "vue";
import { previewProtocols } from "@/generator";
import type { PreviewFile } from "@/generator";
import type { ModuleDef, GenerateOptions } from "@/generator/types";
import { EditorView, lineNumbers, highlightActiveLineGutter, highlightActiveLine } from "@codemirror/view";
import { xml } from "@codemirror/lang-xml";
import { java } from "@codemirror/lang-java";
import { StreamLanguage } from "@codemirror/language";
import { csharp } from "@codemirror/legacy-modes/mode/clike";
import { oneDark } from "@codemirror/theme-one-dark";

type EditorExtension = ReturnType<typeof EditorView.theme> | ReturnType<typeof lineNumbers>;

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e ?? "未知错误");
}

export function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function getFileDir(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join("/");
}

export function usePreview(
  config: { themeMode: string },
  message: { success: (m: string) => void; error: (m: string) => void; warning: (m: string) => void },
  lightEditorTheme: EditorExtension,
  darkEditorTheme: EditorExtension,
) {
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
    if (config.themeMode === "dark") {
      ext.push(oneDark, darkEditorTheme);
    } else {
      ext.push(lightEditorTheme);
    }
    return ext;
  });

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

  async function doPreview(
    selectedModule: ModuleDef | undefined,
    allModules: ModuleDef[],
    canGenerate: boolean,
    frontendPath: string,
    backendPath: string,
    buildGenerateOptions: (modules: ModuleDef[]) => GenerateOptions,
    runValidation: () => boolean,
    autoAssignIds: () => Promise<boolean>,
  ) {
    if (!selectedModule) {
      message.warning("请先在左侧选择一个文件");
      return;
    }
    if (!canGenerate) {
      message.warning("请先配置消息目录");
      return;
    }
    if (!runValidation()) return;
    if (!await autoAssignIds()) return;
    if (!runValidation()) return;
    previewLoading.value = true;
    showPreviewModal.value = true;
    previewFiles.value = [];
    previewSkipped.value = [];
    previewActiveFile.value = "";
    try {
      const modulesToPreview = allModules.length > 0 ? allModules : [selectedModule];
      const result = await previewProtocols(
        modulesToPreview,
        frontendPath,
        backendPath,
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

  return {
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
    doPreview,
    getFileName,
    getFileDir,
  };
}
