import path from "node:path";

export type Art = "brief" | "kapitel" | "recht";

export interface DocumentMeta {
  datum: string;
  art: Art;
  titel: string;
  nummer: number | null;
  /** Ein Entwurf liegt nur in der Redaktion. Der Setzer lässt ihn aus. */
  entwurf: boolean;
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
  if (doc.entwurf) lines.push("entwurf: true");
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
    entwurf: unquote(fields.get("entwurf") ?? "") === "true",
    body: match[2].trim(),
  };
}

/** Öffentliche Adressen, wie sie advocat-finanz.ch verwendet. */
const BRIEF_SLUGS: Record<number, string> = {
  1: "newsletter-1",
  2: "newsletter-2",
  3: "newsletter-3",
  4: "newsletter-4",
  5: "newsletter-5",
  6: "newsletter-6",
  7: "newsletter-7",
  8: "newsletter-8",
  9: "newsletter-9",
  10: "newsletter-10",
  11: "newsletter-11",
  12: "newsletter-12",
  13: "newsletter-13",
  14: "newsletter-14",
  15: "newsletter-15",
  16: "newsletter-16",
  17: "newsletter-17",
  18: "newsletter-18",
  19: "newsletter-19",
  20: "newsletter-20",
  21: "newsletter-21",
  22: "newsletter-22",
  23: "newsletter-23",
  24: "newsletter-24",
  25: "newsletter-25",
  26: "newsletter-26",
  27: "newsletter-27-halbjahresbilanz-ehe-fuer-alle",
  28: "newsletter-28-revision-des-erbrechts",
  29: "newsletter-29-sektorrotation-zu-ueberperformance-gedeckte-calls",
  30: "newsletter-30-erbengemeinschaften-und-willensvollstreckungen",
  31: "newsletter-31-demografischer-wandel-und-finanzmaerkte",
  32: "newsletter-32-nachtraegliche-einzahlungen-3a",
  33: "newsletter-33-langzeitstudie-aktienperformance",
  34: "newsletter-34-edelmetalle-und-rohstoffe-sicherer-hafen",
  35: "newsletter-35-transparenzregister-neuerungen-gwg-fuer-beraterinnen-und-berater-marktgeschehen",
};

export function publicPath(rel: string): string {
  const norm = rel.replaceAll("\\", "/");
  if (norm === "kapitel/willkommen.md") return "/";
  if (norm === "kapitel/unternehmen.md") return "/unternehmen-2";
  if (norm === "kapitel/stiftungen.md") return "/stiftungen-2";
  if (norm.startsWith("briefe/")) {
    const base = path.posix.basename(norm, ".md");
    const nummer = Number(base.slice(0, 4));
    if (Number.isFinite(nummer) && BRIEF_SLUGS[nummer]) return `/${BRIEF_SLUGS[nummer]}`;
    const rest = base.replace(/^\d{4}-/, "");
    if (rest.startsWith("newsletter-")) return `/${rest}`;
    return rest ? `/newsletter-${nummer}-${rest}` : `/newsletter-${nummer}`;
  }
  return `/${path.posix.basename(norm, ".md")}`;
}

/** Alte Adressen aus der ersten Fassung auf die öffentlichen Pfade legen. */
export function redirectTarget(pathname: string): string | null {
  const pathOnly = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (pathOnly === "/willkommen") return "/";
  if (pathOnly === "/unternehmen") return "/unternehmen-2";
  if (pathOnly === "/stiftungen") return "/stiftungen-2";
  const brief = pathOnly.match(/^\/briefe\/(\d{4})(?:-(.+))?$/);
  if (!brief) return null;
  const stem = brief[2] ? `${brief[1]}-${brief[2]}` : brief[1];
  const target = publicPath(`briefe/${stem}.md`);
  return target === pathOnly ? null : target;
}
