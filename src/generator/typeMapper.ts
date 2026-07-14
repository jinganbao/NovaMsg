/**
 * 协议代码生成 - 数据类型映射
 *
 * 将 XML 中的基础类型描述（如 "int" / "string" / "array"）
 * 映射为 C# 与 Java 的具体类型及对应的读写方法。
 */
import type { FieldDef, MappedField } from "./types";

/** 单个基础类型的映射条目 */
interface BaseTypeMap {
  /** C# 类型，如 "int" / "String" */
  cs: string;
  /** Java 类型，如 "int" / "String" */
  java: string;
  /** C# 写入方法，如 "writeInt" */
  csWrite: string;
  /** C# 读取方法，如 "readInt" */
  csRead: string;
  /** Java 写入方法 */
  javaWrite: string;
  /** Java 读取方法 */
  javaRead: string;
}

/** 基础类型映射字典 */
const PRIMITIVE_TYPE_MAP: Record<string, BaseTypeMap> = {
  int: { cs: "int", java: "int", csWrite: "writeInt", csRead: "readInt", javaWrite: "writeInt", javaRead: "readInt" },
  int32: { cs: "int", java: "int", csWrite: "writeInt", csRead: "readInt", javaWrite: "writeInt", javaRead: "readInt" },
  uint: { cs: "int", java: "int", csWrite: "writeInt", csRead: "readInt", javaWrite: "writeInt", javaRead: "readInt" },
  short: { cs: "short", java: "short", csWrite: "writeShort", csRead: "readShort", javaWrite: "writeShort", javaRead: "readShort" },
  ushort: { cs: "short", java: "short", csWrite: "writeShort", csRead: "readShort", javaWrite: "writeShort", javaRead: "readShort" },
  long: { cs: "long", java: "long", csWrite: "writeLong", csRead: "readLong", javaWrite: "writeLong", javaRead: "readLong" },
  byte: { cs: "byte", java: "byte", csWrite: "writeByte", csRead: "readByte", javaWrite: "writeByte", javaRead: "readByte" },
  bool: { cs: "bool", java: "boolean", csWrite: "writeBool", csRead: "readBool", javaWrite: "writeBool", javaRead: "readBool" },
  boolean: { cs: "bool", java: "boolean", csWrite: "writeBool", csRead: "readBool", javaWrite: "writeBool", javaRead: "readBool" },
  float: { cs: "float", java: "float", csWrite: "writeFloat", csRead: "readFloat", javaWrite: "writeFloat", javaRead: "readFloat" },
  double: { cs: "double", java: "double", csWrite: "writeDouble", csRead: "readDouble", javaWrite: "writeDouble", javaRead: "readDouble" },
  string: { cs: "String", java: "String", csWrite: "writeString", csRead: "readString", javaWrite: "writeString", javaRead: "readString" },
};

/** 默认基础类型（未识别时回退为 string） */
const DEFAULT_TYPE_MAP: BaseTypeMap = PRIMITIVE_TYPE_MAP.string;

/**
 * 解析基础类型映射
 * @param type 类型字符串，如 "int" / "string"
 */
function resolvePrimitive(type: string): BaseTypeMap {
  const key = type.trim().toLowerCase();
  return PRIMITIVE_TYPE_MAP[key] ?? DEFAULT_TYPE_MAP;
}

function findStructType(type: string, structTypes: Set<string>): string | null {
  const clean = type.trim();
  for (const item of structTypes) {
    if (item === clean) return item;
  }
  return null;
}

/** 解析数组类型，返回元素类型字符串；若非数组返回 null */
function parseArrayElement(type: string): string | null {
  const clean = type.trim();
  const t = clean.toLowerCase();
  // array<string> / array<int> / list<string>
  const angleMatch = clean.match(/^(?:array|list)<([^>]+)>$/i);
  if (angleMatch) return angleMatch[1].trim();
  // string[] / int[]
  const bracketMatch = clean.match(/^([^[]+)\[\]$/);
  if (bracketMatch) return bracketMatch[1].trim();
  // array / list（无显式元素类型，默认 string）
  if (t === "array" || t === "list" || t === "repeated") return "string";
  return null;
}

/**
 * 将单个 FieldDef 映射为渲染用的 MappedField
 */
export function mapField(field: FieldDef, structTypes = new Set<string>()): MappedField {
  // C# / Java 字段名：首字母小写
  const csName = field.name.charAt(0).toLowerCase() + field.name.slice(1);
  const javaName = field.name.charAt(0).toLowerCase() + field.name.slice(1);

  const elementTypeRaw = parseArrayElement(field.type);
  const isArray = elementTypeRaw !== null;

  if (isArray) {
    const structType = findStructType(elementTypeRaw!, structTypes);
    const elem = structType
      ? {
          cs: structType,
          java: structType,
          csWrite: "",
          csRead: "",
          javaWrite: "",
          javaRead: "",
        }
      : resolvePrimitive(elementTypeRaw!);
    return {
      name: field.name,
      csName,
      javaName,
      desc: field.desc,
      isArray: true,
      isStruct: structType !== null,
      csType: `RepeatedField<${elem.cs}>`,
      javaType: `List<${elem.java}>`,
      csWrite: elem.csWrite,
      csRead: elem.csRead,
      javaWrite: elem.javaWrite,
      javaRead: elem.javaRead,
      element: {
        csType: elem.cs,
        javaType: elem.java,
        csWrite: elem.csWrite,
        csRead: elem.csRead,
        javaWrite: elem.javaWrite,
        javaRead: elem.javaRead,
        isStruct: structType !== null,
      },
    };
  }

  const structType = findStructType(field.type, structTypes);
  if (structType) {
    return {
      name: field.name,
      csName,
      javaName,
      desc: field.desc,
      isArray: false,
      isStruct: true,
      csType: structType,
      javaType: structType,
      csWrite: "",
      csRead: "",
      javaWrite: "",
      javaRead: "",
    };
  }

  const m = resolvePrimitive(field.type);
  return {
    name: field.name,
    csName,
    javaName,
    desc: field.desc,
    isArray: false,
    isStruct: false,
    csType: m.cs,
    javaType: m.java,
    csWrite: m.csWrite,
    csRead: m.csRead,
    javaWrite: m.javaWrite,
    javaRead: m.javaRead,
  };
}

/** 批量映射字段 */
export function mapFields(fields: FieldDef[]): MappedField[] {
  return fields.map((field) => mapField(field));
}

/** 批量映射字段，支持当前模块内的 Struct 类型 */
export function mapFieldsWithStructs(fields: FieldDef[], structTypes: Set<string>): MappedField[] {
  return fields.map((field) => mapField(field, structTypes));
}
