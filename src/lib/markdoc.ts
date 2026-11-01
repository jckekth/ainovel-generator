/**
 * Markdown files with a YAML header, the format of setting.md and character files:
 *
 *   ---
 *   name: Lin Feng
 *   age: 19
 *   ---
 *
 *   Free text body.
 */
import { t } from "../i18n";
import { Document, isScalar, parse, visit } from "yaml";

export interface MarkDoc {
  header: Record<string, unknown>;
  body: string;
}

// The closing --- must start its own line, so "a---b" inside a value does not end the header.
const FRONT = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

export function parseMarkDoc(raw: string): MarkDoc {
  // Some editors put a byte-order mark at the start of the file.
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const match = FRONT.exec(text);
  if (!match) return { header: {}, body: text.trim() };
  let header: unknown;
  try {
    header = parse(match[1] ?? "") ?? {};
  } catch (e) {
    throw new Error(t("error.yaml", { detail: e instanceof Error ? e.message : String(e) }));
  }
  if (typeof header !== "object" || Array.isArray(header)) {
    throw new Error(t("error.yamlShape"));
  }
  return { header: header as Record<string, unknown>, body: text.slice(match[0].length).trim() };
}

export function formatMarkDoc(doc: MarkDoc): string {
  const yamlDoc = new Document(doc.header);
  // Short lists of plain values read better on one line: "stages: [Early, Middle, Late]".
  visit(yamlDoc, {
    Seq(_, node) {
      const items = node.items;
      if (items.every(isScalar) && items.map((i) => String(i.value)).join(", ").length <= 60) node.flow = true;
    },
  });
  // lineWidth 0 keeps long text on one line instead of folding it.
  const yaml = yamlDoc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd();
  const body = doc.body.trim();
  return `---\n${yaml}\n---\n${body ? `\n${body}\n` : ""}`;
}
