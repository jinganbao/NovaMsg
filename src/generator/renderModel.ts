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
/** Java 使用 4/8/12 空格缩进 */
const S4 = "    ";
const S8 = "        ";
const S12 = "            ";

// ============================================================
// 编解码方法体行生成（预计算，含缩进）
// ============================================================

/** 生成 C# encode 行（tagged=true: 只写出已 set 字段并附 tag；tagged=false: 顺序写出所有字段） */
function genCsEncodeLines(fields: MappedField[], tagged: boolean): string[] {
  const lines: string[] = [];
  if (tagged) {
    lines.push(`${T}${T}${T}int __fieldCount = 0;`);
    for (const f of fields) {
      lines.push(`${T}${T}${T}if (this.__setFields.Contains("${f.csName}")) {`);
      lines.push(`${T}${T}${T}${T}__fieldCount++;`);
      lines.push(`${T}${T}${T}}`);
    }
    lines.push(`${T}${T}${T}writeShort(buf, (short)__fieldCount);`);
    let tag = 0;
    for (const f of fields) {
      lines.push(`${T}${T}${T}if (this.__setFields.Contains("${f.csName}")) {`);
      lines.push(`${T}${T}${T}${T}writeShort(buf, (short)${tag});`);
      lines.push(`${T}${T}${T}${T}System.IO.MemoryStream __fieldStream = new System.IO.MemoryStream();`);
      lines.push(`${T}${T}${T}${T}ByteBuffer __fieldBuf = new ByteBuffer(__fieldStream);`);
      pushCsFieldWrite(lines, f, `${T}${T}${T}${T}`, "__fieldBuf");
      lines.push(`${T}${T}${T}${T}byte[] __fieldBytes = __fieldStream.ToArray();`);
      lines.push(`${T}${T}${T}${T}writeInt(buf, __fieldBytes.Length);`);
      lines.push(`${T}${T}${T}${T}buf.stream.Write(__fieldBytes, 0, __fieldBytes.Length);`);
      lines.push(`${T}${T}${T}}`);
      tag++;
    }
  } else {
    for (const f of fields) {
      pushCsFieldWrite(lines, f, `${T}${T}${T}`);
    }
  }
  return lines;
}

/** 按字段类型追加 C# write 行 */
function pushCsFieldWrite(lines: string[], f: MappedField, indent: string, bufVar = "buf"): void {
  if (f.isArray) {
    lines.push(`${indent}int ${f.csName}_count = this.${f.csName} == null ? 0 : this.${f.csName}.Count;`);
    lines.push(`${indent}writeShort(${bufVar}, (short)${f.csName}_count);`);
    lines.push(`${indent}for (int i = 0; i < ${f.csName}_count; i++) {`);
    const inner = indent + T;
    if (f.element?.isStruct) {
      lines.push(`${inner}this.${f.csName}[i].encode(${bufVar});`);
    } else {
      lines.push(`${inner}${f.csWrite}(${bufVar}, this.${f.csName}[i]);`);
    }
    lines.push(`${indent}}`);
  } else if (f.isStruct) {
    lines.push(`${indent}this.${f.csName}.encode(${bufVar});`);
  } else {
    lines.push(`${indent}${f.csWrite}(${bufVar}, this.${f.csName});`);
  }
}

/** 生成 C# decode 行（tagged=true: 按 tag 读取对象字段；tagged=false: 顺序读出所有字段） */
function genCsDecodeLines(fields: MappedField[], tagged: boolean): string[] {
  const lines: string[] = [];
  if (tagged) {
    lines.push(`${T}${T}${T}this.__setFields.Clear();`);
    lines.push(`${T}${T}${T}int __fieldCount = readShort(buf);`);
    lines.push(`${T}${T}${T}for (int __i = 0; __i < __fieldCount; __i++) {`);
    lines.push(`${T}${T}${T}${T}int __tag = readShort(buf);`);
    lines.push(`${T}${T}${T}${T}int __length = readInt(buf);`);
    lines.push(`${T}${T}${T}${T}ByteBuffer __fieldBuf = new ByteBuffer(buf.bytes);`);
    lines.push(`${T}${T}${T}${T}__fieldBuf.pos = buf.pos;`);
    lines.push(`${T}${T}${T}${T}buf.pos += __length;`);
    lines.push(`${T}${T}${T}${T}switch (__tag) {`);
    let tag = 0;
    for (const f of fields) {
      lines.push(`${T}${T}${T}${T}case ${tag}:`);
      pushCsFieldRead(lines, f, `${T}${T}${T}${T}${T}`, "__fieldBuf", `this._${f.csName}`);
      lines.push(`${T}${T}${T}${T}${T}this.__setFields.Add("${f.csName}");`);
      lines.push(`${T}${T}${T}${T}${T}break;`);
      tag++;
    }
    lines.push(`${T}${T}${T}${T}default:`);
    lines.push(`${T}${T}${T}${T}${T}break;`);
    lines.push(`${T}${T}${T}${T}}`);
    lines.push(`${T}${T}${T}}`);
  } else {
    for (const f of fields) {
      pushCsFieldRead(lines, f, `${T}${T}${T}`);
    }
  }
  return lines;
}

/** 按字段类型追加 C# read 行 */
function pushCsFieldRead(lines: string[], f: MappedField, indent: string, bufVar = "buf", target = `this.${f.csName}`): void {
  if (f.isArray) {
    lines.push(`${indent}int ${f.csName}_length =readShort(${bufVar});`);
    lines.push(`${indent}${target}=new RepeatedField<${f.element!.csType}>();`);
    lines.push(`${indent}for (int i = 0; i < ${f.csName}_length; i++) {`);
    const inner = indent + T;
    if (f.element?.isStruct) {
      lines.push(`${inner}${f.element.csType} item = new ${f.element.csType}();`);
      lines.push(`${inner}item.decode(${bufVar});`);
      lines.push(`${inner}${target}.Add(item);`);
    } else {
      lines.push(`${inner}${target}.Add(${f.csRead}(${bufVar}));`);
    }
    lines.push(`${indent}}`);
  } else if (f.isStruct) {
    lines.push(`${indent}${target} = new ${f.csType}();`);
    lines.push(`${indent}${target}.decode(${bufVar});`);
  } else {
    lines.push(`${indent}${target} = ${f.csRead}(${bufVar});`);
  }
}

/** 生成 Java write 行（tagged=true: 只写出已 set 字段并附 tag；tagged=false: 顺序写出所有字段） */
function genJavaWriteLines(fields: MappedField[], tagged: boolean): string[] {
  const lines: string[] = [];
  if (tagged) {
    lines.push(`${S4}int __fieldCount = 0;`);
    for (const f of fields) {
      lines.push(`${S4}if (this.__setFields.contains("${f.javaName}")) {`);
      lines.push(`${S8}__fieldCount++;`);
      lines.push(`${S4}}`);
    }
    lines.push(`${S4}writeShort(buf, __fieldCount);`);
    let tag = 0;
    for (const f of fields) {
      lines.push(`${S4}if (this.__setFields.contains("${f.javaName}")) {`);
      lines.push(`${S8}writeShort(buf, ${tag});`);
      lines.push(`${S8}ByteBuf __fieldBuf = Unpooled.buffer();`);
      lines.push(`${S8}try {`);
      pushFieldWrite(lines, f, S12, "__fieldBuf");
      lines.push(`${S12}writeInt(buf, __fieldBuf.readableBytes());`);
      lines.push(`${S12}buf.writeBytes(__fieldBuf);`);
      lines.push(`${S8}} finally {`);
      lines.push(`${S12}__fieldBuf.release();`);
      lines.push(`${S8}}`);
      lines.push(`${S4}}`);
      tag++;
    }
  } else {
    for (const f of fields) {
      pushFieldWrite(lines, f, S4);
    }
  }
  return lines;
}

/** 按字段类型追加 write 行（不含外层缩进包装，由 caller 传入当前缩进） */
function pushFieldWrite(lines: string[], f: MappedField, indent: string, bufVar = "buf"): void {
  if (f.isArray) {
    lines.push(`${indent}int ${f.javaName}_count = this.${f.javaName} == null ? 0 : this.${f.javaName}.size();`);
    lines.push(`${indent}writeShort(${bufVar}, (short)${f.javaName}_count);`);
    lines.push(`${indent}for (int i = 0; i < ${f.javaName}_count; i++) {`);
    const inner = indent + S4;
    if (f.element?.isStruct) {
      lines.push(`${inner}writeBean(${bufVar}, this.${f.javaName}.get(i));`);
    } else {
      lines.push(`${inner}${f.javaWrite}(${bufVar}, this.${f.javaName}.get(i));`);
    }
    lines.push(`${indent}}`);
  } else if (f.isStruct) {
    lines.push(`${indent}writeBean(${bufVar}, this.${f.javaName});`);
  } else {
    lines.push(`${indent}${f.javaWrite}(${bufVar}, this.${f.javaName});`);
  }
}

/** 生成 Java read 行（tagged=true: while-readTag+switch；tagged=false: 顺序读出所有字段） */
function genJavaReadLines(fields: MappedField[], tagged: boolean): string[] {
  const lines: string[] = [];
  if (!tagged && fields.length === 0) return lines;

  if (tagged) {
    lines.push(`${S4}this.__setFields.clear();`);
    lines.push(`${S4}int __fieldCount = readShort(buf);`);
    lines.push(`${S4}for (int __i = 0; __i < __fieldCount; __i++) {`);
    lines.push(`${S8}int __tag = readShort(buf);`);
    lines.push(`${S8}int __length = readInt(buf);`);
    lines.push(`${S8}ByteBuf __fieldBuf = buf.readSlice(__length);`);
    lines.push(`${S8}switch (__tag) {`);
    let tag = 0;
    for (const f of fields) {
      lines.push(`${S8}case ${tag}:`);
      pushFieldRead(lines, f, S12, "__fieldBuf");
      lines.push(`${S12}this.__setFields.add("${f.javaName}");`);
      lines.push(`${S12}break;`);
      tag++;
    }
    lines.push(`${S8}default:`);
    lines.push(`${S12}break;`);
    lines.push(`${S8}}`);
    lines.push(`${S4}}`);
  } else {
    for (const f of fields) {
      pushFieldRead(lines, f, S4);
    }
  }
  return lines;
}

/** 按字段类型追加 read 行（不含外层缩进包装） */
function pushFieldRead(lines: string[], f: MappedField, indent: string, bufVar = "buf"): void {
  if (f.isArray) {
    const lenVar = `${f.javaName}_length`;
    lines.push(`${indent}int ${lenVar} = readShort(${bufVar});`);
    lines.push(`${indent}this.${f.javaName} = new ArrayList<${f.element!.javaType}>();`);
    lines.push(`${indent}for (int i = 0; i < ${lenVar}; i++) {`);
    const inner = indent + S4;
    if (f.element?.isStruct) {
      lines.push(`${inner}this.${f.javaName}.add((${f.element.javaType}) readBean(${bufVar}, ${f.element.javaType}.class));`);
    } else {
      lines.push(`${inner}this.${f.javaName}.add(${f.javaRead}(${bufVar}));`);
    }
    lines.push(`${indent}}`);
  } else if (f.isStruct) {
    lines.push(`${indent}this.${f.javaName} = (${f.javaType}) readBean(${bufVar}, ${f.javaType}.class);`);
  } else {
    lines.push(`${indent}this.${f.javaName} = ${f.javaRead}(${bufVar});`);
  }
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

function buildStructPackageMap(
  modules: ModuleDef[],
  opts: ResolvedOptions,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const mod of modules) {
    const pkgSeg = moduleToPackageSeg(mod.moduleName, opts.modulePackageMap);
    for (const struct of mod.structs ?? []) {
      if (struct.name.trim()) {
        map.set(struct.name.trim(), `${opts.javaBasePackage}.${pkgSeg}.bean`);
      }
    }
  }
  return map;
}

function fieldStructImports(
  fields: MappedField[],
  currentPackage: string,
  structPackageMap: Map<string, string>,
): string[] {
  const imports = new Set<string>();
  for (const name of fieldStructTypes(fields)) {
    const pkg = structPackageMap.get(name);
    if (pkg && pkg !== currentPackage) {
      imports.add(`${pkg}.${name}`);
    }
  }
  return [...imports].sort();
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
  structPackageMap: Map<string, string>,
): RenderMessage {
  const pkgSeg = moduleToPackageSeg(module.moduleName, opts.modulePackageMap);
  const fields = mapFieldsWithStructs(msg.fields, structTypes);
  const fullName = ensurePrefix(msg.name, msg.type);
  const javaPackage = `${opts.javaBasePackage}.${pkgSeg}.messages`;
  return {
    id: msg.id,
    name: fullName,
    type: msg.type,
    desc: msg.desc,
    fileName: module.fileName,
    moduleName: module.moduleName,
    javaClassName: `${fullName}Message`,
    javaPackage,
    handlerPackage: `${opts.handlerBasePackage}.${pkgSeg}.handler`,
    handlerClassName: `${fullName}Handler`,
    structImports: fieldStructImports(fields, javaPackage, structPackageMap),
    fields,
    csEncodeLines: genCsEncodeLines(fields, true),
    csDecodeLines: genCsDecodeLines(fields, true),
    javaWriteLines: genJavaWriteLines(fields, true),
    javaReadLines: genJavaReadLines(fields, true),
  };
}

/** 构建单个渲染对象结构 */
export function buildRenderStruct(
  struct: StructDef,
  module: ModuleDef,
  opts: ResolvedOptions,
  structTypes: Set<string>,
  structPackageMap: Map<string, string>,
): RenderStruct {
  const pkgSeg = moduleToPackageSeg(module.moduleName, opts.modulePackageMap);
  const fields = mapFieldsWithStructs(struct.fields, structTypes);
  const javaPackage = `${opts.javaBasePackage}.${pkgSeg}.bean`;
  return {
    name: struct.name,
    desc: struct.desc,
    fileName: module.fileName,
    moduleName: module.moduleName,
    javaClassName: struct.name,
    javaPackage,
    structImports: fieldStructImports(fields, javaPackage, structPackageMap),
    fields,
    csEncodeLines: genCsEncodeLines(fields, true),
    csDecodeLines: genCsDecodeLines(fields, true),
    javaWriteLines: genJavaWriteLines(fields, true),
    javaReadLines: genJavaReadLines(fields, true),
  };
}

/** 构建所有渲染模块 */
export function buildRenderModules(
  modules: ModuleDef[],
  opts: ResolvedOptions,
): RenderModule[] {
  const structTypes = new Set(modules.flatMap((m) => (m.structs ?? []).map((struct) => struct.name)));
  const structPackageMap = buildStructPackageMap(modules, opts);
  return modules.map((m) => ({
    fileName: m.fileName,
    moduleName: m.moduleName,
    desc: m.desc,
    structs: (m.structs ?? []).map((struct) => buildRenderStruct(struct, m, opts, structTypes, structPackageMap)),
    messages: m.messages.map((msg) => buildRenderMessage(msg, m, opts, structTypes, structPackageMap)),
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
