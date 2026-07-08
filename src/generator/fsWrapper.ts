/**
 * 协议代码生成 - Tauri v2 文件系统包装
 *
 * 基于 @tauri-apps/plugin-fs，提供文件读写、目录创建、文件存在检测。
 */
import { writeTextFile, readTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";

/** 写入文本文件 */
export async function writeFile(path: string, contents: string): Promise<void> {
  await writeTextFile(path, contents);
}

/** 读取文本文件 */
export async function readFile(path: string): Promise<string> {
  return await readTextFile(path);
}

/** 判断文件是否存在 */
export async function fileExists(path: string): Promise<boolean> {
  return await exists(path);
}

/**
 * 递归创建目录（若已存在则跳过）
 */
export async function ensureDir(dirPath: string): Promise<void> {
  if (!dirPath) return;
  if (await exists(dirPath)) return;
  try {
    await mkdir(dirPath, { recursive: true });
  } catch {
    // 并发创建时可能已存在，忽略
  }
}

/**
 * 路径拼接（统一使用 /，合并多余的斜杠）
 */
export function joinPath(...parts: string[]): string {
  return parts
    .map((p) => p.replace(/\\/g, "/"))
    .join("/")
    .replace(/\/+/g, "/");
}

/**
 * Java 包名转文件夹路径
 * 如 "com.rilon.gamebase.login" -> "com/rilon/gamebase/login"
 */
export function packageToPath(pkg: string): string {
  return pkg.replace(/\./g, "/");
}
