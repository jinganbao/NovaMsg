import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

// Tauri 期望一个固定端口，且在构建时通过环境变量区分 dev/build
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [vue()],

  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },

  // Vite 开发服务器配置
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 忽略 Rust 代码变化
      ignored: ["**/src-tauri/**"],
    },
  },

  // 生产构建产物目录
  build: {
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
  },
}));
