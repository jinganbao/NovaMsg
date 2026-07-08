/**
 * XML 解析器：将协议 XML 文件解析为 ModuleDef[]
 *
 * 预期 XML 结构（根据样本代码反推）：
 * <Module fileName="login_message.xml" moduleName="login" desc="登陆消息">
 *   <Message id="5005" name="S2C_AccountLoginSuccess" type="S2C" desc="返回登陆账号成功">
 *     <Field type="int" name="ServerCurTime" desc="服务器当前时间"/>
 *     <Field type="string" name="ServerVer" desc="服务器版本"/>
 *     ...
 *   </Message>
 * </Module>
 *
 * 也兼容根节点为 <Root><Module>...</Module></Root> 的形式。
 */
import { XMLParser } from "fast-xml-parser";
import type { ModuleDef, MessageDef, FieldDef, StructDef, MessageType } from "@/generator/types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  trimValues: true,
  isArray: (name) => name === "Message" || name === "Struct" || name === "Field" || name === "Module",
});

/** 从解析结果中提取数组（兼容单元素/数组） */
function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** 解析单个字段节点 */
function parseField(node: Record<string, unknown>): FieldDef {
  return {
    type: String(node.type ?? "string"),
    name: String(node.name ?? ""),
    desc: String(node.desc ?? ""),
  };
}

/** 解析单个消息节点 */
function parseMessage(node: Record<string, unknown>): MessageDef {
  return {
    id: Number(node.id ?? 0),
    name: String(node.name ?? ""),
    type: String(node.type ?? "S2C") as MessageType,
    desc: String(node.desc ?? ""),
    fields: toArray(node.Field as Record<string, unknown>[] | undefined).map(parseField),
  };
}

/** 解析单个对象结构节点 */
function parseStruct(node: Record<string, unknown>): StructDef {
  return {
    name: String(node.name ?? ""),
    desc: String(node.desc ?? ""),
    fields: toArray(node.Field as Record<string, unknown>[] | undefined).map(parseField),
  };
}

/** 解析单个模块节点 */
function parseModule(node: Record<string, unknown>): ModuleDef {
  return {
    fileName: String(node.fileName ?? ""),
    moduleName: String(node.moduleName ?? ""),
    desc: String(node.desc ?? ""),
    structs: toArray(node.Struct as Record<string, unknown>[] | undefined).map(parseStruct),
    messages: toArray(node.Message as Record<string, unknown>[] | undefined).map(parseMessage),
  };
}

/**
 * 解析 XML 字符串为 ModuleDef
 * @param xmlText XML 文本内容
 */
export function parseXmlModule(xmlText: string): ModuleDef {
  const parsed = parser.parse(xmlText);

  // 兼容 <Module>...</Module> 或 <Root><Module>...</Module></Root>
  const moduleNode =
    parsed.Module ??
    parsed.module ??
    (parsed.Root?.Module as Record<string, unknown> | undefined) ??
    (parsed.root?.module as Record<string, unknown> | undefined);

  if (!moduleNode || typeof moduleNode !== "object") {
    throw new Error("XML 中未找到 <Module> 根节点");
  }

  // 如果有多个 Module，取第一个（单文件单模块）
  const node = Array.isArray(moduleNode) ? moduleNode[0] : moduleNode;
  return parseModule(node as Record<string, unknown>);
}

/**
 * 批量解析 XML 文件
 * @param files 文件路径与内容数组
 */
export function parseXmlFiles(
  files: { name: string; content: string }[],
): ModuleDef[] {
  return files.map((f) => {
    try {
      const mod = parseXmlModule(f.content);
      mod.fileName = f.name;
      mod.rawContent = f.content;
      return mod;
    } catch (e) {
      throw new Error(`解析 ${f.name} 失败: ${(e as Error).message}`);
    }
  });
}
