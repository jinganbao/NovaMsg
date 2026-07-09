/**
 * 协议校验逻辑
 */
import { ref, computed } from "vue";
import type { ModuleDef } from "@/generator/types";

export type ValidationIssue = {
  level: "error" | "warning";
  fileName: string;
  target: string;
  message: string;
};

const primitiveTypeSet = new Set(["int", "long", "float", "double", "string", "boolean", "short", "byte"]);
const javaKeywordSet = new Set([
  "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char", "class", "const", "continue", "default",
  "do", "double", "else", "enum", "extends", "final", "finally", "float", "for", "goto", "if", "implements", "import",
  "instanceof", "int", "interface", "long", "native", "new", "package", "private", "protected", "public", "return",
  "short", "static", "strictfp", "super", "switch", "synchronized", "this", "throw", "throws", "transient", "try",
  "void", "volatile", "while",
]);
const csharpKeywordSet = new Set([
  "abstract", "as", "base", "bool", "break", "byte", "case", "catch", "char", "checked", "class", "const", "continue",
  "decimal", "default", "delegate", "do", "double", "else", "enum", "event", "explicit", "extern", "false", "finally",
  "fixed", "float", "for", "foreach", "goto", "if", "implicit", "in", "int", "interface", "internal", "is", "lock",
  "long", "namespace", "new", "null", "object", "operator", "out", "override", "params", "private", "protected",
  "public", "readonly", "ref", "return", "sbyte", "sealed", "short", "sizeof", "stackalloc", "static", "string",
  "struct", "switch", "this", "throw", "true", "try", "typeof", "uint", "ulong", "unchecked", "unsafe", "ushort",
  "using", "virtual", "void", "volatile", "while",
]);

function parseListElementType(type: string): string | null {
  const clean = type.trim();
  const angleMatch = clean.match(/^(?:array|list|java\.util\.List)<(.+)>$/i);
  if (angleMatch) return angleMatch[1].trim();
  const bracketMatch = clean.match(/^(.+)\[\]$/);
  if (bracketMatch) return bracketMatch[1].trim();
  return null;
}

function normalizeFieldType(type: string): string {
  const clean = (parseListElementType(type) ?? type).trim().replace(/^java\.lang\./i, "").replace(/\s+/g, "");
  const map: Record<string, string> = {
    integer: "int",
    int: "int",
    long: "long",
    float: "float",
    double: "double",
    string: "string",
    boolean: "boolean",
    bool: "boolean",
    short: "short",
    byte: "byte",
  };
  return map[clean.toLowerCase()] ?? clean;
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

function lowerFirst(value: string): string {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

function upperFirst(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function addDuplicateIssues(
  issues: ValidationIssue[],
  fileName: string,
  target: string,
  fields: { name: string }[],
) {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const field of fields) {
    const name = field.name.trim();
    if (!name) continue;
    if (seen.has(name)) duplicated.add(name);
    seen.add(name);
  }
  for (const name of duplicated) {
    issues.push({ level: "error", fileName, target, message: `字段名重复：${name}` });
  }
}

function validateField(
  issues: ValidationIssue[],
  fileName: string,
  target: string,
  field: { type: string; name: string },
  structNames: Set<string>,
) {
  const name = field.name.trim();
  if (!name) {
    issues.push({ level: "error", fileName, target, message: "字段名不能为空" });
  } else {
    if (!isIdentifier(name)) issues.push({ level: "error", fileName, target, message: `字段名不是合法标识符：${name}` });
    const javaName = lowerFirst(name);
    const csharpName = upperFirst(name);
    if (javaKeywordSet.has(javaName)) {
      issues.push({ level: "error", fileName, target, message: `字段名生成到 Java 后是关键字：${javaName}` });
    }
    if (csharpKeywordSet.has(csharpName)) {
      issues.push({ level: "error", fileName, target, message: `字段名生成到 C# 后是关键字：${csharpName}` });
    }
  }
  const type = normalizeFieldType(field.type);
  if (!type) {
    issues.push({ level: "error", fileName, target, message: `字段 ${name || "未命名字段"} 类型不能为空` });
  } else if (!primitiveTypeSet.has(type) && !structNames.has(type)) {
    issues.push({ level: "error", fileName, target, message: `字段 ${name || "未命名字段"} 引用了不存在的对象类型：${type}` });
  }
}

export function validateModules(modules: ModuleDef[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const mod of modules) {
    const fileName = mod.fileName || "未命名文件";
    const structNames = new Set((mod.structs ?? []).map((struct) => struct.name.trim()).filter(Boolean));
    const seenStructNames = new Set<string>();
    const seenMessageNames = new Set<string>();

    if (!mod.moduleName.trim()) {
      issues.push({ level: "error", fileName, target: "模块", message: "模块名不能为空" });
    }

    for (const struct of mod.structs ?? []) {
      const target = `对象 ${struct.name || "未命名对象"}`;
      const name = struct.name.trim();
      if (!name) issues.push({ level: "error", fileName, target, message: "对象名不能为空" });
      else {
        if (seenStructNames.has(name)) issues.push({ level: "error", fileName, target, message: `对象名重复：${name}` });
        seenStructNames.add(name);
        if (!isIdentifier(name)) issues.push({ level: "error", fileName, target, message: "对象名不是合法 Java/C# 标识符" });
        if (javaKeywordSet.has(name) || csharpKeywordSet.has(name)) issues.push({ level: "error", fileName, target, message: "对象名不能使用 Java/C# 关键字" });
      }
      addDuplicateIssues(issues, fileName, target, struct.fields);
      for (const field of struct.fields) {
        validateField(issues, fileName, target, field, structNames);
      }
    }

    for (const msg of mod.messages) {
      const target = `消息 ${msg.type}_${msg.name || "未命名消息"}`;
      const name = msg.name.trim();
      if (!name) issues.push({ level: "error", fileName, target, message: "消息名不能为空" });
      else {
        const fullName = msg.name.startsWith(msg.type + "_") ? msg.name : `${msg.type}_${msg.name}`;
        if (seenMessageNames.has(fullName)) issues.push({ level: "error", fileName, target, message: `消息名重复：${fullName}` });
        seenMessageNames.add(fullName);
        if (!isIdentifier(name)) issues.push({ level: "error", fileName, target, message: "消息名不是合法 Java/C# 标识符" });
        if (javaKeywordSet.has(name) || csharpKeywordSet.has(name)) issues.push({ level: "error", fileName, target, message: "消息名不能使用 Java/C# 关键字" });
      }
      if (!["C2S", "S2C", "S2P", "P2S"].includes(msg.type)) {
        issues.push({ level: "error", fileName, target, message: `未知消息方向：${msg.type}` });
      }
      addDuplicateIssues(issues, fileName, target, msg.fields);
      for (const field of msg.fields) {
        validateField(issues, fileName, target, field, structNames);
      }
    }
  }

  return issues;
}

export function useValidation() {
  const showValidationModal = ref(false);
  const validationIssues = ref<ValidationIssue[]>([]);
  const validationErrors = computed(() => validationIssues.value.filter((issue) => issue.level === "error"));
  const validationWarnings = computed(() => validationIssues.value.filter((issue) => issue.level === "warning"));

  function runValidation(modules: ModuleDef[], options: { showSuccess?: boolean } = {}, message?: { success: (m: string) => void; error: (m: string) => void }): boolean {
    validationIssues.value = validateModules(modules);
    if (validationIssues.value.length > 0) {
      showValidationModal.value = true;
    }
    if (validationErrors.value.length > 0) {
      message?.error(`发现 ${validationErrors.value.length} 个协议错误，请先修复`);
      return false;
    }
    if (options.showSuccess) {
      message?.success(validationWarnings.value.length > 0
        ? `校验通过，有 ${validationWarnings.value.length} 个提醒`
        : "校验通过");
    }
    return true;
  }

  return {
    showValidationModal,
    validationIssues,
    validationErrors,
    validationWarnings,
    runValidation,
  };
}
