/**
 * 协议代码生成 - Tauri v2 文件系统包装
 *
 * 基于 @tauri-apps/plugin-fs，提供文件读写、目录创建、文件存在检测。
 */
import { writeTextFile, readTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

export interface GeneratedFileToWrite {
  path: string;
  contents: string;
  skipIfExists?: boolean;
}

export interface WriteGeneratedFilesResult {
  writtenFiles: string[];
  skippedFiles: string[];
}

/** 写入文本文件 */
export async function writeFile(path: string, contents: string): Promise<void> {
  await writeTextFile(path, contents);
  if (!(await exists(path))) {
    throw new Error(`文件写入后不存在：${path}`);
  }
  const written = await readTextFile(path);
  if (written !== contents) {
    throw new Error(`文件写入校验失败：${path}`);
  }
}

/** 通过 Rust 后端批量写入生成文件，确保真实落盘并读回校验 */
export async function writeGeneratedFiles(files: GeneratedFileToWrite[]): Promise<WriteGeneratedFilesResult> {
  const result = await invoke<{ written_files: string[]; skipped_files: string[] }>("write_generated_files", {
    files: files.map((file) => ({
      path: file.path,
      contents: file.contents,
      skip_if_exists: file.skipIfExists ?? false,
    })),
  });
  return {
    writtenFiles: result.written_files,
    skippedFiles: result.skipped_files,
  };
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
