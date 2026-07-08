/**
 * 协议代码生成 - 类型定义
 */

/** XML 解析后的字段定义 */
export interface FieldDef {
  /** 字段类型，如 "int" / "string" / "LoginInfo" / "array<LoginInfo>" */
  type: string;
  /** 字段名（PascalCase，如 "ServerCurTime"） */
  name: string;
  /** 字段描述 */
  desc: string;
}

/** 消息类型 */
export type MessageType = "S2C" | "C2S" | "P2S" | "S2P";

/** XML 解析后的消息定义 */
export interface MessageDef {
  /** 消息 ID */
  id: number;
  /** 消息名（如 "S2C_Common"） */
  name: string;
  /** 消息方向 */
  type: MessageType;
  /** 消息描述 */
  desc: string;
  /** 字段列表 */
  fields: FieldDef[];
}

/** XML 解析后的对象结构定义 */
export interface StructDef {
  /** 对象名，如 "LoginForChannelTest" */
  name: string;
  /** 对象描述 */
  desc: string;
  /** 字段列表 */
  fields: FieldDef[];
}

/** XML 解析后的模块定义 */
export interface ModuleDef {
  /** 文件名，如 "login_message.xml" */
  fileName: string;
  /** 模块名，如 "login" / "common" / "system" */
  moduleName: string;
  /** 模块描述 */
  desc: string;
  /** 消息列表 */
  messages: MessageDef[];
  /** 对象结构列表 */
  structs: StructDef[];
  /** 原始 XML 内容 */
  rawContent?: string;
}

/** 类型映射后的字段描述（用于渲染） */
export interface MappedField {
  /** 原始字段名（PascalCase） */
  name: string;
  /** C# 字段名（原样） */
  csName: string;
  /** Java 字段名（首字母小写） */
  javaName: string;
  /** 字段描述 */
  desc: string;
  /** 是否为数组类型 */
  isArray: boolean;
  /** 是否为自定义对象类型 */
  isStruct: boolean;
  /** C# 字段类型，如 "int" / "String" / "RepeatedField<String>" */
  csType: string;
  /** Java 字段类型，如 "int" / "String" / "List<String>" */
  javaType: string;
  /** C# 写入方法名，如 "writeInt" / "writeString" */
  csWrite: string;
  /** C# 读取方法名，如 "readInt" / "readString" */
  csRead: string;
  /** Java 写入方法名 */
  javaWrite: string;
  /** Java 读取方法名 */
  javaRead: string;
  /** 数组元素类型描述（isArray 为 true 时有效） */
  element?: {
    csType: string;
    javaType: string;
    csWrite: string;
    csRead: string;
    javaWrite: string;
    javaRead: string;
    isStruct: boolean;
  };
}

/** 渲染用的对象结构模型 */
export interface RenderStruct {
  name: string;
  desc: string;
  fileName: string;
  moduleName: string;
  javaClassName: string;
  javaPackage: string;
  fields: MappedField[];
  csEncodeLines: string[];
  csDecodeLines: string[];
  javaWriteLines: string[];
  javaReadLines: string[];
}

/** 渲染用的消息模型 */
export interface RenderMessage {
  id: number;
  /** 消息名（如 "S2C_Common"） */
  name: string;
  type: MessageType;
  desc: string;
  /** 来源文件名，如 "common_message.xml" */
  fileName: string;
  /** 所属模块名 */
  moduleName: string;
  /** Java 实体类名（如 "S2C_CommonMessage"） */
  javaClassName: string;
  /** Java 实体包名（如 "com.rilon.gamebase.message.messages"） */
  javaPackage: string;
  /** Java Handler 包名（如 "com.rilon.gamelogic.message.handler"） */
  handlerPackage: string;
  /** Java Handler 类名（如 "C2S_CommonHandler"） */
  handlerClassName: string;
  /** Java 消息类需要导入的 Bean 类 */
  structImports: string[];
  /** 处理后的字段列表 */
  fields: MappedField[];
  /** C# encode 方法体行（含缩进，不含方法签名） */
  csEncodeLines: string[];
  /** C# decode 方法体行 */
  csDecodeLines: string[];
  /** Java write 方法体行 */
  javaWriteLines: string[];
  /** Java read 方法体行 */
  javaReadLines: string[];
}

/** 渲染用的模块模型 */
export interface RenderModule {
  fileName: string;
  moduleName: string;
  desc: string;
  structs: RenderStruct[];
  messages: RenderMessage[];
}

/** 生成器配置选项 */
export interface GenerateOptions {
  /** 模块名到包名段的映射，默认 { common: "message" } */
  modulePackageMap?: Record<string, string>;
  /** Java 实体基础包，默认 "com.rilon.gamebase" */
  javaBasePackage?: string;
  /** Java Handler 基础包，默认 "com.rilon.gamelogic" */
  handlerBasePackage?: string;
  /** MessageId.java 汇总包，默认 "com.rilon.gamebase.message" */
  messageIdPackage?: string;
  /** GameHandlerManager.java 汇总包，默认 "com.rilon.gamelogic.message" */
  gameHandlerManagerPackage?: string;
  /** 作者标识，默认 "Sunshine" */
  author?: string;
  /** 版本时间字符串（不传则取当前时间） */
  versionStr?: string;
  /** 版本数字（不传则取当前时间戳秒） */
  versionNum?: number;
}

/** 生成结果 */
export interface GenerateResult {
  /** 写入的文件路径列表 */
  writtenFiles: string[];
  /** 跳过生成的文件路径列表（如已存在的 Handler） */
  skippedFiles: string[];
}
