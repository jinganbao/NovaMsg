/**
 * 消息 ID 分配与清空逻辑
 */
import { ref, computed } from "vue";
import { writeTextFile, remove } from "@tauri-apps/plugin-fs";
import { moduleToXml } from "@/utils/xmlSerializer";
import { previewProtocols } from "@/generator";
import type { ModuleDef, GenerateOptions } from "@/generator/types";

/** 消息 ID 分配区间 */
const ID_RANGES: Record<string, [number, number]> = {
  S2P: [1000, 4999],
  P2S: [5000, 9999],
  C2S: [10000, 19999],
  S2C: [20000, 29999],
};

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e ?? "未知错误");
}

export function useMessageIds(
  config: { xmlPath: string; frontendPath: string; backendPath: string },
  message: { success: (m: string) => void; error: (m: string) => void },
) {
  const clearingMessageIds = ref(false);
  const clearConfirmText = ref("");
  const canClearMessageIds = computed(() => clearConfirmText.value.trim() === "CLEAR");

  /**
   * 为所有 id==0 的消息分配稳定 ID（按类型分区间）。
   * ID 直接写入 XML 文件，确保多人协作时一致。
   */
  async function autoAssignIds(
    parsedModules: ModuleDef[],
    selectedModule: ModuleDef | undefined,
    onEditorUpdate: (xml: string) => void,
  ): Promise<boolean> {
    const hasMissingId = parsedModules.some((mod) => mod.messages.some((msg) => msg.id === 0));
    if (hasMissingId && !config.xmlPath) {
      message.error("消息 ID 需要写回 XML，请先选择消息目录");
      return false;
    }

    // 1. 收集各类型当前已使用的最大 ID
    const maxByType: Record<string, number> = {};
    for (const mod of parsedModules) {
      for (const msg of mod.messages) {
        if (msg.id > 0 && ID_RANGES[msg.type]) {
          if (!maxByType[msg.type] || msg.id > maxByType[msg.type]) {
            maxByType[msg.type] = msg.id;
          }
        }
      }
    }

    // 2. 为 id==0 的消息分配新 ID
    const changedModules = new Set<ModuleDef>();
    for (const mod of parsedModules) {
      for (const msg of mod.messages) {
        if (msg.id !== 0) continue;
        const range = ID_RANGES[msg.type];
        if (!range) continue;
        const [minId, maxId] = range;
        const nextId = (maxByType[msg.type] ?? minId - 1) + 1;
        if (nextId > maxId) {
          message.error(`${msg.type} 消息 ID 已超出可分配范围 ${minId}-${maxId}`);
          return false;
        }
        msg.id = nextId;
        maxByType[msg.type] = nextId;
        changedModules.add(mod);
      }
    }

    // 3. 回写 XML 文件
    if (changedModules.size > 0) {
      const sep = config.xmlPath && !config.xmlPath.endsWith("/") ? "/" : "";
      for (const mod of changedModules) {
        mod.rawContent = moduleToXml(mod);
        if (config.xmlPath) {
          await writeTextFile(`${config.xmlPath}${sep}${mod.fileName}`, mod.rawContent);
        }
      }
      if (selectedModule && changedModules.has(selectedModule)) {
        const xml = selectedModule.rawContent ?? moduleToXml(selectedModule);
        onEditorUpdate(xml);
      }
    }

    return true;
  }

  function resetLoadedMessageIds(
    parsedModules: ModuleDef[],
    selectedModule: ModuleDef | undefined,
    onEditorUpdate: (xml: string) => void,
  ) {
    for (const mod of parsedModules) {
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
    if (selectedModule) {
      onEditorUpdate(selectedModule.rawContent ?? moduleToXml(selectedModule));
    }
  }

  async function deleteGeneratedProtocolFiles(
    parsedModules: ModuleDef[],
    buildGenerateOptions: (modules: ModuleDef[]) => GenerateOptions,
    canGenerate: boolean,
  ): Promise<number> {
    if (!canGenerate) return 0;
    const result = await previewProtocols(
      parsedModules,
      config.frontendPath,
      config.backendPath,
      buildGenerateOptions(parsedModules),
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

  async function handleClearMessageIds(
    parsedModules: ModuleDef[],
    selectedModule: ModuleDef | undefined,
    onEditorUpdate: (xml: string) => void,
    canGenerate: boolean,
    buildGenerateOptions: (modules: ModuleDef[]) => GenerateOptions,
  ) {
    clearingMessageIds.value = true;
    try {
      const deletedCount = await deleteGeneratedProtocolFiles(parsedModules, buildGenerateOptions, canGenerate);
      resetLoadedMessageIds(parsedModules, selectedModule, onEditorUpdate);
      // 回写 XML 文件（将 id 清零持久化）
      const sep = config.xmlPath && !config.xmlPath.endsWith("/") ? "/" : "";
      for (const mod of parsedModules) {
        if (config.xmlPath) {
          await writeTextFile(`${config.xmlPath}${sep}${mod.fileName}`, mod.rawContent ?? moduleToXml(mod));
        }
      }
      clearConfirmText.value = "";
      message.success(`已删除 ${deletedCount} 个生成文件，已清空 XML 中的消息 ID`);
    } catch (e) {
      message.error("清空消息 ID 失败: " + errMsg(e));
    } finally {
      clearingMessageIds.value = false;
    }
  }

  return {
    clearingMessageIds,
    clearConfirmText,
    canClearMessageIds,
    autoAssignIds,
    resetLoadedMessageIds,
    handleClearMessageIds,
  };
}
