/**
 * 协议代码生成 - 统一导出
 */
export type {
  FieldDef,
  MessageType,
  MessageDef,
  StructDef,
  ModuleDef,
  MappedField,
  RenderStruct,
  RenderMessage,
  RenderModule,
  GenerateOptions,
  GenerateResult,
} from "./types";

export { mapField, mapFields } from "./typeMapper";
export { templates } from "./templates";
export { generateProtocols, previewProtocols } from "./generateProtocols";
export type { PreviewFile, PreviewResult } from "./generateProtocols";
