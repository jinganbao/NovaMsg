/**
 * 协议代码生成 - 纯数据转换（无 IO，便于测试）
 *
 * 负责：字段类型映射 -> 编解码方法体行生成 -> 渲染模型构建 -> 消息分组
 */
import type {
  ModuleDef,
  MessageDef,
  StructDef,
  RenderMessage,
  RenderModule,
  RenderStruct,
  MappedField,
  GenerateOptions,
  MessageType,
} from "./types";
import { mapFieldsWithStructs } from "./typeMapper";

// ============================================================
// 缩进常量
// ============================================================
/** C# 使用 tab 缩进 */
const T = "\t";
/** Java 使用 2/4/8 空格缩进 */
const S4 = "    ";
const S8 = "        ";

// ============================================================
// 编解码方法体行生成（预计算，含缩进）
// ============================================================

/** 生成 C# encode 行（方法体 3 tab，循环体 4 tab） */
function genCsEncodeLines(fields: MappedField[]): string[] {
  const lines: string[] = [];
  for (const f of fields) {
    if (f.isArray) {
      lines.push(`${T}${T}${T}writeShort(buf, (short)this.${f.csName}.Count);`);
      lines.push(`${T}${T}${T}for (int i = 0; i < this.${f.csName}.Count; i++) {`);
      if (f.element?.isStruct) {
        lines.push(`${T}${T}${T}${T}this.${f.csName}[i].encode(buf);`);
      } else {
        lines.push(`${T}${T}${T}${T}${f.csWrite}(buf, this.${f.csName}[i]);`);
      }
      lines.push(`${T}${T}${T}}`);
    } else if (f.isStruct) {
      lines.push(`${T}${T}${T}this.${f.csName}.encode(buf);`);
    } else {
      lines.push(`${T}${T}${T}${f.csWrite}(buf, this.${f.csName});`);
    }
  }
  return lines;
}

/** 生成 C# decode 行 */
function genCsDecodeLines(fields: MappedField[]): string[] {
  const lines: string[] = [];
  for (const f of fields) {
    if (f.isArray) {
      lines.push(`${T}${T}${T}int ${f.csName}_length =readShort(buf);`);
      lines.push(`${T}${T}${T}this.${f.csName}=new RepeatedField<${f.element!.csType}>();`);
      lines.push(`${T}${T}${T}for (int i = 0; i < ${f.csName}_length; i++) {`);
      if (f.element?.isStruct) {
        lines.push(`${T}${T}${T}${T}${f.element.csType} item = new ${f.element.csType}();`);
        lines.push(`${T}${T}${T}${T}item.decode(buf);`);
        lines.push(`${T}${T}${T}${T}this.${f.csName}.Add(item);`);
      } else {
        lines.push(`${T}${T}${T}${T}this.${f.csName}.Add(${f.csRead}(buf));`);
      }
      lines.push(`${T}${T}${T}}`);
    } else if (f.isStruct) {
      lines.push(`${T}${T}${T}this.${f.csName} = new ${f.csType}();`);
      lines.push(`${T}${T}${T}this.${f.csName}.decode(buf);`);
    } else {
      lines.push(`${T}${T}${T}this.${f.csName} = ${f.csRead}(buf);`);
    }
  }
  return lines;
}

/** 生成 Java write 行 */
function genJavaWriteLines(fields: MappedField[]): string[] {
  const lines: string[] = [];
  for (const f of fields) {
    if (f.isArray) {
      lines.push(`${S4}writeShort(buf, (short)this.${f.javaName}.size());`);
      lines.push(`${S4}for (int i = 0; i < this.${f.javaName}.size(); i++) {`);
      if (f.element?.isStruct) {
        lines.push(`${S8}writeBean(buf, this.${f.javaName}.get(i));`);
      } else {
        lines.push(`${S8}${f.javaWrite}(buf, this.${f.javaName}.get(i));`);
      }
      lines.push(`${S4}}`);
    } else if (f.isStruct) {
      lines.push(`${S4}writeBean(buf, this.${f.javaName});`);
    } else {
      lines.push(`${S4}${f.javaWrite}(buf, this.${f.javaName});`);
    }
  }
  return lines;
}

/** 生成 Java read 行 */
function genJavaReadLines(fields: MappedField[]): string[] {
  const lines: string[] = [];
  for (const f of fields) {
    if (f.isArray) {
      lines.push(`${S4}int ${f.javaName}_length = readShort(buf);`);
      lines.push(`${S4}this.${f.javaName} = new ArrayList<${f.element!.javaType}>();`);
      lines.push(`${S4}for (int i = 0; i < ${f.javaName}_length; i++) {`);
      if (f.element?.isStruct) {
        lines.push(`${S8}this.${f.javaName}.add(readBean(buf, ${f.element.javaType}.class));`);
      } else {
        lines.push(`${S8}this.${f.javaName}.add(${f.javaRead}(buf));`);
      }
      lines.push(`${S4}}`);
    } else if (f.isStruct) {
      lines.push(`${S4}this.${f.javaName} = readBean(buf, ${f.javaType}.class);`);
    } else {
      lines.push(`${S4}this.${f.javaName} = ${f.javaRead}(buf);`);
    }
  }
  return lines;
}

// ============================================================
// 配置解析
// ============================================================

/** 解析后的配置 */
export interface ResolvedOptions {
  modulePackageMap: Record<string, string>;
  javaBasePackage: string;
  handlerBasePackage: string;
  messageIdPackage: string;
  gameHandlerManagerPackage: string;
  author: string;
  versionStr: string;
  versionNum: number;
}

/** 默认配置 */
const DEFAULTS = {
  modulePackageMap: { common: "message" },
  javaBasePackage: "com.rilon.gamebase",
  handlerBasePackage: "com.rilon.gamelogic",
  messageIdPackage: "com.rilon.gamebase.message",
  gameHandlerManagerPackage: "com.rilon.gamelogic.message",
  author: "Sunshine",
};

/** 补全默认值 */
export function resolveOptions(options?: GenerateOptions): ResolvedOptions {
  return {
    modulePackageMap: { ...DEFAULTS.modulePackageMap, ...(options?.modulePackageMap ?? {}) },
    javaBasePackage: options?.javaBasePackage ?? DEFAULTS.javaBasePackage,
    handlerBasePackage: options?.handlerBasePackage ?? DEFAULTS.handlerBasePackage,
    messageIdPackage: options?.messageIdPackage ?? DEFAULTS.messageIdPackage,
    gameHandlerManagerPackage: options?.gameHandlerManagerPackage ?? DEFAULTS.gameHandlerManagerPackage,
    author: options?.author ?? DEFAULTS.author,
    versionStr: options?.versionStr ?? formatVersionStr(new Date()),
    versionNum: options?.versionNum ?? Math.floor(Date.now() / 1000),
  };
}

/** 格式化版本时间字符串 YYYY-MM-DD HH:mm:ss */
export function formatVersionStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 模块名 -> 包名段（应用映射） */
function moduleToPackageSeg(moduleName: string, map: Record<string, string>): string {
  return map[moduleName] ?? moduleName;
}

function fieldStructTypes(fields: MappedField[]): string[] {
  const names = new Set<string>();
  for (const field of fields) {
    if (field.element?.isStruct) names.add(field.element.javaType);
    else if (field.isStruct) names.add(field.javaType);
  }
  return [...names];
}

// ============================================================
// 渲染模型构建
// ============================================================

/** 确保消息名带有类型前缀（C2S_ / S2C_ / S2P_ / P2S_） */
function ensurePrefix(name: string, type: string): string {
  const prefix = type + "_";
  if (name.startsWith(prefix)) return name;
  return prefix + name;
}

/** 构建单个渲染消息 */
export function buildRenderMessage(
  msg: MessageDef,
  module: ModuleDef,
  opts: ResolvedOptions,
  structTypes: Set<string>,
): RenderMessage {
  const pkgSeg = moduleToPackageSeg(module.moduleName, opts.modulePackageMap);
  const fields = mapFieldsWithStructs(msg.fields, structTypes);
  const fullName = ensurePrefix(msg.name, msg.type);
  const beanPackage = `${opts.javaBasePackage}.${pkgSeg}.bean`;
  return {
    id: msg.id,
    name: fullName,
    type: msg.type,
    desc: msg.desc,
    fileName: module.fileName,
    moduleName: module.moduleName,
    javaClassName: `${fullName}Message`,
    javaPackage: `${opts.javaBasePackage}.${pkgSeg}.messages`,
    handlerPackage: `${opts.handlerBasePackage}.${pkgSeg}.handler`,
    handlerClassName: `${fullName}Handler`,
    structImports: fieldStructTypes(fields).map((name) => `${beanPackage}.${name}`),
    fields,
    csEncodeLines: genCsEncodeLines(fields),
    csDecodeLines: genCsDecodeLines(fields),
    javaWriteLines: genJavaWriteLines(fields),
    javaReadLines: genJavaReadLines(fields),
  };
}

/** 构建单个渲染对象结构 */
export function buildRenderStruct(
  struct: StructDef,
  module: ModuleDef,
  opts: ResolvedOptions,
  structTypes: Set<string>,
): RenderStruct {
  const pkgSeg = moduleToPackageSeg(module.moduleName, opts.modulePackageMap);
  const fields = mapFieldsWithStructs(struct.fields, structTypes);
  return {
    name: struct.name,
    desc: struct.desc,
    fileName: module.fileName,
    moduleName: module.moduleName,
    javaClassName: struct.name,
    javaPackage: `${opts.javaBasePackage}.${pkgSeg}.bean`,
    fields,
    csEncodeLines: genCsEncodeLines(fields),
    csDecodeLines: genCsDecodeLines(fields),
    javaWriteLines: genJavaWriteLines(fields),
    javaReadLines: genJavaReadLines(fields),
  };
}

/** 构建所有渲染模块 */
export function buildRenderModules(
  modules: ModuleDef[],
  opts: ResolvedOptions,
): RenderModule[] {
  const structTypes = new Set(modules.flatMap((m) => (m.structs ?? []).map((struct) => struct.name)));
  return modules.map((m) => ({
    fileName: m.fileName,
    moduleName: m.moduleName,
    desc: m.desc,
    structs: (m.structs ?? []).map((struct) => buildRenderStruct(struct, m, opts, structTypes)),
    messages: m.messages.map((msg) => buildRenderMessage(msg, m, opts, structTypes)),
  }));
}

// ============================================================
// 消息分组（纯函数）
// ============================================================

/** 客户端接收方向（MessagePool 的 s2c 段） */
export function isClientReceive(t: MessageType): boolean {
  return t === "S2C" || t === "S2P";
}

/** 客户端发送方向（MessagePool 的 c2s 段） */
export function isClientSend(t: MessageType): boolean {
  return t === "C2S" || t === "P2S";
}

/** 需要服务端 Handler 的方向（GameHandlerManager 注册） */
export function isServerHandle(t: MessageType): boolean {
  return t === "C2S" || t === "P2S";
}
