<script setup lang="ts">
import { computed } from "vue";
import { NConfigProvider, NMessageProvider, darkTheme } from "naive-ui";
import AppContent from "./AppContent.vue";
import { useConfig } from "./composables/useConfig";

const config = useConfig();

const naiveTheme = computed(() => config.themeMode === "dark" ? darkTheme : null);

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

const themeOverrides = computed(() => {
  const accent = config.themeAccent || "#3DD6C6";
  const dark = config.themeMode === "dark";
  return {
    common: {
      primaryColor: accent,
      primaryColorHover: mix(accent, "#FFFFFF", 0.18),
      primaryColorPressed: mix(accent, "#000000", 0.18),
      primaryColorSuppl: accent,
      borderRadius: "6px",
      borderColor: dark ? "#2B323C" : "#D8E0EA",
      bodyColor: dark ? "#111418" : "#F7F9FC",
      cardColor: dark ? "#1B2027" : "#FFFFFF",
      modalColor: dark ? "#1B2027" : "#FFFFFF",
      inputColor: dark ? "#2A3038" : "#F1F5F9",
      textColorBase: dark ? "#E7ECF3" : "#17202A",
      textColor1: dark ? "#E7ECF3" : "#17202A",
      textColor2: dark ? "#9AA5B5" : "#5D6978",
      textColor3: dark ? "#6F7A89" : "#7B8797",
    },
  };
});
</script>

<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <n-message-provider>
      <AppContent />
    </n-message-provider>
  </n-config-provider>
</template>
