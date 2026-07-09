/**
 * 主题逻辑
 */
import { computed, watch } from "vue";
import type { useConfig } from "./useConfig";

type Config = ReturnType<typeof useConfig>;

export const themePresets = [
  { name: "NovaMsg", color: "#3DD6C6" },
  { name: "NovaDB", color: "#5BA8FF" },
  { name: "NovaFlow", color: "#A3E635" },
  { name: "NovaOps", color: "#F59E0B" },
  { name: "NovaAI", color: "#8BDAFF" },
];

export const themeModeOptions = [
  { label: "暗色", value: "dark" },
  { label: "亮色", value: "light" },
];

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

export function useTheme(config: Config) {
  function setThemeMode(mode: string) {
    if (mode === "dark" || mode === "light") {
      config.themeMode = mode;
    }
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

  watch(themeVars, (vars) => {
    for (const [key, value] of Object.entries(vars)) {
      document.documentElement.style.setProperty(key, value);
    }
  }, { immediate: true });

  return {
    themePresets,
    themeModeOptions,
    themeVars,
    setThemeMode,
  };
}
