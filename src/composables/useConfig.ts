import { reactive, watch } from "vue";

export interface AppConfig {
  xmlPath: string;
  backendPath: string;
  frontendPath: string;
  author: string;
  javaBasePackage: string;
  handlerBasePackage: string;
  modulePackageMapCommon: string;
}

const STORAGE_KEY = "NovaMsg-config";

const defaults: AppConfig = {
  xmlPath: "",
  backendPath: "",
  frontendPath: "",
  author: "Sunshine",
  javaBasePackage: "com.rilon.gamebase",
  handlerBasePackage: "com.rilon.gamelogic",
  modulePackageMapCommon: "message",
};

function loadConfig(): AppConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...defaults, ...JSON.parse(stored) };
    }
  } catch {
    // localStorage 数据损坏时回退到默认值
  }
  return { ...defaults };
}

/**
 * 应用配置持久化组合式函数。
 * 配置自动保存到 localStorage，重启应用不丢失。
 */
export function useConfig() {
  const config = reactive<AppConfig>(loadConfig());

  watch(
    () => ({ ...config }),
    (val) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(val));
    },
    { deep: true },
  );

  return config;
}
