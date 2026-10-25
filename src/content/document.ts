import path from "node:path";

export type Art = "brief" | "kapitel" | "recht";

export interface DocumentMeta {
  datum: string;
  art: Art;
  titel: string;
  nummer: number | null;
  /** Pfad relativ zu CONTENT_DIR, mit Schrägstrichen. */
  rel: string;
}

export interface ContentDocument extends DocumentMeta {
  body: string;
}

const ARTS: readonly Art[] = ["brief", "kapitel", "recht"];

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return trimmed;
}

export function serializeDocument(doc: ContentDocument): string {
  const lines = [
    "---",
    `datum: ${doc.datum || '""'}`,
    `art: ${doc.art}`,
    `titel: ${yamlQuote(doc.titel)}`,
  ];
  if (doc.nummer != null) lines.push(`nummer: ${doc.nummer}`);
  lines.push("---", "", doc.body.trim(), "");
  return lines.join("\n");
}

export function parseDocument(raw: string, rel: string): ContentDocument {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`Kein Frontmatter in ${rel}`);
  }
  const fields = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    fields.set(line.slice(0, sep).trim(), line.slice(sep + 1).trim());
  }
  const art = unquote(fields.get("art") ?? "");
  if (!ARTS.includes(art as Art)) {
    throw new Error(`Unbekannte Art "${art}" in ${rel}`);
  }
  const nummerRaw = fields.get("nummer");
  const nummer = nummerRaw && nummerRaw !== '""' ? Number(nummerRaw) : null;
  return {
    rel: rel.replaceAll("\\", "/"),
    datum: unquote(fields.get("datum") ?? ""),
    art: art as Art,
    titel: unquote(fields.get("titel") ?? ""),
    nummer: nummer != null && Number.isFinite(nummer) ? nummer : null,
    body: match[2].trim(),
  };
}

/** Öffentliche Adresse einer Inhaltsdatei. Die Startseite ist davon getrennt der neueste Brief. */
export function publicPath(rel: string): string {
  const base = path.posix.basename(rel.replaceAll("\\", "/"), ".md");
  if (rel.replaceAll("\\", "/").startsWith("briefe/")) return `/briefe/${base}`;
  return `/${base}`;
}
