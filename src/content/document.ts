import path from "node:path";

export type Art = "brief" | "kapitel" | "recht";

export interface DocumentMeta {
  datum: string;
  art: Art;
  titel: string;
  nummer: number | null;
  /** Ein Entwurf liegt nur in der Redaktion. Der Setzer lässt ihn aus. */
  entwurf: boolean;
  /** Nur übrige Seiten (nicht Newsletter): selbst gewählte Adresse wie „/firmenkunden“. Leer: die Standardadresse. */
  adresse?: string | null;
  /** Nur übrige Seiten: frühere Adressen. Sie leiten auf die heutige weiter. */
  frueher?: string[];
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
  if (doc.adresse) lines.push(`adresse: ${doc.adresse}`);
  if (doc.frueher?.length) lines.push(`frueher: ${doc.frueher.join(" ")}`);
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
    adresse: istAdresse(unquote(fields.get("adresse") ?? "")) ? unquote(fields.get("adresse") ?? "") : null,
    frueher: unquote(fields.get("frueher") ?? "").split(/\s+/).filter(istAdresse),
    body: match[2].trim(),
  };
}

function istAdresse(value: string): boolean {
  return /^\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

/** Die Startseite hat immer „/“. */
export const STARTSEITE = "kapitel/willkommen.md";

/**
 * Adressen, unter denen die Seiten früher standen (WordPress, erste Fassung).
 * Sie leiten auf die heutige Adresse der Seite weiter, auch wenn Patrick sie umbenennt.
 */
const ALTE_ADRESSEN: Record<string, string[]> = {
  "kapitel/willkommen.md": ["/willkommen"],
  "kapitel/unternehmen.md": ["/unternehmen"],
  "kapitel/stiftungen.md": ["/stiftungen"],
};

/** Die Adresse einer Seite, solange niemand eine eigene gewählt hat. Newsletter: /newsletter-<Nummer>. */
export function standardPfad(rel: string): string {
  const norm = rel.replaceAll("\\", "/");
  if (norm === STARTSEITE) return "/";
  if (norm === "kapitel/unternehmen.md") return "/unternehmen-2";
  if (norm === "kapitel/stiftungen.md") return "/stiftungen-2";
  const base = path.posix.basename(norm, ".md");
  if (norm.startsWith("briefe/")) {
    const nummer = Number(base.slice(0, 4));
    if (/^\d{4}/.test(base) && nummer > 0) return `/newsletter-${nummer}`;
  }
  return `/${base}`;
}

/**
 * Was die Seite über die Adressen weiss. Jedes `loadDocuments()` frischt es auf, so stimmen
 * Seite und Redaktion mit dem Inhalt überein, ohne dass jede Stelle die Dokumente mitgeben muss.
 */
let eigene = new Map<string, string>();
let umleitungen = new Map<string, string>();
let belegt = new Set<string>();

export function merkeAdressen(docs: ReadonlyArray<Pick<DocumentMeta, "rel" | "art" | "adresse" | "frueher">>): void {
  const nextEigene = new Map<string, string>();
  for (const doc of docs) {
    if (doc.art !== "brief" && doc.rel !== STARTSEITE && doc.adresse) nextEigene.set(doc.rel, doc.adresse);
  }
  eigene = nextEigene;
  belegt = new Set(docs.map((doc) => publicPath(doc.rel)));
  const next = new Map<string, string>();
  for (const doc of docs) {
    if (doc.art === "brief") continue;
    const heute = publicPath(doc.rel);
    for (const alt of [standardPfad(doc.rel), ...(ALTE_ADRESSEN[doc.rel] ?? []), ...(doc.frueher ?? [])]) {
      if (alt !== heute && !belegt.has(alt)) next.set(alt, heute);
    }
  }
  umleitungen = next;
}

/** Ein Stempel der Adressen. Ändert er sich, müssen alle Seiten neu gesetzt werden (Menü, Links). */
export function adressStempel(): string {
  return JSON.stringify([[...eigene].sort(), [...umleitungen].sort()]);
}

/** Alle Adressen, die früher galten und heute weiterleiten. */
export function alteAdressen(): string[] {
  return [...umleitungen.keys()];
}

/** Belegt eine Seite (auch ein Entwurf) diese Adresse? */
export function adresseBelegt(href: string, ausser?: string): boolean {
  if (ausser && publicPath(ausser) === href) return false;
  return belegt.has(href);
}

export function publicPath(rel: string): string {
  const norm = rel.replaceAll("\\", "/");
  return eigene.get(norm) ?? standardPfad(norm);
}

/** Wohin eine alte Adresse heute führt, oder null. Seiten, die es gibt, leiten nie weiter. */
export function redirectTarget(pathname: string): string | null {
  const pathOnly = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (belegt.has(pathOnly)) return null;
  const direkt = umleitungen.get(pathOnly);
  if (direkt) return direkt;
  // Unterseiten wandern mit: /neuigkeiten/page/2 nach dem Umbenennen von Neuigkeiten.
  for (const [alt, neu] of umleitungen) {
    if (alt !== "/" && pathOnly.startsWith(`${alt}/`)) return neu + pathOnly.slice(alt.length);
  }
  // Newsletter heissen nur noch nach ihrer Nummer. Alte Adressen mit Thema leiten weiter.
  const mitThema = pathOnly.match(/^\/newsletter-(\d+)-.+$/);
  if (mitThema) return `/newsletter-${Number(mitThema[1])}`;
  const brief = pathOnly.match(/^\/briefe\/(\d{4})(?:-.+)?$/);
  if (brief && Number(brief[1]) > 0) return `/newsletter-${Number(brief[1])}`;
  return null;
}

/** Ein Link der Seite (mit ?… oder #…) auf die heutige Adresse. Alles andere bleibt, wie es ist. */
export function aktuell(href: string): string {
  const match = href.match(/^(\/[^?#]*)(.*)$/);
  if (!match) return href;
  const ziel = redirectTarget(match[1]);
  return ziel ? ziel + match[2] : href;
}

const EIGENE_DOMAIN = String.raw`https?://(?:www\.)?advocat-finanz\.ch`;

/** Fertiges HTML: jeder Link und jedes Formular auf eine alte Adresse zeigt auf die heutige. */
export function aktuelleLinks(html: string): string {
  return html.replace(
    new RegExp(String.raw`\b(href|action)="(${EIGENE_DOMAIN})?(/[^"]*)"`, "g"),
    (ganz, attr: string, domain: string | undefined, href: string) => {
      const neu = aktuell(href);
      return neu === href ? ganz : `${attr}="${domain ?? ""}${neu}"`;
    },
  );
}

/** Markdown: Links auf `alt` (auch mit ?…, #… oder der vollen Domain) zeigen danach auf `neu`. */
export function ersetzeAdresse(markdown: string, alt: string, neu: string): string {
  const escaped = alt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return markdown.replace(
    new RegExp(String.raw`(\]\(<?|href=")(${EIGENE_DOMAIN})?${escaped}/?(?=[)>"#?\s])`, "g"),
    (_ganz, vor: string, domain: string | undefined) => `${vor}${domain ?? ""}${neu}`,
  );
}

/** Pfade, die nie eine Seite sein dürfen: die Technik der Website und die Newsletter. */
export function adresseReserviert(href: string): boolean {
  const erstes = href.slice(1).split("/")[0];
  if (["redaktion", "api", "assets", "media", "fonts", "brand", "eingang", "briefe", "papierkorb", "page", "index"].includes(erstes)) return true;
  if (erstes.startsWith("wp-")) return true;
  return /^newsletter-\d+/.test(erstes);
}
