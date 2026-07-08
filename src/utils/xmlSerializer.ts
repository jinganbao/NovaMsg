import type { ModuleDef } from "@/generator/types";

/** 将 ModuleDef 序列化为 XML 字符串 */
export function moduleToXml(mod: ModuleDef): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  const modAttrs = [`moduleName="${esc(mod.moduleName)}"`];
  if (mod.desc) modAttrs.push(`desc="${esc(mod.desc)}"`);
  lines.push(`<Module ${modAttrs.join(" ")}>`);
  for (const struct of mod.structs) {
    const structAttrs = [`name="${esc(struct.name)}"`];
    if (struct.desc) structAttrs.push(`desc="${esc(struct.desc)}"`);
    lines.push(`  <Struct ${structAttrs.join(" ")}>`);
    for (const f of struct.fields) {
      const fAttrs = [
        `type="${esc(f.type)}"`,
        `name="${esc(f.name)}"`,
      ];
      if (f.desc) fAttrs.push(`desc="${esc(f.desc)}"`);
      lines.push(`    <Field ${fAttrs.join(" ")}/>`);
    }
    lines.push("  </Struct>");
  }
  for (const msg of mod.messages) {
    const msgAttrs = [
      `name="${esc(msg.name)}"`,
      `type="${esc(msg.type)}"`,
    ];
    if (msg.desc) msgAttrs.push(`desc="${esc(msg.desc)}"`);
    if (msg.id > 0) msgAttrs.push(`id="${msg.id}"`);
    lines.push(`  <Message ${msgAttrs.join(" ")}>`);
    for (const f of msg.fields) {
      const fAttrs = [
        `type="${esc(f.type)}"`,
        `name="${esc(f.name)}"`,
      ];
      if (f.desc) fAttrs.push(`desc="${esc(f.desc)}"`);
      lines.push(`    <Field ${fAttrs.join(" ")}/>`);
    }
    lines.push("  </Message>");
  }
  lines.push("</Module>");
  return lines.join("\n") + "\n";
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
