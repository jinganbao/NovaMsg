type GeneratedLanguage = "java" | "csharp";

function normalizeLine(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith("*") && trimmed !== "*/") {
    return ` ${trimmed}`;
  }
  if (trimmed === "*/") {
    return " */";
  }
  return trimmed
    .replace(/\s+;/g, ";")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*=\s*new\b/g, " = new")
    .replace(/\s*=\s*read/g, " = read")
    .replace(/\(short\)\s*this\./g, "(short) this.")
    .replace(/^\/\/(\S)/, "// $1")
    .replace(/^\/\*\*\s*(.*?)\s*\*\/$/, "/** $1 */");
}

function indentCode(content: string, language: GeneratedLanguage): string {
  const indentUnit = "    ";
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const formatted: string[] = [];
  let indent = 0;
  let inSwitchCase = false;
  let previousBlank = false;

  for (const sourceLine of lines) {
    const line = normalizeLine(sourceLine);
    if (!line) {
      if (!previousBlank && formatted.length > 0) {
        formatted.push("");
        previousBlank = true;
      }
      continue;
    }

    if (
      inSwitchCase &&
      (line.startsWith("case ") || line.startsWith("default:") || line.startsWith("}"))
    ) {
      indent = Math.max(0, indent - 1);
      inSwitchCase = false;
    }

    if (line.startsWith("}") || line.startsWith("};")) {
      indent = Math.max(0, indent - 1);
    }

    formatted.push(indentUnit.repeat(indent) + line);
    previousBlank = false;

    const opensBlock = line.endsWith("{");
    const closesInlineBlock = line.startsWith("}") && line.endsWith("{");
    if (opensBlock || closesInlineBlock) {
      indent += 1;
    }

    if (line.startsWith("case ") || line.startsWith("default:")) {
      indent += 1;
      inSwitchCase = true;
    }

    if (language === "java" && line.startsWith("package ")) {
      formatted.push("");
      previousBlank = true;
    }
  }

  while (formatted.length > 0 && formatted[formatted.length - 1] === "") {
    formatted.pop();
  }
  return formatted.join("\n").replace(/\n\n(\s*})(?=\n|$)/g, "\n$1") + "\n";
}

export function formatGeneratedJava(content: string): string {
  return indentCode(content, "java");
}

export function formatGeneratedCSharp(content: string): string {
  return indentCode(content, "csharp");
}
