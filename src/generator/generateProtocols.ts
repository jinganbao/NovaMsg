/**
 * 协议代码生成 - 主流程
 *
 * 入口：generateProtocols(modules, csharpPath, javaPath, options?)
 *
 * 产物：
 *   C#  - MessageBeans.cs（汇总）、MessagePool.cs（汇总）
 *   Java - 每消息一个 XXXMessage.java、MessageId.java（汇总）、
 *          GameHandlerManager.java（汇总，仅 C2S/P2S 注册）、
 *          XXXHandler.java（仅 C2S，已存在则跳过）
 */
import type { ModuleDef, GenerateOptions, GenerateResult, RenderMessage } from "./types";
import { templates } from "./templates";
import { formatGeneratedCSharp, formatGeneratedJava } from "./codeFormatter";
import {
  resolveOptions,
  buildRenderModules,
  isClientReceive,
  isClientSend,
  isServerHandle,
} from "./renderModel";
import { writeFile, fileExists, ensureDir, joinPath, packageToPath } from "./fsWrapper";

/**
 * 生成协议代码
 * @param modules  解析自 XML 的模块数据
 * @param csharpPath C# 输出目录（绝对路径）
 * @param javaPath   Java 输出目录（绝对路径）
 * @param options    可选配置
 */
export async function generateProtocols(
  modules: ModuleDef[],
  csharpPath: string,
  javaPath: string,
  options?: GenerateOptions,
): Promise<GenerateResult> {
  const opts = resolveOptions(options);
  const renderModules = buildRenderModules(modules, opts);

  // 所有渲染消息（展平，保留输入顺序）
  const allMessages: RenderMessage[] = renderModules.flatMap((m) => m.messages);

  const writtenFiles: string[] = [];
  const skippedFiles: string[] = [];

  // ---------- 1. C# MessageBeans.cs ----------
  const messageBeansContent = formatGeneratedCSharp(templates.messageBeansCs({ messages: allMessages }));
  const messageBeansPath = joinPath(csharpPath, "MessageBeans.cs");
  await ensureDir(csharpPath);
  await writeFile(messageBeansPath, messageBeansContent);
  writtenFiles.push(messageBeansPath);

  // ---------- 2. C# MessagePool.cs ----------
  const s2cPool = allMessages.filter((m) => isClientReceive(m.type));
  const c2sPool = allMessages.filter((m) => isClientSend(m.type));
  const messagePoolContent = formatGeneratedCSharp(templates.messagePoolCs({
    author: opts.author,
    versionStr: opts.versionStr,
    versionNum: opts.versionNum,
    s2cMessages: s2cPool,
    c2sMessages: c2sPool,
  }));
  const messagePoolPath = joinPath(csharpPath, "MessagePool.cs");
  await writeFile(messagePoolPath, messagePoolContent);
  writtenFiles.push(messagePoolPath);

  // ---------- 3. Java 实体类（每消息一个文件，按模块分包） ----------
  for (const msg of allMessages) {
    const content = formatGeneratedJava(templates.javaMessage({ ...msg, author: opts.author }));
    const dir = joinPath(javaPath, packageToPath(msg.javaPackage));
    const filePath = joinPath(dir, `${msg.javaClassName}.java`);
    await ensureDir(dir);
    await writeFile(filePath, content);
    writtenFiles.push(filePath);
  }

  // ---------- 4. Java MessageId.java ----------
  const s2pIdMsgs = allMessages.filter((m) => m.type === "S2P");
  const p2sIdMsgs = allMessages.filter((m) => m.type === "P2S");
  const s2cIdMsgs = allMessages.filter((m) => m.type === "S2C");
  const c2sIdMsgs = allMessages.filter((m) => m.type === "C2S");
  const messageIdContent = formatGeneratedJava(templates.messageIdJava({
    messageIdPackage: opts.messageIdPackage,
    author: opts.author,
    versionStr: opts.versionStr,
    versionNum: opts.versionNum,
    s2pMessages: s2pIdMsgs,
    p2sMessages: p2sIdMsgs,
    s2cMessages: s2cIdMsgs,
    c2sMessages: c2sIdMsgs,
  }));
  const messageIdDir = joinPath(javaPath, packageToPath(opts.messageIdPackage));
  const messageIdPath = joinPath(messageIdDir, "MessageId.java");
  await ensureDir(messageIdDir);
  await writeFile(messageIdPath, messageIdContent);
  writtenFiles.push(messageIdPath);

  // ---------- 5. Java GameHandlerManager.java（仅 C2S/P2S 注册） ----------
  const handlerRegMsgs = allMessages.filter((m) => isServerHandle(m.type));
  const gameHandlerManagerContent = formatGeneratedJava(templates.gameHandlerManagerJava({
    gameHandlerManagerPackage: opts.gameHandlerManagerPackage,
    author: opts.author,
    c2sMessages: handlerRegMsgs,
  }));
  const gameHandlerManagerDir = joinPath(javaPath, packageToPath(opts.gameHandlerManagerPackage));
  const gameHandlerManagerPath = joinPath(gameHandlerManagerDir, "GameHandlerManager.java");
  await ensureDir(gameHandlerManagerDir);
  await writeFile(gameHandlerManagerPath, gameHandlerManagerContent);
  writtenFiles.push(gameHandlerManagerPath);

  // ---------- 6. Java XXXHandler.java（仅 C2S，已存在则跳过） ----------
  for (const msg of allMessages.filter((m) => m.type === "C2S")) {
    const dir = joinPath(javaPath, packageToPath(msg.handlerPackage));
    const filePath = joinPath(dir, `${msg.handlerClassName}.java`);
    await ensureDir(dir);
    // 【关键】已存在则跳过，避免覆盖后端业务逻辑
    if (await fileExists(filePath)) {
      skippedFiles.push(filePath);
      continue;
    }
    const content = formatGeneratedJava(templates.javaHandler({ ...msg, author: opts.author }));
    await writeFile(filePath, content);
    writtenFiles.push(filePath);
  }

  return { writtenFiles, skippedFiles };
}

/** 预览结果 */
export interface PreviewFile {
  path: string;
  content: string;
}

export interface PreviewResult {
  /** 将要生成的文件（含内容） */
  files: PreviewFile[];
  /** 将跳过的 Handler 文件路径 */
  skippedHandlerFiles: string[];
}

/**
 * 预览协议代码生成（仅渲染，不写入磁盘）
 * 与 generateProtocols 逻辑一致，但所有内容返回在内存中。
 */
export async function previewProtocols(
  modules: ModuleDef[],
  csharpPath: string,
  javaPath: string,
  options?: GenerateOptions,
): Promise<PreviewResult> {
  const opts = resolveOptions(options);
  const renderModules = buildRenderModules(modules, opts);
  const allMessages: RenderMessage[] = renderModules.flatMap((m) => m.messages);

  const files: PreviewFile[] = [];
  const skippedHandlerFiles: string[] = [];

  // 1. C# MessageBeans.cs
  files.push({
    path: joinPath(csharpPath, "MessageBeans.cs"),
    content: formatGeneratedCSharp(templates.messageBeansCs({ messages: allMessages })),
  });

  // 2. C# MessagePool.cs
  const s2cPool = allMessages.filter((m) => isClientReceive(m.type));
  const c2sPool = allMessages.filter((m) => isClientSend(m.type));
  files.push({
    path: joinPath(csharpPath, "MessagePool.cs"),
    content: formatGeneratedCSharp(templates.messagePoolCs({
      author: opts.author,
      versionStr: opts.versionStr,
      versionNum: opts.versionNum,
      s2cMessages: s2cPool,
      c2sMessages: c2sPool,
    })),
  });

  // 3. Java 实体类
  for (const msg of allMessages) {
    const dir = joinPath(javaPath, packageToPath(msg.javaPackage));
    files.push({
      path: joinPath(dir, `${msg.javaClassName}.java`),
      content: formatGeneratedJava(templates.javaMessage({ ...msg, author: opts.author })),
    });
  }

  // 4. Java MessageId.java
  const s2pIdMsgs = allMessages.filter((m) => m.type === "S2P");
  const p2sIdMsgs = allMessages.filter((m) => m.type === "P2S");
  const s2cIdMsgs = allMessages.filter((m) => m.type === "S2C");
  const c2sIdMsgs = allMessages.filter((m) => m.type === "C2S");
  const messageIdDir = joinPath(javaPath, packageToPath(opts.messageIdPackage));
  files.push({
    path: joinPath(messageIdDir, "MessageId.java"),
    content: formatGeneratedJava(templates.messageIdJava({
      messageIdPackage: opts.messageIdPackage,
      author: opts.author,
      versionStr: opts.versionStr,
      versionNum: opts.versionNum,
      s2pMessages: s2pIdMsgs,
      p2sMessages: p2sIdMsgs,
      s2cMessages: s2cIdMsgs,
      c2sMessages: c2sIdMsgs,
    })),
  });

  // 5. Java GameHandlerManager.java
  const handlerRegMsgs = allMessages.filter((m) => isServerHandle(m.type));
  const gameHandlerManagerDir = joinPath(javaPath, packageToPath(opts.gameHandlerManagerPackage));
  files.push({
    path: joinPath(gameHandlerManagerDir, "GameHandlerManager.java"),
    content: formatGeneratedJava(templates.gameHandlerManagerJava({
      gameHandlerManagerPackage: opts.gameHandlerManagerPackage,
      author: opts.author,
      c2sMessages: handlerRegMsgs,
    })),
  });

  // 6. Java XXXHandler.java（仅 C2S，标记已存在则跳过）
  for (const msg of allMessages.filter((m) => m.type === "C2S")) {
    const dir = joinPath(javaPath, packageToPath(msg.handlerPackage));
    const filePath = joinPath(dir, `${msg.handlerClassName}.java`);
    if (await fileExists(filePath)) {
      skippedHandlerFiles.push(filePath);
      continue;
    }
    files.push({
      path: filePath,
      content: formatGeneratedJava(templates.javaHandler({ ...msg, author: opts.author })),
    });
  }

  return { files, skippedHandlerFiles };
}
