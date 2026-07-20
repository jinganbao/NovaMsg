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
import type { ModuleDef, GenerateOptions, GenerateResult, RenderMessage, RenderStruct } from "./types";
import { templates } from "./templates";
import { formatGeneratedCSharp, formatGeneratedJava } from "./codeFormatter";
import {
  resolveOptions,
  buildRenderModules,
  isClientReceive,
  isClientSend,
  isServerHandle,
} from "./renderModel";
import { joinPath, packageToPath, writeGeneratedFiles } from "./fsWrapper";
import type { GeneratedFileToWrite } from "./fsWrapper";

function assertUniqueOutputPath(
  seen: Map<string, string>,
  path: string,
  owner: string,
) {
  const previous = seen.get(path);
  if (!previous) {
    seen.set(path, owner);
    return;
  }
  throw new Error(`生成路径冲突：${path} 同时来自 ${previous} 和 ${owner}，请调整 XML 中的模块名/对象名/消息名`);
}

function assertUniqueGeneratedPaths(
  allMessages: RenderMessage[],
  allStructs: RenderStruct[],
  csharpPath: string,
  javaPath: string,
  opts: ReturnType<typeof resolveOptions>,
) {
  const seen = new Map<string, string>();
  assertUniqueOutputPath(seen, joinPath(csharpPath, "MessageBeans.cs"), "C# MessageBeans");
  assertUniqueOutputPath(seen, joinPath(csharpPath, "MessagePool.cs"), "C# MessagePool");

  for (const struct of allStructs) {
    const dir = joinPath(javaPath, packageToPath(struct.javaPackage));
    assertUniqueOutputPath(seen, joinPath(dir, `${struct.javaClassName}.java`), `对象 ${struct.fileName}/${struct.name}`);
  }

  for (const msg of allMessages) {
    const dir = joinPath(javaPath, packageToPath(msg.javaPackage));
    assertUniqueOutputPath(seen, joinPath(dir, `${msg.javaClassName}.java`), `消息 ${msg.fileName}/${msg.name}`);
  }

  const messageIdDir = joinPath(javaPath, packageToPath(opts.messageIdPackage));
  assertUniqueOutputPath(seen, joinPath(messageIdDir, "MessageId.java"), "Java MessageId");

  const gameHandlerManagerDir = joinPath(javaPath, packageToPath(opts.gameHandlerManagerPackage));
  assertUniqueOutputPath(seen, joinPath(gameHandlerManagerDir, "GameHandlerManager.java"), "Java GameHandlerManager");

  for (const msg of allMessages.filter((m) => m.type === "C2S")) {
    const dir = joinPath(javaPath, packageToPath(msg.handlerPackage));
    assertUniqueOutputPath(seen, joinPath(dir, `${msg.handlerClassName}.java`), `Handler ${msg.fileName}/${msg.name}`);
  }
}

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
  const allStructs: RenderStruct[] = renderModules.flatMap((m) => m.structs);
  assertUniqueGeneratedPaths(allMessages, allStructs, csharpPath, javaPath, opts);

  const filesToWrite: GeneratedFileToWrite[] = [];

  // ---------- 1. C# MessageBeans.cs ----------
  const messageBeansContent = formatGeneratedCSharp(templates.messageBeansCs({
    structs: allStructs,
    messages: allMessages,
  }));
  const messageBeansPath = joinPath(csharpPath, "MessageBeans.cs");
  filesToWrite.push({ path: messageBeansPath, contents: messageBeansContent });

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
  filesToWrite.push({ path: messagePoolPath, contents: messagePoolContent });

  // ---------- 3. Java 对象类（每 Struct 一个文件，按模块分包） ----------
  for (const struct of allStructs) {
    const content = formatGeneratedJava(templates.javaStruct({ ...struct, author: opts.author }));
    const dir = joinPath(javaPath, packageToPath(struct.javaPackage));
    const filePath = joinPath(dir, `${struct.javaClassName}.java`);
    filesToWrite.push({ path: filePath, contents: content });
  }

  // ---------- 4. Java 实体类（每消息一个文件，按模块分包） ----------
  for (const msg of allMessages) {
    const content = formatGeneratedJava(templates.javaMessage({ ...msg, author: opts.author }));
    const dir = joinPath(javaPath, packageToPath(msg.javaPackage));
    const filePath = joinPath(dir, `${msg.javaClassName}.java`);
    filesToWrite.push({ path: filePath, contents: content });
  }

  // ---------- 5. Java MessageId.java ----------
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
  filesToWrite.push({ path: messageIdPath, contents: messageIdContent });

  // ---------- 6. Java GameHandlerManager.java（仅 C2S/P2S 注册） ----------
  const handlerRegMsgs = allMessages.filter((m) => isServerHandle(m.type));
  const gameHandlerManagerContent = formatGeneratedJava(templates.gameHandlerManagerJava({
    gameHandlerManagerPackage: opts.gameHandlerManagerPackage,
    author: opts.author,
    c2sMessages: handlerRegMsgs,
  }));
  const gameHandlerManagerDir = joinPath(javaPath, packageToPath(opts.gameHandlerManagerPackage));
  const gameHandlerManagerPath = joinPath(gameHandlerManagerDir, "GameHandlerManager.java");
  filesToWrite.push({ path: gameHandlerManagerPath, contents: gameHandlerManagerContent });

  // ---------- 7. Java XXXHandler.java（仅 C2S，已存在则跳过） ----------
  for (const msg of allMessages.filter((m) => m.type === "C2S")) {
    const dir = joinPath(javaPath, packageToPath(msg.handlerPackage));
    const filePath = joinPath(dir, `${msg.handlerClassName}.java`);
    const content = formatGeneratedJava(templates.javaHandler({ ...msg, author: opts.author }));
    filesToWrite.push({ path: filePath, contents: content, skipIfExists: true });
  }

  return await writeGeneratedFiles(filesToWrite);
}

/** 预览结果 */
export interface PreviewFile {
  path: string;
  content: string;
}

export interface PreviewResult {
  /** 将要生成的文件（含内容） */
  files: PreviewFile[];
  /** 真实生成会跳过的 Handler 文件路径。预览为了便于检查模板内容，当前不跳过。 */
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
  const allStructs: RenderStruct[] = renderModules.flatMap((m) => m.structs);
  assertUniqueGeneratedPaths(allMessages, allStructs, csharpPath, javaPath, opts);

  const files: PreviewFile[] = [];
  const skippedHandlerFiles: string[] = [];

  // 1. C# MessageBeans.cs
  files.push({
    path: joinPath(csharpPath, "MessageBeans.cs"),
    content: formatGeneratedCSharp(templates.messageBeansCs({
      structs: allStructs,
      messages: allMessages,
    })),
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

  // 3. Java 对象类
  for (const struct of allStructs) {
    const dir = joinPath(javaPath, packageToPath(struct.javaPackage));
    files.push({
      path: joinPath(dir, `${struct.javaClassName}.java`),
      content: formatGeneratedJava(templates.javaStruct({ ...struct, author: opts.author })),
    });
  }

  // 4. Java 实体类
  for (const msg of allMessages) {
    const dir = joinPath(javaPath, packageToPath(msg.javaPackage));
    files.push({
      path: joinPath(dir, `${msg.javaClassName}.java`),
      content: formatGeneratedJava(templates.javaMessage({ ...msg, author: opts.author })),
    });
  }

  // 5. Java MessageId.java
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

  // 6. Java GameHandlerManager.java
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

  // 7. Java XXXHandler.java（仅 C2S，预览时始终展示模板内容；真实生成时才跳过已有 Handler）
  for (const msg of allMessages.filter((m) => m.type === "C2S")) {
    const dir = joinPath(javaPath, packageToPath(msg.handlerPackage));
    const filePath = joinPath(dir, `${msg.handlerClassName}.java`);
    files.push({
      path: filePath,
      content: formatGeneratedJava(templates.javaHandler({ ...msg, author: opts.author })),
    });
  }

  return { files, skippedHandlerFiles };
}
