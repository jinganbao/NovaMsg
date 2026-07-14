import { reactive, watch } from "vue";
import { applyManagedMessagePaths } from "@/utils/managedPaths";

export interface AppConfig {
  xmlPath: string;
  svnPath: string;
  backendPath: string;
  frontendPath: string;
  author: string;
  javaBasePackage: string;
  handlerBasePackage: string;
  modulePackageMapCommon: string;
  themeAccent: string;
  themeMode: "dark" | "light";
  autoCheckUpdate: boolean;
}

const STORAGE_KEY = "NovaMsg-config";

const defaults: AppConfig = {
  xmlPath: "",
  svnPath: "",
  backendPath: "",
  frontendPath: "",
  author: "Sunshine",
  javaBasePackage: "com.rilon.gamebase",
  handlerBasePackage: "com.rilon.gamelogic",
  modulePackageMapCommon: "message",
  themeAccent: "#3DD6C6",
  themeMode: "dark",
  autoCheckUpdate: true,
};

function loadConfig(): AppConfig {
  let loaded: AppConfig;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      loaded = { ...defaults, ...JSON.parse(stored) };
      if (!loaded.svnPath && loaded.xmlPath.replace(/\\/g, "/").endsWith("/xml")) {
        loaded.svnPath = loaded.xmlPath.replace(/\\/g, "/").replace(/\/xml\/?$/, "");
      }
      applyManagedMessagePaths(loaded);
      return loaded;
    }
  } catch {
    // localStorage 数据损坏时回退到默认值
  }
  loaded = { ...defaults };
  applyManagedMessagePaths(loaded);
  return loaded;
}

const config = reactive<AppConfig>(loadConfig());

watch(
  () => ({ ...config }),
  (val) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(val));
  },
  { deep: true },
);

/**
 * 应用配置持久化组合式函数。
 * 配置自动保存到 localStorage，重启应用不丢失。
 */
export function useConfig() {
  return config;
}
